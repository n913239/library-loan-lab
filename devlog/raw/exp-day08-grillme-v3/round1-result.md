讀完了 `docs/spec.md`、`docs/non-goals.md`、`CLAUDE.md`、`README.md`、`EXPERIMENT-PROTOCOL.md`、`tests/overdue.test.js` 和 `package.json`。目前 repo 只有一個紅測試(`overdueDays`)和空目錄,技術棧是 Workers + Hono + D1,但 `package.json` 只裝了 vitest。

規格在「規則」層寫得很硬,但在「怎麼落地」層有幾個洞,而且有兩條規則彼此有張力。第一輪先問前提沒依賴的部分:

---

❓ **Q1** - **測試怎麼碰到資料庫?**:規格的重心是併發測試和「狀態跟紀錄一致」,這些都要真的打 SQL。但 `package.json` 只有 vitest,沒有 wrangler、miniflare、`@cloudflare/vitest-pool-workers`、better-sqlite3。選項:

- (a) `@cloudflare/vitest-pool-workers`:真 D1(miniflare),最貼近 production,但 setup 較重、併發行為受 miniflare 的單寫者影響
- (b) 抽一層極薄的 DB 介面(`prepare().bind().run()/first()/all()` 那幾個),測試用 `better-sqlite3` in-memory 實作,production 用 D1 原生物件。CHECK / partial UNIQUE index 兩邊 SQLite 語法相同
- (c) 只測 domain,routes 不測 —— 但這樣併發規則就沒法「測試證明」,違反規格

➡️ 選 (b)。SQL 方言一致,測試跑得快、能重跑 5 次;而且 (b) 剛好給併發測試一個插閘門的位置(見下一輪)。代價:D1 的 `batch()` 要在 better-sqlite3 用 transaction 模擬一次。

---

❓ **Q2** - **書的狀態誰是真相?**:規格同時要求 (i) `books.status` 是存起來的欄位、走 `book-state.js` 白名單、有 `CHECK`;(ii) 「有未歸還紀錄 ⇔ `on_loan`」要測試證明。這是**兩份真相**——`books.status` 和 `borrow_records.returned_at IS NULL`——一致性得靠每次借/還都在**同一個交易**裡動兩張表。選項:

- (a) 存 `books.status`,借/還用 D1 `batch()`(交易)同時 UPDATE books + INSERT/UPDATE records;併發閘門是 `UPDATE books ... WHERE status='available'` 的 `changes`
- (b) 不存 status,`GET /api/books/:id` 從 records 推導;併發閘門是 `borrow_records(book_id) WHERE returned_at IS NULL` 的 partial UNIQUE index —— 但這樣 `book-state.js` 白名單和硬規則 2 就沒東西可套了
- (c) 兩者都有:status 存起來當閘門,partial UNIQUE index 當 CHECK 之外的第二道防線,任何時候兩者不一致就是 bug,測試直接驗這條不變量

➡️ 選 (c)。硬規則 3 說「`CHECK` 當第二道防線」,一書一冊的世界裡最自然的 CHECK 其實就是那個 partial UNIQUE index —— 它讓「兩筆未歸還」在資料庫層根本寫不進去。`books.status` 的 `CHECK (status IN ('available','on_loan'))` 也保留。

---

❓ **Q3** - **借書的 SQL 到底長怎樣?**:硬規則 3 說判斷要在 `WHERE` 裡並檢查 `changes`,硬規則 2 說不准在別處寫 `status = '...'`。但 `UPDATE books SET status = 'on_loan'` 這行 SQL 本身就是「寫 status」。我打算這樣調和:

```
book-state.js:  transition(from, event) → to   // 唯一的表
routes/borrow:  const { from, to } = ...        // 從表取出 'available' / 'on_loan'
                UPDATE books SET status = ?2 WHERE id = ?1 AND status = ?3   // 全部參數化
                changes === 0 → 409
```

字面的 `'on_loan'` 只出現在 `book-state.js`,SQL 只吃參數。`scripts/` 的靜態檢查就 grep `status\s*=\s*'` 只允許出現在那一檔。這樣解讀硬規則 2 可以嗎?

➡️ 可以,而且我認為這是硬規則 2 唯一講得通的落地法。要不然就得寫 trigger,那比題目本身還大。

---

❓ **Q4** - **借與還各要幾個 SQL、要不要交易?**:借書 = UPDATE books + INSERT record + SELECT policy;還書 = UPDATE record (WHERE returned_at IS NULL AND user_id = ?) + UPDATE books。中間任何一步掛掉就兩份真相分岔。D1 只有 `batch()` 給原子性,但 `batch()` 不能依前一句的 `changes` 決定下一句要不要跑。選項:

- (a) 借:先 UPDATE books 拿 `changes`,成功再 INSERT。不包交易;INSERT 掛掉 → 書卡在 `on_loan` 沒紀錄。接受這個醜
- (b) 借:`batch([UPDATE books ... WHERE status=available, INSERT ... SELECT ... FROM books WHERE id=? AND status=on_loan AND NOT EXISTS(active record)])`,兩句都靠 WHERE 自己守門,交易保證要嘛全成要嘛全空,檢查第二句的 `changes`
- (c) 反過來:INSERT 當閘門(靠 partial UNIQUE 的 constraint error),再 UPDATE books

➡️ 選 (b)。它同時滿足硬規則 3(WHERE + changes)和原子性,而且 partial UNIQUE index 還在後面兜底。還書同理:`batch([UPDATE records SET returned_at, overdue_days WHERE book_id AND user_id AND returned_at IS NULL, UPDATE books SET status=?to WHERE id AND status=?from])`。

---

❓ **Q5** - **規格決定 4 在一書一冊之下是多餘的,還是要當獨立錯誤?**:「一人同一本書只能一筆未歸還」——書只有一本,A 借走後 A 再借,書已經 `on_loan`,本來就會被擋。這條規則**沒有獨立的失敗路徑**,除非你想給它不同的 status code 或訊息。選項:

- (a) 承認多餘,測試保留(spec 要),但實作不特別區分:一樣 409
- (b) 區分:同一人重借回 409 + 「你已經借了」,別人借回 409 + 「on_loan」——這要多一次查詢

➡️ 選 (a)。這條規則在 spec 的「為什麼」欄寫的是「讓同一人重複送出不污染併發測試」,那是**測試設計**的理由,不是業務理由。多一次查詢等於在應用層先查再寫,和硬規則 3 反方向。

---

❓ **Q6** - **4xx 到底是哪些數字?**:spec 全寫「4xx」,但測試要 assert 具體數字,而且 borrow 明確寫 `201`。我提議:

| 情況 | code |
|---|---|
| body 缺 `userId`/`bookId` 或型別錯 | 400 |
| `userId` 或 `bookId` 查不到 | 404 |
| 書 `on_loan`(含同一人重借、含併發輸家) | 409 |
| 還書:找不到「這個人對這本書的未歸還紀錄」(不管是書沒被借、已還、還是別人借的) | 409 |
| 借書成功 | 201 |
| 還書成功 | 200 |

「別人借的」和「已歸還」還書都回 409,不區分——區分的話會洩漏「誰借了這本書」,而且要多一次查詢。

➡️ 照上表。若你要「還書找不到紀錄」用 404 也行,但我傾向 409:資源存在,只是狀態不對。

---

❓ **Q7** - **欄位命名與回應格式**:spec 混用了兩套——body 是 `userId`/`bookId`(camel),紀錄欄位是 `due_at`/`returned_at`/`overdue_days`(snake)。API 回應要哪一套?`src/presentation/` 是「唯一能做時區換算的地方」,但 spec 沒說 API 輸出要換時區。選項:

- (a) 資料庫 snake,API 進出都 camel(`dueAt`),presentation 負責 snake→camel,時間**維持 UTC ISO** 輸出,presentation 現階段不做時區換算
- (b) API 回應直接吐 DB 列(snake),presentation 幾乎是空的
- (c) 輸出換成 `Asia/Taipei`

➡️ 選 (a)。API 給機器讀,UTC 最安全;硬規則 4 的意思是「如果要換,只能在那裡換」,不是「一定要換」。presentation 做 snake→camel 讓它有存在的理由,也讓「DB 欄位名」不直接變成 API 契約。

---

❓ **Q8** - **`GET /api/users/:id/borrows` 的形狀**:spec 只說「未歸還 + 歷史兩段」和「SQL 查詢次數有算過」。要決定:

1. 幾次查詢?一次撈全部在應用層分段,還是兩次各撈一段?
2. 未歸還那段要不要帶**即時算的** `overdueDays`(用 request 當下的 `now`)?spec 說 `overdue_days` 是還書時才押上的
3. 排序?
4. `:id` 查不到 → 404,還是回兩個空陣列?

➡️ (1) **一次**查詢 `WHERE user_id = ? ORDER BY borrowed_at DESC`,在應用層依 `returned_at IS NULL` 分成 `active` / `history`,查詢次數 = 1,測試用 DB 介面的 counter 斷言。(2) 不帶——active 給 `dueAt` 就夠,讀者自己看;要帶就是第二個真相。(3) 兩段都 `borrowed_at DESC`。(4) 404,與 Q6 的「userId 查不到 → 4xx」一致。

---

❓ **Q9** - **schema 放哪、由誰建?**:spec 列了四張表(`books`、`users`、`loan_policies`、`borrow_records`)但目錄裡沒有 `migrations/`,CLAUDE.md 又說「不要主動加表」。這四張是規格明列的,我當作允許;但檔案位置和欄位得定:

```sql
users(id INTEGER PK, name TEXT NOT NULL)
books(id INTEGER PK, title TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('available','on_loan')))
loan_policies(id INTEGER PK, loan_days INTEGER NOT NULL)          -- 一列
borrow_records(id INTEGER PK, user_id, book_id, borrowed_at TEXT NOT NULL,
               due_at TEXT NOT NULL, returned_at TEXT, overdue_days INTEGER,
               CHECK((returned_at IS NULL) = (overdue_days IS NULL)))
CREATE UNIQUE INDEX one_active_loan_per_book ON borrow_records(book_id) WHERE returned_at IS NULL;
```

放 `migrations/0001_init.sql`(wrangler 慣例),測試 setup 讀同一份檔案建 in-memory DB。

➡️ 照上面。`borrow_records` 沒有 `status` 欄位——`active`/`returned` 就是 `returned_at IS NULL` 與否,免得又多一份真相。`CHECK((returned_at IS NULL) = (overdue_days IS NULL))` 讓「還了但沒押天數」寫不進去。

---

❓ **Q10** - **`now` 的型別與 domain 的靜態檢查怎麼劃線?**:現有測試把 `now` 當 **UTC ISO 字串**傳。算 `due_at = now + 14 天` 免不了 `new Date(ms).toISOString()`;算秒差要 `Date.parse()`。硬規則 1 寫的是禁 `Date.now()` / `new Date()`。靜態檢查的正則要禁到哪:

- (a) 只禁 `Date.now(` 和 **無參數**的 `new Date()`;`new Date(x)` 和 `Date.parse(` 放行
- (b) 整個 `Date` 都禁,domain 只做整數毫秒運算,ISO 轉換丟去 routes/presentation

➡️ 選 (a)。(b) 會讓 `overdueDays(dueAt, now)` 現有測試的簽名(字串進)得改,而且「用 Date 做純函數運算」本來就不是副作用。`scripts/check-domain-time.sh` 就 grep `Date\.now\(|new Date\(\s*\)`。

---

❓ **Q11** - **這個 feature 的邊界包不包含?**:你說「借書與還書」,但 spec 有 4 條 endpoint,而且「還完立刻可借」「狀態與紀錄一致」的測試都要 `GET /api/books/:id` 才能觀察。要確認:

1. `GET /api/books/:id` 一起做?
2. `GET /api/users/:id/borrows` 一起做,還是下一個 feature?
3. `scripts/` 的靜態檢查(硬規則 1、2)這次一起寫?
4. seed 資料(幾本書、幾個 user、policy 那一列)由 migration 塞,還是測試各自塞?

➡️ (1) 一起,它是測試的觀察窗。(2) 一起——Q8 已經問了,而且它是「一次 GET 回兩段」的唯一消費者,拆開沒省到什麼。(3) 一起,CLAUDE.md 說違反硬規則 = CI 紅燈,沒有 script 就沒有紅燈。(4) 測試各自塞(每個 test 乾淨 DB),migration 只建表 + `loan_policies` 那一列(`loan_days = 14`)。

---

答完這一輪,下一輪會問**併發測試的閘門到底插在哪**(依 Q1 的答案)、`now` 在 routes 怎麼注入好讓測試控制、以及 devlog 的紀錄格式。
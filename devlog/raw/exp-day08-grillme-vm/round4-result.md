Frontier 空了。收尾一次列完,然後給你 `DECISIONS.md` 全文。

## 收尾 1:檔案佈局

```
src/domain/       time.js(normalize / parse / addDays,唯一碰 Date 的 domain 檔)
                  overdue.js(已存在)
                  book-state.js(BOOK_STATE + TRANSITIONS + transition())
                  loan.js(planBorrow / planReturn)
src/db/           adapter.md(介面契約:prepare/bind/run/first/all/batch)
                  d1.js(production,薄到接近宣告,未被執行過)
                  queries.js(borrow / return 的 SQL,狀態值綁參數)
src/routes/       clock.js(全 repo 唯一可以讀時鐘的檔)
                  books.js / borrow.js / return.js / my-borrows.js
                  app.js(createApp({ db, clock }))
src/presentation/ book.js / borrow-record.js / my-borrows.js(純函式,now 從參數進來)
src/worker.js     production 進入點
scripts/checks.js 五條靜態檢查,export 出來給測試呼叫
schema.sql        DDL + loan_policies seed
tests/helpers/    sqlite-db.js(node:sqlite 實作薄介面,BEGIN/COMMIT 包 batch)
                  gate.js(一次性 barrier,2 秒 timeout,印到達數)
                  app.js(開 :memory:、灌 schema.sql、假時鐘、回 { app, db })
tests/fixtures/   naive-borrow.js(negative control,永久保留)
                  schema-no-index.sql(拿掉 partial unique index)
devlog/raw/       目前不存在,要建
```

## 收尾 2:八條規則 → 測試對照

| # | 規格裡的規則 | 測試檔 | 判定 |
|---|---|---|---|
| 1 | 同一本書不能同時借給兩個人 | `borrow-concurrency.test.js` | 正確實作:`1×201 + (N-1)×409`;naive fixture(no-index schema):`N×201` → 紅 |
| 2 | `on_loan` 時不能借 | `borrow.test.js` | `409` |
| 3 | 一人同一本只能一筆未歸還 | `borrow.test.js` | `409`,**標注為規則 2 的特例** |
| 4 | 還完立刻可借 | `return.test.js` | `return` → `200`,緊接 `borrow` → `201` |
| 5 | `returned` 是終態 | `return.test.js` | 第二次 `return` → `404` |
| 6 | 只能還自己的 | `return.test.js` | `404`(與規則 5 同碼,刻意) |
| 7 | 逾期用 `due_at` 快照 | `return.test.js` | 借出 → 測試直接 `UPDATE loan_policies` → 歸還 → `overdue_days` 不受影響 |
| 8 | 時間是參數 | `overdue.test.js`(已紅)+ `rules.test.js` | 純函式行為 + 靜態檢查第 1 條 |

額外三支:`schema.test.js`(partial unique index 與四條 CHECK 各自擋得住)、`my-borrows.test.js`(兩段 + SQL 次數 `=== 2`,0 筆與 50 筆都是 2)、`books.test.js`(狀態 ⇔ 紀錄一致)。

## 收尾 3:一個新決定,你沒點頭過

**SQL 字串住哪裡?** `CLAUDE.md` 的目錄表只有 `domain` / `routes` / `presentation` —— **沒有任何一格是 repository 的家**。SQL 放 routes 會讓 handler 變胖、也讓硬規則 3 的 review 沒有固定的檢查點。我把它放在 `src/db/queries.js`。這代表 **`CLAUDE.md` 的目錄表要多一列 `src/db/`** —— 這是這次規劃唯一新增的目錄,不是新增表、欄位或 endpoint,但還是超出你原本寫下的佈局,所以明講。

## 收尾 4:要你事後動的七件事

1. `CLAUDE.md` 硬規則 3:「用 `CHECK` 當第二道防線」→「用 `CHECK` + partial `UNIQUE` 索引」
2. `CLAUDE.md` 硬規則 1:加嚴成「`Date.now()` / 無參數 `new Date()` 只准出現在 `src/routes/clock.js`」
3. `CLAUDE.md` 目錄表:加 `src/db/`
4. `docs/spec.md`:錯誤碼表取代全篇的 `4xx`
5. `docs/spec.md`:補上 `overdue_days` 兩段語意(未歸還段現算、歷史段讀存值)
6. `docs/spec.md`:決定 4 降級為規則 2 的特例,理由留著(多副本版才有獨立意義)
7. `README.md`:「刻意保留的醜」加第 4 條

---

## `docs/DECISIONS.md` 全文

````markdown
# 借書 / 還書:實作前的設計決定

> 2026-09-17。這份文件記錄「寫 code 之前拍板的事」與**每一條的理由**。
> 沒有理由的決定,三週後自己會想不起來為什麼,然後就會破例。
>
> **AI 參與範圍:只有設計決定,沒有任何實作。** 產出這份文件的 session 讀了
> `docs/spec.md`、`docs/non-goals.md`、`CLAUDE.md`,沒有碰 `src/`,也沒有寫任何檔。
> 實作順序照 `docs/EXPERIMENT-PROTOCOL.md`:先由人寫一版 commit,再開乾淨 session 出 AI 版。

## A. 執行環境

| # | 決定 | 理由 |
|---|---|---|
| A1 | 抽一層極薄的 DB 介面,只含 D1 API 的子集:`prepare` / `bind` / `run` / `first` / `all` / `batch` | 同一份 code 在測試與 production 上跑;測試才有地方掛閘門 |
| A2 | 測試用 Node 26 內建 `node:sqlite`(`DatabaseSync`)實作該介面;**不裝 `better-sqlite3`、不用 miniflare、不裝 wrangler** | 重跑 5 次一致、快、零外部相依 |
| A3 | `node:sqlite` 沒有 `batch()`,adapter 自己用 `BEGIN` / `COMMIT` 包;`run()` 的 `{ changes, lastInsertRowid }` 映成 D1 的 `{ meta: { changes, last_row_id } }` | D1 的 `batch()` 是單一交易、整批 rollback;兩邊語意必須對齊,否則測試與 production 跑的是兩套併發模型 |
| A4 | adapter 建構時**明確**把 foreign keys 設成 ON,不依賴任何一邊的預設 | D1 與 `node:sqlite` 的預設可能不同;預設是最容易悄悄分歧的地方 |
| A5 | 裝 `hono` 當 dependency;**不裝 wrangler、不部署** | 測試要驅動 4 條 endpoint;部署不在這一版範圍 |
| A6 | 測試用 `app.fetch(new Request(...))` 直接打,不起 server、不開 port;併發測試用 `Promise.all` 送 N 個 Request | 沒有 port 就沒有 flaky |
| A7 | 每支測試開一支全新的 `:memory:` DB,灌 `schema.sql` | 「重跑 5 次一致」的地基,比閘門還根本 |

## B. 借書

| # | 決定 | 理由 |
|---|---|---|
| B1 | batch 之前一次讀,**一句拿兩個值**:<br>`SELECT (SELECT 1 FROM users WHERE id=?1) AS user_exists, (SELECT loan_days FROM loan_policies WHERE id=1) AS loan_days` | 少一次往返;`user_exists` NULL → `404`;`loan_days` NULL → throw(那列是 seed 的,不該消失) |
| B2 | 寫入是一個 batch 兩句,**INSERT 在前、UPDATE 在後**:<br>`INSERT INTO borrow_records (...) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM books WHERE id=? AND status=?)`<br>`UPDATE books SET status=? WHERE id=? AND status=?` | `batch()` 沒有「條件中止」:UPDATE 先跑會把狀態翻掉,排在後面的 INSERT 就再也讀不到 `available`。兩句都是條件式寫入,述詞都在 `WHERE` 裡(硬規則 3 滿足兩次) |
| B3 | 兩句的 `WHERE` 述詞必須**邏輯上逐字等價,而且只管書** | 「兩個 `changes` 必須相等」這個不變量檢查,唯一的前提就是述詞等價。只改其中一句,檢查就從偵測器變成 500 產生器 |
| B4 | **user 存在性不進 SQL 述詞** | 進了述詞就得兩句都加,兩段長述詞永遠保持同步太脆。放 B1 那次讀 |
| B5 | 回來檢查 `changes`:`1/1` → 成功;`0/0` → 被拒;**`1/0` 或 `0/1` → throw,不吞** | 不對稱代表不變量已經壞了(有紀錄沒轉移,或轉移了沒紀錄),那是 bug 不是使用者錯誤 |
| B6 | `201` 的 body **不回查 DB**,`id` 取 `results[0].meta.last_row_id`,其餘欄位用剛寫進去的值 | 少一次查詢,而且 response 保證等於寫進去的東西 |
| B7 | borrow 恰好 **2 次 SQL**(成功)/ **3 次**(失敗時多一次 `classifyBorrowFailure()`) | 可斷言的數字,不是形容詞 |

## C. 還書

| # | 決定 | 理由 |
|---|---|---|
| C1 | 先讀:`SELECT due_at FROM borrow_records WHERE user_id=? AND book_id=? AND returned_at IS NULL`。**撈不到列直接 `404`,連 batch 都不發** | 人不存在、書不存在、還別人的、已經還過 —— 四種情況天然收斂到同一個 `404` |
| C2 | **還書不查 `users` 表** | 沒有 active 紀錄就是 `404`,查了也改變不了答案 |
| C3 | 讀到的 `due_at` 丟給 domain 純函式算 `overdue_days`,再條件式寫入 | 逾期規則必須留在 `overdue.js`,才會被 `overdue.test.js` 測到 |
| C4 | **拒絕**把逾期公式寫成 SQL 表達式(`julianday(...)` 之類) | 那會讓正在跑的邏輯和被測的邏輯是兩份 |
| C5 | 寫入同樣是 batch 兩句(押 `returned_at` + `overdue_days`;把書翻回 `available`),兩個 `changes` 都要是 1 | 同 B5 |
| C6 | 還書 **1 次 SQL**(失敗)/ **2 次**(成功) | 同 B7 |

## D. 「先查再寫」的具名例外

**硬規則 3 禁的是:拿讀到的值去做併發判斷。**

例外的判準改寫成:**讀到的值不進入 `WHERE` 的併發判斷,只當計算輸入或錯誤碼的依據。**

符合這個判準的讀,共三處:

1. B1 的 `user_exists` / `loan_days`
2. C1 的 `due_at`
3. borrow 失敗後的 `classifyBorrowFailure()`(**只決定 `404` 還是 `409`,不決定成敗**,函式名字自己說明這件事)

> 舊的理由「讀的是不可變快照」**撐不住,已作廢**:`loan_policies` 是可變的,測試本人就會去改它。
>
> 已知且不處理的競態:讀完 `loan_days` 到 batch 之間政策被改,這次借閱會用舊值。規格只要求
> **既有紀錄**的 `due_at` 不變,進行中的請求用哪個值都說得通。

## E. schema

```sql
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);

CREATE TABLE books (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','on_loan'))   -- 必須與 book-state.js 一致
);

CREATE TABLE loan_policies (
  id INTEGER PRIMARY KEY CHECK (id = 1),        -- 單列表,結構上保證
  loan_days INTEGER NOT NULL CHECK (loan_days > 0)
);
INSERT INTO loan_policies (id, loan_days) VALUES (1, 14);

CREATE TABLE borrow_records (
  id           INTEGER PRIMARY KEY,             -- 不用 AUTOINCREMENT,沒有 DELETE
  user_id      INTEGER NOT NULL REFERENCES users(id),
  book_id      INTEGER NOT NULL REFERENCES books(id),
  borrowed_at  TEXT NOT NULL,
  due_at       TEXT NOT NULL,
  returned_at  TEXT,
  overdue_days INTEGER,
  CHECK ((returned_at IS NULL) = (overdue_days IS NULL)),
  CHECK (overdue_days IS NULL OR overdue_days >= 0),
  CHECK (returned_at IS NULL OR returned_at >= borrowed_at)
);

CREATE UNIQUE INDEX one_active_loan
  ON borrow_records (book_id) WHERE returned_at IS NULL;
```

| # | 決定 | 理由 |
|---|---|---|
| E1 | partial unique index 是併發的**第二道防線**,不是閘門 | 閘門在 `WHERE`(硬規則 3);索引負責「應用層萬一錯了,DB 也不會髒」 |
| E2 | `CHECK ((returned_at IS NULL) = (overdue_days IS NULL))` | 「還了但忘了寫逾期天數」擋在 DB 層。`CHECK` 只看得到單一 row,這是它在這個 schema 裡唯一有實質價值的用途 |
| E3 | **全系統唯一的時間格式:`toISOString()` 的 24 字元形式**(`2026-09-18T02:00:00.000Z`),由 `src/domain/time.js` 的 normalize 把關,寫進 DB 的每個時間值都過它 | `CHECK (returned_at >= borrowed_at)` 是**字串**比較。`2026-09-18T02:00:00Z` 和 `2026-09-18T02:00:00.000Z` 是同一個時刻,但 `.` 的碼位小於 `Z`,混用會讓 `>=` 和排序一起說謊 |
| E4 | `tests/overdue.test.js` 的字面值(無毫秒)**不用改** | 它走的是 parse,不參與字串比較 |

> **`CHECK` 表達不了「一本書只能有一筆未歸還紀錄」** —— 它只看得到單一 row。
> 硬規則 3 的字面要改成「`CHECK` + partial `UNIQUE` 索引當第二道防線」。

## F. 分層

| # | 決定 | 理由 |
|---|---|---|
| F1 | **domain 算值,presentation 定形狀。** domain 的 `overdueDays(dueAt, now)` 回一個數字,不知道它會被叫什麼、放哪一段;presentation 決定欄位名、分段、哪些欄位出現 | 日後真的要支援 `?tz=Asia/Taipei`,改動只落在一層,硬規則 4 才有實質地盤 |
| F2 | presentation 是**純函式**:不讀時鐘、不碰 DB,`now` 從參數進來 | 硬規則 1 對它一樣有效 |
| F3 | `GET /api/books/:id` 也走 presentation,即使只挑兩個欄位 | 免得「有些 endpoint 經過、有些不經過」變成下一個不一致 |
| F4 | `book-state.js` 的轉移表是 **SQL 狀態值的唯一來源**:`const { from, to } = transition('borrow')`,兩個值綁參數進 `SET status=? WHERE ... status=?` | 否則轉移表的唯一呼叫者會是它自己的測試 —— 一張表、零個生產呼叫點,三個月後跟真實行為長歪也沒人發現。這樣改完,想繞過白名單連 SQL 都拼不出來 |
| F5 | 狀態字面值的合法出現處只有兩個:`book-state.js` 與 `schema.sql` 的 `CHECK`(後者沒辦法綁參數,靜態檢查開白名單並在檔內註明必須一致) | 硬規則 2 從精神變成字面可執行 |
| F6 | 時鐘:一個 `clock` middleware 在請求進來的第一時間取一次 `now`,塞進 context,整個請求共用 | 同一個請求裡不會出現兩個相差幾毫秒的 `now`;而且「時鐘只在一個檔案裡被讀到」讓靜態檢查變得極簡單 |
| F7 | domain 的 ISO↔epoch 轉換全部收進 `src/domain/time.js` | 其他 domain 檔完全不碰 `Date` |
| F8 | SQL 字串住 `src/db/queries.js` | `CLAUDE.md` 的目錄表原本沒有 repository 的家;SQL 散進 routes 會讓硬規則 3 沒有固定的 review 檢查點。**目錄表要補一列 `src/db/`** |

## G. 錯誤碼

| 情境 | 碼 |
|---|---|
| body 缺 `userId` / `bookId` 或型別不對 | `400` |
| `userId` 查無此人(borrow) | `404` |
| `bookId` 查無此書(borrow) | `404` |
| 書已被借走(**含同一人重複借**) | `409` |
| 借書成功 | `201` |
| 還書:找不到「該人 × 該書 × 未歸還」的紀錄 | `404` |
| 還書成功 | `200` |

- 錯誤 body:`{ "error": "一句話" }`(「刻意保留的醜」第 2 條)。
- **還書的三種失敗(還別人的 / 已經還過 / 根本沒借過)回同一個 `404`,不分。** 分開要多查一次,而且「還別人的」回 `403` 在一個沒有身分驗證的系統(非目標 6)裡是自欺 —— 你連他是不是本人都沒驗。
- 規格原本全篇寫 `4xx`,那不是可判定的句子(規格自己第 3 行要求「能判定」)。上表要寫回 `docs/spec.md` 取代 `4xx`。

## H. 測試策略

| # | 決定 | 理由 |
|---|---|---|
| H1 | 閘門放在**測試 adapter**,不進 production code | production code 不該知道測試的存在 |
| H2 | 閘門只掛 `run()` 和 `batch()`,**讀完全不攔** | 剛好讓 naive 實作的那次 SELECT 自由通過、在閘門前就讀到 `available` —— 那正是要撐開的縫 |
| H3 | 一次性 barrier 等 N 個到達,**2 秒 timeout,逾時印出已到達 k/N** | 「重跑 5 次一致」的反面不只是偶爾紅,還包括偶爾 hang,而 hang 在 CI 上最難讀 |
| H4 | **每個 borrow 請求恰好一次 gated 寫入呼叫**(naive fixture 也用 `batch()`) | 呼叫次數不一樣,barrier 會提早放行或永遠等;而且這樣 negative control 只變動一個變數:`WHERE` |
| H5 | 併發測試用 **N 個不同的 `userId`** | 測的是互斥,不是去重 |
| H6 | **negative control 永久保留**:`tests/fixtures/naive-borrow.js`(先 SELECT 看 available,再無條件寫),同一支併發測試跑兩種實作 | 沒有 negative control,⭐ 那一列就沒有裁判資格 |
| H7 | negative control 跑 **no-index 的 schema**,檔頭寫明理由 | 帶著索引跑的話,naive 是紅在第二道防線、不是紅在缺了 `WHERE`;而且一個把 constraint error catch 成 `409` 的 naive 實作會全綠 |
| H8 | partial unique index 擋得住,由 `schema.test.js` **單獨**證明(直接對 DB 硬塞第二筆 active 紀錄) | 一支測試拿不到兩個結論 |
| H9 | adapter 加 `calls` 計數器,把「SQL 查詢次數有算過」變成斷言 | 形容詞沒有裁判資格 |
| H10 | `GET /api/users/:id/borrows` 斷言 **恰好 2 次**,且**與筆數無關**(0 筆和 50 筆都是 2) | 一句 `WHERE user_id=?` 撈到 0 列,分不出「沒這個人」和「有人但沒紀錄」(規格決定 5 要求前者 `4xx`)。「有算過」防的是 N+1,不是 2 vs 1 |
| H11 | 「借出後改政策」的測試**直接 `UPDATE loan_policies`**,繞過應用層,檔頭註明是刻意的 | 改政策不是這一版的 use case。**不為了可測性長出第 5 條 endpoint** |
| H12 | 回應分 `active` / `history` 兩段:**`active` 段用 request 的 `now` 現算 `overdue_days`,`history` 段讀存下來的值。兩段共用同一個欄位名** | 分段本身已經說明哪個是定格、哪個是當下,多一個名字等於多一個詞。同一支 `overdueDays()` 純函式服務兩邊,順便是硬規則 1 的第二個證人 |

## I. 靜態檢查(`scripts/checks.js`)

| # | 檢查 | 範圍 |
|---|---|---|
| 1 | `Date.now()` / **無參數**的 `new Date()` 只准在 `src/routes/clock.js` | 全 repo |
| 2 | `'available'` / `'on_loan'` 只准在 `book-state.js` 與 `schema.sql` | 全 repo |
| 3 | `src/domain/**` 不准 import 任何 db / adapter 模組 | domain |
| 4 | SQL 字串裡的 `UPDATE` 必須有 `WHERE` | 全 repo |
| 5 | `toLocaleString` / `Intl.DateTimeFormat` / `getTimezoneOffset` 只准在 `src/presentation/**` | 全 repo |

- 第 1 條必須用 `new Date\(\s*\)` 精確抓**無參數**形式。`new Date(isoString)` 是**解析不是讀時鐘**,`computeDueAt` 一定會用到;粗暴的正則會誤殺它,然後你就會為了過檢查寫出奇怪的 code。
- 檢查邏輯 export 給 `tests/rules.test.js` 呼叫。**一個 `npm test` 同時跑規則與行為**,CI 不用第二條指令,紅燈長得一樣。
- 第 1 條比硬規則 1 現在的字面更嚴(原本只禁 domain),`CLAUDE.md` 要跟著改。

## J. 沒有被證明的事(必須在文章裡承認)

1. **硬規則 3 有大半靠 review 和那支併發測試,靜態只擋得住「忘了寫 `WHERE`」。** 「某次 `.first()` 的結果有沒有流進後面的分支條件」沒有可靠的靜態形式。假裝它被自動化守住,比知道它沒有更危險。
2. **production adapter 從來沒有被任何一個真的 D1 執行過。** 整個系統的正確性證據,全部來自 `node:sqlite` 上的測試 —— 它們賭的是兩邊的交易與約束語意一致,而這件事這一版沒有驗證。具體賭了四件事:D1 的 `batch()` 是單一交易且整批 rollback、D1 支援 partial unique index、D1 的 batch 結果每句都有 `meta.changes` 與 `meta.last_row_id`、D1 的 foreign key 行為與明確設成 ON 的 `node:sqlite` 一致。
3. **規格決定 4(一人同一本只能一筆未歸還)在一書一冊下永遠不可能被違反** —— 書一旦 `on_loan`,任何人都借不到,包含借走它的那個人。它已降級為規則 2 的一個特例測試,不加獨立索引或欄位。理由留著:**多副本版才有獨立意義。**
````

還有一件事,我不寫檔但提醒你:`devlog/` 這個目錄現在不存在,而 `CLAUDE.md` 和 `EXPERIMENT-PROTOCOL.md` 都在指望它(`devlog/raw/` 存 AI 原始輸出)。乾淨 session 跑之前要先建。
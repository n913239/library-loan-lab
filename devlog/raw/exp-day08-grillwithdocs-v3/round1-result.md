我先把環境事實查清楚了,再開始拷問。查到的事實:

- 目前 `src/` 三個目錄都是空的,只有 `tests/overdue.test.js`(紅燈測試,簽名 `overdueDays(dueAt, now)` 已定案)。
- `package.json` 只有 `vitest`,**沒有** `wrangler`、`@cloudflare/vitest-pool-workers`、`better-sqlite3`;沒有 `wrangler.toml`、沒有 schema / migrations、`scripts/` 是空的。
- **這裡不是 git repo**,但 CLAUDE.md 要求一個變更一個 commit。
- 沒有 `CONTEXT.md`、`docs/adr/`。
- 技術棧 README 說是 Cloudflare Workers + Hono + D1。D1 的事實:**沒有交談式交易**(不能 `BEGIN` 後看結果再決定),唯一的原子單位是 `db.batch([...])`,全成功或全回滾,但中途不能依 `changes` 分支。

下面是我在規格裡找到的縫隙與互相打架的地方。第一輪,12 題,每題附建議。

---

❓ **Q1** - **併發守門員到底是誰**:硬規則 3 說「條件式寫入 + 檢查 `changes`,並用 `CHECK` 當第二道防線」。但 `CHECK` 只能約束單列(例如 `status IN ('available','on_loan')`),**擋不住「同一本書兩筆未歸還紀錄」**——那要靠 partial unique index:`CREATE UNIQUE INDEX ... ON borrow_records(book_id) WHERE returned_at IS NULL`。硬規則 3 的「CHECK」是字面意思,還是泛指「DB 層約束」?

➡️ 讀成泛指。第一道:`UPDATE books SET status=? WHERE id=? AND status=?` 檢查 `changes = 1`;第二道:partial unique index;`CHECK(status IN (...))` 照加但它只是白名單的 DB 版,不是併發防線。若你堅持字面 CHECK,我做不到「第二道防線」這件事,要先說清楚。

---

❓ **Q2** - **借書是兩筆寫入(改 `books.status` + 插 `borrow_records`),原子性怎麼保**:D1 沒有交談式交易。三個選項:
(a) `batch([UPDATE books 條件式, INSERT borrow_records])`——`changes=0` 不會讓 batch 失敗,所以輸家的偵測其實是靠 INSERT 撞到 partial unique index **拋錯**、整個 batch 回滾;route 把 UNIQUE 錯誤翻成 4xx。
(b) 兩趟:先條件式 UPDATE、看 `changes`、再 INSERT。併發正確(UPDATE 就是閘),但 worker 在兩趟之間死掉會留下 `on_loan` 卻沒紀錄的孤兒,違反查書的「⇔」。
(c) 反過來 INSERT 先(unique index 擋輸家)、再 UPDATE books。孤兒方向相反。

➡️ (a)。理由:查書那條「有未歸還紀錄 ⇔ `on_loan`」是規格明寫的不變量,(b)(c) 都有一個窗口會破壞它。代價是 Q1 的 unique index 從「第二道」變成 batch 路徑上實際拋錯的那一道——這點要在 code 註解裡承認。還書同樣用 batch(UPDATE borrow_records 條件式 + UPDATE books 條件式)。

---

❓ **Q3** - **測試跑在什麼 DB 上**:`package.json` 只有 vitest。選項:`@cloudflare/vitest-pool-workers`(miniflare 裡的真 D1,batch 語義跟線上一致)或 `better-sqlite3` 自己包一層假 D1(快、但 batch 原子性是你自己模擬的,測不到 Q2 真正在意的事)。

➡️ `vitest-pool-workers`。Q2 選 (a) 之後,測試的價值就在 batch 語義是真的。要加 `wrangler` + `wrangler.jsonc` 作 devDependency,這算 scaffolding 不算「加 endpoint」,但仍先問你。

---

❓ **Q4** - **4xx 對照表**:規格全寫「4xx」,沒有裁判資格。提議:

| 情況 | 碼 |
|---|---|
| body 缺 `userId`/`bookId` 或型別錯 | 400 |
| `userId` / `bookId` 查不到 | 404 |
| 借:書 `on_loan` | 409 |
| 還:該 (userId, bookId) 沒有未歸還紀錄 | 409 |

➡️ 照上表。注意最後一列:規格分列「已歸還再還」和「還別人的」兩條規則,但 `POST /api/return` 只帶 `{userId, bookId}`,**這兩種情況在資料上是同一件事**——查不到 (user, book) 的 active 紀錄。我建議**不區分**(都 409、同一句話),區分等於回答「這本書現在在誰手上」,而且非目標明講錯誤訊息只有 status + 一句話。你要區分的話,要告訴我用什麼查詢分辨。

---

❓ **Q5** - **「一人同一本只能一筆未歸還」是規則還是推論**:一書一冊之下,同一人借第二次時書已經 `on_loan`,會被 Q4 第三列擋掉。規格決定 4 的理由是「讓同一人重複送出不污染併發測試」,但單冊版根本不需要這條就有這個效果。這條要不要有**獨立的 code path**(例如不同錯誤訊息、或 `(user_id, book_id)` 的另一個 index)?

➡️ 不要獨立 code path。規格那列保留、測試照寫(同一人重複借 → 409),但它由「書已 `on_loan`」順帶滿足;CONTEXT.md 註明「此規則在單冊版是推論,多副本版才需要獨立實作」。

---

❓ **Q6** - **`overdue_days` 存不存進資料庫**:規格說歸還時「押上 `returned_at` 與 `overdue_days`」——是存成欄位,還是每次讀取用 `due_at`/`returned_at` 算?存了就是冗餘(兩者可推),不存就每次讀要算。

➡️ 存。欄位 `overdue_days INTEGER`,未歸還時 `NULL`,歸還那刻用 `overdueDays(due_at, now)` 算好寫入,之後不再重算。理由:規格說「押上」,而且「用快照算」的證據就在紀錄上,測試好驗。未歸還紀錄**不**回「目前逾期幾天」——那是「我的借閱」的事,今天不碰。

---

❓ **Q7** - **回應的欄位命名、`status` 欄位、時區**:規格 request body 用 camelCase(`userId`),紀錄欄位用 snake_case(`due_at`、`overdue_days`)。另外借閱紀錄的狀態機 `active → returned`——是**存一欄 `status`**,還是 `returned_at IS NULL` 就是 active?回應要不要做時區換算?

➡️ (1) 照規格字面:body camelCase,回應紀錄 snake_case(`id, user_id, book_id, borrowed_at, due_at, returned_at, overdue_days`),不在 presentation 改名——規格就是契約,改名等於改契約。(2) **不存 `status` 欄**,`returned_at IS NULL` ⇔ active;回應也不加 `status` 欄位(避免「主動加欄位」)。(3) 回應維持 UTC 字串,`src/presentation/` 只是邊界,目前不做換算。

---

❓ **Q8** - **ISO-8601 的精確格式**:`new Date().toISOString()` 給 `2026-09-17T02:00:00.000Z`(有毫秒),測試檔用 `2026-09-18T02:00:00Z`(沒有)。兩種都是合法 ISO-8601 UTC,但混存後 SQL 字串比較會壞。

➡️ 存 `toISOString()` 原樣(含 `.000Z`),route 取時間就是這一行;`overdueDays` 用 `Date.parse` 算秒差所以兩種都吃;本 feature 的 SQL **不做**任何日期字串比較。

---

❓ **Q9** - **Schema、migrations、seed 放哪;四張表長什麼樣**:CLAUDE.md 的目錄表沒有 `migrations/`;「不要主動加表」——但規格已點名四張:`books(id, title, status)`、`users(id, name)`、`loan_policies(id, loan_days)`、`borrow_records(id, user_id, book_id, borrowed_at, due_at, returned_at, overdue_days)`。id 用 INTEGER PRIMARY KEY 還是 UUID 字串?測試要塞書和讀者,沒有 endpoint 可用(非目標),只能直接 SQL。

➡️ `migrations/0001_init.sql`(wrangler 慣例)放這四張表、Q1 的 index 與 CHECK、FK(D1 預設開 `foreign_keys`)。id 全用 `INTEGER PRIMARY KEY`。seed 不做 migration,測試用 `tests/helpers/seed.js` 直接 INSERT。`loan_policies` 一列 `loan_days = 14`,由 migration 塞。這是唯一會「加表」的地方,四張都是規格點名的,超出這四張我就來問。

---

❓ **Q10** - **`book-state.js` 的形狀,以及靜態檢查要不要現在寫**:硬規則 2 說轉移表在 `src/domain/book-state.js`、別處不准 `status = '...'`——連 SQL 字串裡也不准?那 UPDATE 的 from/to 要從表裡取值綁參數。`scripts/` 是空的,但 CLAUDE.md 說違反 = CI 紅燈。

➡️ 轉移表 `{ available: { borrow: 'on_loan' }, on_loan: { return: 'available' } }` + `transition(from, event)`;SQL 寫 `SET status = ? WHERE status = ?`,值從 `transition()` 拿,**任何 SQL 都不出現狀態字面值**。靜態檢查現在就寫兩支:`scripts/check-no-clock.sh`(`src/domain/` 禁 `Date.now`/`new Date`)與 `scripts/check-status-literal.sh`(`book-state.js` 以外禁 `'available'`/`'on_loan'` 字面值),掛在 `npm test` 前。不寫的話「CI 紅燈」是空話。

---

❓ **Q11** - **還書的併發要不要一起證明**:規格併發測試只要求借書。但還書同樣是「條件式 UPDATE + `changes`」,而且有兩個 race:(a) 同一人同時送 N 次 return → 恰好一次 200;(b) A 還 X 的同時 B 借 X → 兩者順序任一,但最後狀態一致(X `on_loan` 給 B 或 X `available`,絕不出現兩筆 active)。

➡️ 加 (a),不加 (b)。(a) 跟借書用同一個閘門 helper、成本近零、而且直接測 `returned` 終態在併發下守不守。(b) 的斷言是「最終一致」而非「恰好一人」,寫法容易變成 flaky;留給日後。

---

❓ **Q12** - **不是 git repo,commit 規則怎麼辦**:CLAUDE.md 要一個變更一個 commit、message 標「AI 版」;EXPERIMENT-PROTOCOL 說乾淨 session 是 `rm -rf .git`——所以現在這狀態是刻意的。

➡️ 我在動手前 `git init`,之後照規則每個變更一個 commit、中文 message、標「AI 版」、不加署名 trailer。如果你打算自己在外面接 git 歷史,就告訴我不要 init,我只改檔。

---

❓ **Q13** - **詞彙:borrow 還是 loan**:規格裡 `POST /api/borrow`、`borrow_records`,但 `loan_policies`、`on_loan`;中文有「借閱」「借書」「借期」。要寫 CONTEXT.md 得選一個。

➡️ 中文正名「借閱」(借閱紀錄、借期、借期政策);英文以 `borrow` 為主(BorrowRecord、`borrowedAt`),`loan` 只留在規格已定的兩個識別字 `on_loan`、`loan_policies` 並在 glossary 註明是契約遺留,不再新造 `loan*` 名字。Avoid:checkout、lending、loan record。你點頭我就寫 `CONTEXT.md`。

---

第一輪先到這。Q1/Q2 是整棵樹的根,其他大多獨立;你答完我再算下一輪的 frontier(可預見的:batch 失敗時錯誤怎麼分類、閘門 helper 的長相、`loan_policies` 缺列時的行為)。
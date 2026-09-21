Frontier 已空。以下是整棵設計樹的共識摘要,依枝幹分組;每條後面標來源題號,方便你回頭對。

## 共識摘要:借書 / 還書 / 查書 / 我的借閱

### 1. 併發與原子性(根)

| 決定 | 來源 |
|---|---|
| 第一道防線:`UPDATE books SET status=? WHERE id=? AND status=?`,看 `changes` | Q1 |
| 第二道防線:partial unique index `borrow_records(book_id) WHERE returned_at IS NULL`;`CHECK(status IN (...))` 照加,但它只是白名單的 DB 版 | Q1 |
| 兩筆寫入放同一個 `batch()`;第二句加 `WHERE changes() = 1` 綁住第一句,輸家的第二句改 0 列 → route 讀 `results[1].meta.changes` 判 409,正常路徑零例外 | Q2, Q14 → ADR-0002 |
| 第一句成功、第二句 0 列 = DB 事先不一致 → 500 + log (userId, bookId),不自動修復 | Q21 |
| 存在性(讀者、書)在 batch 前用一句雙子查詢 `SELECT` 檢查,註解明寫「這不是併發判斷」;狀態判斷全在 WHERE | Q28 |
| 還書的併發也證明:同一人 N 次 return → 恰好一次 200;A 還 / B 借的 race 不測 | Q11 |

### 2. 測試基礎設施

| 決定 | 來源 |
|---|---|
| 不裝 vitest-pool-workers;薄 DB 介面 = D1 API 子集(`prepare/bind/run/first/all` + `batch`),只依賴 `meta.changes`、`meta.last_row_id`、`results` | Q3, Q15 → ADR-0001 |
| 測試 adapter `tests/helpers/sqlite-d1.js` 用 `node:sqlite`(Node 26.5.0 內建),`batch` 用 `BEGIN…COMMIT` 模擬;永不進 `src/` | Q3, Q15 |
| 閘門在 adapter:每次寫入前 `await gate`,N 個到齊才放行;證明「守門在 SQL」,不證明 D1 真實併發 | Q16 |
| 每個測試一個 `:memory:` DB,`exec` 整份 `migrations/0001_init.sql` | Q33 |
| 併發測試 N = 10,`{ repeats: 5 }` 寫在測試碼裡 | Q32 |
| adapter 帶查詢計數器;「我的借閱」斷言 `=== 2` 且與筆數無關(0 筆、50 筆都是 2);borrow/return 不斷言次數 | Q22 |
| `assertConsistent(db, bookId)` helper(`books.status` ⇔ active 紀錄數)在借、還、併發測試每個斷言點呼叫,另加一個走完整圈的測試 | Q26 |
| 一個小測試讀 migration,斷言 `book-state.js` 的每個狀態都出現在 `CHECK` 裡 | Q30 |
| `now` 注入:`createApp({ db, clock })`,`clock()` 回 ISO 字串;`src/index.js` 是 worker 入口(`env.DB` + 真時鐘),測試只碰 `createApp` | Q27 |

### 3. Schema

| 決定 | 來源 |
|---|---|
| `migrations/0001_init.sql`,四張表:`books(id, title, status)`、`users(id, name)`、`loan_policies(id, loan_days)`、`borrow_records(id, user_id, book_id, borrowed_at, due_at, returned_at, overdue_days)`;id 全 `INTEGER PRIMARY KEY`;FK 開 | Q9 |
| migration 塞 `loan_policies` 一列 `loan_days = 14`;測試改政策用 UPDATE 不用 INSERT;`SELECT … LIMIT 1`,缺列 → 500 | Q9, Q18 |
| 借閱紀錄**不存** `status` 欄,`returned_at IS NULL` ⇔ active | Q7 |
| `overdue_days` 存欄位,未歸還時 NULL,還書那刻用 `overdueDays(due_at, now)` 押上 | Q6 |
| 「一人同一本只能一筆未歸還」不做獨立 code path,由書 `on_loan` 順帶滿足;測試照寫 | Q5 |
| seed 不做 migration,測試用 `tests/helpers/seed.js` 直接 INSERT | Q9 |

### 4. API 契約

| 決定 | 來源 |
|---|---|
| 400 body 缺欄/型別錯(`"1"` 字串 → 400,嚴格 `Number.isInteger`);404 讀者或書不存在;409 書 `on_loan`(借)/ 該 (user, book) 沒有 active 紀錄(還)——「已歸還再還」與「還別人的」不區分 | Q4, Q19, Q28 |
| 錯誤 body `{ "error": "英文小寫一句" }`,測試只斷言 status | Q19 |
| request body camelCase(`userId`, `bookId`);回應紀錄 snake_case(`id, user_id, book_id, borrowed_at, due_at, returned_at, overdue_days`),不改名 | Q7 |
| 時間字串存 `toISOString()` 原樣(含 `.000Z`);回應維持 UTC,presentation 不換時區;本 feature 的 SQL 不做日期字串比較 | Q7, Q8 |
| 借書 201 / 還書 200,body 都是 batch 後 `SELECT` 回來的正本紀錄 | Q33 |
| `GET /api/users/:id/borrows` → `{ active: [...], history: [...] }`;active 依 `due_at` 升冪、history 依 `returned_at` 降冪,`ORDER BY` 在 SQL;不分頁;active 段 `overdue_days` 用 request 的 `now` 現算、同名 | Q23, Q24 |
| 分段 + 現算放 `src/presentation/borrows.js` 的 `presentBorrows(records, now)`,可呼叫 domain 純函式 | Q25 |

### 5. 程式結構與規則落地

| 決定 | 來源 |
|---|---|
| 新目錄 `src/db/`(`queries.js` 放 SQL、`index.js` 放介面 typedef);route 不寫 SQL 字串。CLAUDE.md 目錄表已加 | Q15 |
| `book-state.js`:轉移表 `{ available: { borrow: 'on_loan' }, on_loan: { return: 'available' } }` + `transition(from, event)`,非法轉移拋錯;SQL 一律 `SET status=? WHERE status=?`,值從 `transition()` 拿 | Q10 |
| domain 函式:`overdueDays(dueAt, now)`(紅燈已在)、`dueAt(now, loanDays)`(紅燈要含毫秒案例)、`transition` | Q20 |
| 靜態檢查兩支 Node script:`scripts/check-no-clock.js`(`src/domain/` 禁 `Date.now(`、`new Date(` 任何形式,允許 `Date.parse`)、`scripts/check-status-literal.js`(`src/` 排除 `book-state.js` 禁 `'available'`/`'on_loan'` 字面值;`migrations/`、`tests/` 不掃);`npm test` = `node scripts/check.js && vitest run` | Q29 |
| 依賴:`hono`、`wrangler`(dev);加 `wrangler.jsonc`(binding `DB`、`migrations_dir`),沒有 script 依賴它,不驗 `wrangler dev` | Q31 |
| 不 `git init`,只改檔,git 歷史你在外面接 | Q12 |

### 6. 實作順序(Q20)

1. `overdueDays` → 2. `dueAt` → 3. `transition` → 4. 兩支靜態檢查 → 5. migration + adapter + seed + 閘門 → 6. `POST /api/borrow`(含併發、快照測試)→ 7. `POST /api/return`(含 N 次 return 併發)→ 8. `GET /api/books/:id`(含 ⇔ 一致性)→ 9. `GET /api/users/:id/borrows`(含查詢次數 = 2)。每步先紅燈再實作。

### 已落地的文件

- `CONTEXT.md` — 詞彙(中文「借閱」、英文 `borrow`、`on_loan`/`loan_policies` 註明契約遺留、單冊版推論規則)
- `docs/adr/0001-tests-on-node-sqlite-not-d1.md`
- `docs/adr/0002-batch-with-changes-guard.md`
- `CLAUDE.md` 目錄表 +1 行 `src/db/`

### 明講的假設(上線才驗得到)

- D1 `batch` 內語句在同一連線依序執行,`changes()` 可用——失效模式都是大聲的(全 409 或 unique index 接住)。
- Q28 的存在性預查是對硬規則 3 的**詮釋**(規則管狀態不管存在性),已註記要在 code 註解裡寫明。

沒有動任何 `src/`、`tests/`、`scripts/`、`migrations/`、`package.json`。你確認這份摘要就是共識,我下次 session 照第 6 節順序動手;要改哪條,指題號就好。
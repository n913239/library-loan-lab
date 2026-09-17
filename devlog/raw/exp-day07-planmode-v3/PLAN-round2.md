# 借書 / 還書實作計畫(v2,依規格修訂)

## Context

repo 是空殼(`src/*`、`tests/`、`scripts/` 只有 `.gitkeep`,package.json 只有 vitest,沒 git)。
這是實驗協定的「乾淨 session」,只有 `CLAUDE.md` 的 5 條硬規則。

要做:借書(可借的書 → 借走,借期由 `loan_policies` 決定、寫成快照)、還書(立刻可借;已歸還是終態;逾期天數用快照算)、
兩支查詢 endpoint。不做:罰款、預約、建書/建人 endpoint、UI、登入。

已確認:Node v26.5 內建 `node:sqlite` → 測試不另裝 sqlite;`hono` 要加;不 commit(協定裡 commit 是使用者的事)。

## 規格決定(使用者已裁決)

| 項目 | 決定 |
|---|---|
| 身分 | `userId` 走 POST body,不用 header;`users` 表查不到 → 404 |
| 路徑 | `POST /api/borrow`、`POST /api/return`,body `{ userId, bookId }`;`GET /api/books/:id`;`GET /api/users/:id/borrows` |
| 逾期 | `max(0, floor((now − due_at) / 86400s))`,未滿一天不算 |
| 還書 | 以「這個讀者對這本書未歸還的那一筆」為準;已歸還 / 別人的紀錄 → 4xx |
| 借閱狀態 | `returned_at IS NULL` 推導,不加 status 欄 |
| 借期 | 存 `loan_policies` 表(單列),借出時算好 `due_at` 寫進紀錄;改政策不影響既有紀錄 |
| 重複借 | 一人同一本只能一筆未歸還 → 4xx;還完立刻可借 |
| 其他 | 可加 `src/db/`;書和讀者靠 SQL 塞;`src/presentation/` 這次不放東西 |

## 我補的小決定(不擋路,你不喜歡就改)

- 還書找不到「這人這本未歸還」的紀錄:已歸還、別人借的、根本沒借過,三種情況 SQL 上長一樣(`changes === 0`),
  統一回 **404 `no_active_loan`**,不多查一次去區分。
- 同一人重複借同一本:因為一本書只有一冊,書已是 `on_loan`,走同一條路 → **409 `book_on_loan`**。
  DB 層不另加 `(user_id, book_id)` 的 partial unique index——`(book_id)` 那支已經更嚴格。測試會明寫這個案例。
- JSON 進出用 camelCase(跟 body 的 `userId, bookId` 一致),DB 欄位維持 snake_case,轉換在 `src/routes/` 做一個小 `toJson(row)`。
- `loan_policies` 用 singleton 寫法:`id INTEGER PRIMARY KEY CHECK (id = 1)`,migration 塞一列 `loan_period_days = 14`。

## 檔案

```
package.json                 + dependencies.hono、devDependencies.wrangler;test = check-rules.sh && vitest run
wrangler.toml                D1 binding `DB`,migrations_dir = migrations
migrations/0001_init.sql     users、books、loans、loan_policies(+ 政策初始列);schema 唯一來源,測試也讀這檔
src/index.js                 export default createApp()
src/domain/book-state.js     轉移白名單(唯一可寫 status 字面值的地方)
src/domain/loan.js           dueAt(borrowedAt, periodDays)、overdueDays(dueAt, now)
src/db/loans.js              borrow / returnLoan / getBook / listUserBorrows:SQL 都在這
src/routes/api.js            createApp(clock):4 個 endpoint;取 now、驗 body、產 loan id、row → JSON
scripts/check-rules.sh       靜態檢查硬規則 1、2
tests/helpers/db.js          node:sqlite 包成 D1 形狀,可掛閘門、可數 SQL 次數
tests/domain/book-state.test.js
tests/domain/loan.test.js
tests/api.test.js            走 app.request() 的端對端
tests/concurrency.test.js    閘門式併發
```

## Schema(`migrations/0001_init.sql`)

```sql
CREATE TABLE users (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE books (
  id     TEXT PRIMARY KEY,
  title  TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
         CHECK (status IN ('available', 'on_loan'))          -- 硬規則 3 第二道防線
);
CREATE TABLE loan_policies (
  id               INTEGER PRIMARY KEY CHECK (id = 1),       -- 單列
  loan_period_days INTEGER NOT NULL CHECK (loan_period_days > 0)
);
INSERT INTO loan_policies (id, loan_period_days) VALUES (1, 14);
CREATE TABLE loans (
  id          TEXT PRIMARY KEY,
  book_id     TEXT NOT NULL REFERENCES books(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  borrowed_at TEXT NOT NULL,   -- UTC ISO-8601
  due_at      TEXT NOT NULL,   -- 借出當下的快照(硬規則 5)
  returned_at TEXT,            -- NULL = 借出中;非 NULL = 終態
  CHECK (returned_at IS NULL OR returned_at >= borrowed_at)
);
-- 一本書同一時間只能有一筆未歸還:就算 UPDATE 被繞過也擋
CREATE UNIQUE INDEX loans_one_active_per_book ON loans(book_id) WHERE returned_at IS NULL;
CREATE INDEX loans_by_user ON loans(user_id, returned_at);
```

## Domain(純函式,時間從參數進)

`src/domain/book-state.js`
```js
export const EVENTS = {
  borrow: { from: 'available', to: 'on_loan' },
  return: { from: 'on_loan',   to: 'available' },
};
```
SQL 一律 `SET status = ? WHERE status = ?`,參數從 `EVENTS.*` 帶,程式裡不再出現狀態字面值。

`src/domain/loan.js`
```js
const DAY_MS = 86_400_000;
export function dueAt(borrowedAt, periodDays)  // ISO → ISO;Date.parse + new Date(ms),不碰 new Date()
export function overdueDays(dueAt, now)        // Math.max(0, Math.floor((parse(now) - parse(dueAt)) / DAY_MS))
```
輸入不是合法 ISO → throw(routes 已驗過,domain 只防呆)。

## DB 層(`src/db/loans.js`)— 硬規則 3

**borrow(db, { userId, bookId, loanId, now })**
1. `SELECT id FROM users WHERE id=?` → 無 → 404 `user_not_found`
2. `SELECT loan_period_days FROM loan_policies WHERE id=1` → `periodDays`
3. `UPDATE books SET status=? WHERE id=? AND status=?` ← `EVENTS.borrow.to / .from`
4. `changes === 0` → `SELECT 1 FROM books WHERE id=?` → 無 → 404 `book_not_found`;有 → 409 `book_on_loan`
5. `INSERT INTO loans (…, borrowed_at=now, due_at=dueAt(now, periodDays), returned_at=NULL)`
6. 回傳 loan row

步驟 1、2 是讀,但不是併發裁決(讀者不會被刪、政策改了也只影響新借);裁決在步驟 3 的 `WHERE`。

**returnLoan(db, { userId, bookId, now })**
1. `SELECT * FROM loans WHERE user_id=? AND book_id=? AND returned_at IS NULL` → 無 → 404 `no_active_loan`
2. `UPDATE loans SET returned_at=? WHERE id=? AND returned_at IS NULL` → `changes === 0` → 404 `no_active_loan`(兩次 return 同時到,只有一個贏)
3. `UPDATE books SET status=? WHERE id=? AND status=?` ← `EVENTS.return`
4. `overdue_days = overdueDays(row.due_at, now)` — 只看步驟 1 讀到的快照,不碰 `loan_policies`
5. 回傳 row + `returned_at` + `overdue_days`

**getBook(db, bookId)** → `SELECT id, title, status FROM books WHERE id=?`(1 次)

**listUserBorrows(db, userId)** → **2 次查詢**:
1. `SELECT id FROM users WHERE id=?` → 無 → 404
2. `SELECT l.book_id, b.title, l.borrowed_at, l.due_at, l.returned_at FROM loans l JOIN books b ON b.id=l.book_id WHERE l.user_id=? ORDER BY l.borrowed_at DESC`
   → JS 依 `returned_at IS NULL` 切成 `active` / `history`,不分兩次查。

兩個 UPDATE 不包 transaction:條件式寫入已保證不會錯判,只有 crash 在兩句中間會留半套;最簡版接受,之後要補可用 D1 `batch()`。

錯誤用 `class LoanError extends Error { status, code }` 丟出,routes 轉成 `{ error: code }`。

## Routes(`src/routes/api.js`)— 硬規則 1

```js
export function createApp(clock = () => new Date().toISOString()) {
  const app = new Hono();
  app.post('/api/borrow', …)            // body {userId, bookId} 缺任一 → 400;now = clock()
  app.post('/api/return', …)            // 同上
  app.get('/api/books/:id', …)
  app.get('/api/users/:id/borrows', …)
  return app;
}
```
`clock` 注入讓測試釘死時間;`c.env.DB` 是 D1 binding;`src/index.js` 只 `export default createApp()`。

回應(camelCase):
- borrow 201 `{ id, bookId, userId, borrowedAt, dueAt, returnedAt: null }`
- return 200 上面 + `returnedAt` + `overdueDays`
- book 200 `{ id, title, status }`
- borrows 200 `{ active: [{ bookId, title, borrowedAt, dueAt, returnedAt: null }], history: [{ …, returnedAt }] }`
- 錯誤 `{ error }`,400 / 404 / 409

## 測試

`tests/helpers/db.js`:`new DatabaseSync(':memory:')` + `exec(migrations/0001_init.sql)`,
包成 `{ prepare(sql).bind(...).run() → { meta: { changes } } / .first() / .all() → { results } }`。
選項:`gate`(`run()` 遇 UPDATE 先 `await gate.wait()`)、`counter`(每次 `prepare` +1,給查詢次數斷言)。
`seedUser / seedBook` 直接 INSERT。用 Hono `app.request(path, init, { DB })`。

案例(先紅後綠):
- domain:白名單只有兩條邊;`dueAt` 依 `periodDays` 加天;`overdueDays` 準時 0、晚 23h59m = 0、晚 24h = 1、晚 2.5 天 = 2
- borrow:201 且書變 `on_loan`;已借出 409;書不存在 404;讀者不存在 404;body 缺欄位 400;**同一人再借同一本 409**
- return:200、書回 `available`、`returnedAt` = clock;再還一次 404;別人來還 404;沒借過 404;**return 之後緊接 borrow → 201**
- 快照:借出後 `UPDATE loan_policies SET loan_period_days = 30`,既有紀錄 `due_at` 不變、還書 `overdueDays` 用舊 `due_at`;新借的才是 +30
- GET book:200 / 404;borrow 前後 status 對
- GET borrows:active/history 分段正確、順序、404;**`counter` 斷言恰好 2 次 SQL**
- 併發:閘門,兩個讀者同時 borrow 同一本 → 恰好一個 201 一個 409,`returned_at IS NULL` 的列數 = 1;同一測試內迴圈 5 次,無隨機延遲

## 靜態檢查(`scripts/check-rules.sh`)

```sh
grep -rnE 'Date\.now\(|new Date\(\)' src/domain && exit 1                                       # 規則 1
grep -rnE "status\s*=\s*'" src --include='*.js' | grep -v 'src/domain/book-state.js' && exit 1  # 規則 2
```
`package.json`:`"test": "sh scripts/check-rules.sh && vitest run"`。

## 驗證

1. `npm install` → `npm test` 全綠(含靜態檢查)
2. `for i in 1 2 3 4 5; do npx vitest run tests/concurrency.test.js || break; done` 五次都綠
3. 故意在 `src/domain/loan.js` 放 `Date.now()` → `npm test` 紅;拿掉後綠
4. 有 wrangler:`npx wrangler d1 migrations apply library-loan-lab --local` → `npx wrangler dev` →
   用 curl 塞一個 user、一本 book,走 borrow / borrow(409) / return / borrow(201) / GET 兩支

## 不在範圍

devlog、罰款、預約、建書/建人 endpoint、presentation 層、git commit、GET borrows 帶逾期天數(見下)。

## 還需要你決定的

1. `GET /api/users/:id/borrows` 要不要帶 `overdueDays`?
   history 段可以用 `returned_at − due_at` 純算;active 段要用 `now`(routes 取 clock 傳進去,不違規)。
   目前計畫**不帶**,兩段都只回 `bookId, title, borrowedAt, dueAt, returnedAt`。

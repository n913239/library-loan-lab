# 借書 / 還書實作計畫

## Context

repo 目前是空殼:`src/{domain,routes,presentation}`、`tests/`、`scripts/` 都只有 `.gitkeep`,
`package.json` 只有 vitest,沒有 hono、沒有 schema、沒有 git。這是實驗協定裡的「乾淨 session」,
`docs/spec.md` / `docs/non-goals.md` 已拿掉,只剩 `CLAUDE.md` 的 5 條硬規則。

要做的事:借書(可借的書 → 借走,借期 14 天)、還書(還了立刻可借;`returned` 是終態;逾期用 `due_at` 快照算天數)。
不做:罰款、預約、新增書的 endpoint、任何 UI/登入。

## 已確認的事實

- Node v26.5,內建 `node:sqlite`(`DatabaseSync`)可用 → 測試不需要額外裝 sqlite 套件。
- `hono` 未安裝,要加;D1 binding 走 wrangler。
- 沒有 git → 不 commit(協定裡 commit 是使用者的事)。
- `AskUserQuestion` 在此 session 不可用,所以下面「假設」段落列的東西是我自己決定的,改起來都很便宜。

## 假設(可推翻)

| # | 假設 | 為什麼這樣選 |
|---|---|---|
| A1 | `userId` 從 request header `X-User-Id` 取,缺就 400 | 沒登入;CLAUDE.md 說 routes 負責「查 userId」 |
| A2 | 逾期天數 = `ceil((now − due_at) / 86400000)`,未逾期 = 0 | 晚 1 秒也算逾期,`overdue_days > 0` ⇔ 逾期,不會出現「逾期但 0 天」 |
| A3 | 還書用 `POST /loans/:loanId/return`(以借閱紀錄為主鍵,不是以書) | 「returned 是終態」是借閱紀錄的狀態;重複還同一筆 → 409 |
| A4 | 借閱紀錄的 active/returned 由 `returned_at IS NULL` 推導,**不另加 status 欄** | 少一個欄位、少一張轉移表;書的狀態才是白名單管的對象 |
| A5 | 新增 `src/db/` 放 SQL(CLAUDE.md 目錄表沒列這層) | 不想把 SQL 塞進 Hono handler;不算「加表/加欄位/加 endpoint」 |
| A6 | 書的資料靠 migration 或 `wrangler d1 execute` 塞,**不加建書 endpoint** | CLAUDE.md 明講不要主動加 endpoint |
| A7 | `src/presentation/` 這次不放東西 | API 進出全是 UTC ISO 字串,沒有時區換算需求 |

## 檔案

```
package.json                 + dependencies.hono、devDependencies.wrangler;test script 先跑 scripts/check-rules.sh
wrangler.toml                D1 binding `DB`,migrations_dir = migrations
migrations/0001_init.sql     books、loans、partial unique index(schema 唯一來源,測試也讀這檔)
src/index.js                 Worker entry:export default createApp()
src/domain/book-state.js     轉移白名單(唯一可以寫 status 字面值的地方)
src/domain/loan.js           LOAN_PERIOD_DAYS=14、dueAt(borrowedAt)、overdueDays(dueAt, now)
src/db/loans.js              borrow(db, …) / returnLoan(db, …):條件式寫入 + 檢查 changes
src/routes/loans.js          createApp(clock):2 個 endpoint;取 now、取 userId、產 loan id
scripts/check-rules.sh       靜態檢查硬規則 1、2(違反 → exit 1 → CI 紅)
tests/helpers/db.js          node:sqlite 包成 D1 形狀(prepare().bind().run()/first()),可掛閘門
tests/domain/book-state.test.js
tests/domain/loan.test.js
tests/loans.test.js          走 app.request() 的端對端
tests/concurrency.test.js    閘門式併發:兩人同時借同一本 → 恰好一人成功
```

## Schema(`migrations/0001_init.sql`)

```sql
CREATE TABLE books (
  id     TEXT PRIMARY KEY,
  title  TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
         CHECK (status IN ('available', 'on_loan'))          -- 硬規則 3 的第二道防線
);
CREATE TABLE loans (
  id          TEXT PRIMARY KEY,
  book_id     TEXT NOT NULL REFERENCES books(id),
  user_id     TEXT NOT NULL,
  borrowed_at TEXT NOT NULL,   -- UTC ISO-8601
  due_at      TEXT NOT NULL,   -- 借閱當下的快照(硬規則 5)
  returned_at TEXT,            -- NULL = 借出中;非 NULL = 終態
  CHECK (returned_at IS NULL OR returned_at >= borrowed_at)
);
-- 同一本書同一時間只能有一筆未歸還紀錄:就算 UPDATE 被繞過,這裡也擋
CREATE UNIQUE INDEX loans_one_active_per_book ON loans(book_id) WHERE returned_at IS NULL;
```

沒有借期政策表——14 天寫在 `src/domain/loan.js` 常數。

## Domain(純函式,時間從參數進)

`src/domain/book-state.js`
```js
// 白名單:available → on_loan → available,只有這兩條邊
export const EVENTS = {
  borrow: { from: 'available', to: 'on_loan' },
  return: { from: 'on_loan',   to: 'available' },
};
```
SQL 一律 `SET status = ? WHERE status = ?`,參數從 `EVENTS.borrow / EVENTS.return` 帶——
這樣硬規則 2 的 grep(`status = '...'`)在 `src/db/` 不會命中。

`src/domain/loan.js`
```js
export const LOAN_PERIOD_DAYS = 14;
export function dueAt(borrowedAt)          // ISO → ISO,+14 天(用 Date.parse + new Date(ms),不碰 new Date())
export function overdueDays(dueAt, now)    // 假設 A2:diff <= 0 ? 0 : ceil(diff / DAY_MS)
```

## DB 層(`src/db/loans.js`)— 硬規則 3

**borrow(db, { bookId, userId, loanId, now })**
1. `UPDATE books SET status=? WHERE id=? AND status=?` ← `EVENTS.borrow.to / .from`
2. `meta.changes === 0` → 查書存不存在 → 404 `book_not_found` / 409 `book_on_loan`
3. `INSERT INTO loans (…, borrowed_at=now, due_at=dueAt(now), returned_at=NULL)`
4. 回傳 loan row

**returnLoan(db, { loanId, now })**
1. `SELECT * FROM loans WHERE id=?` → 沒有 → 404 `loan_not_found`
2. `UPDATE loans SET returned_at=? WHERE id=? AND returned_at IS NULL`
3. `changes === 0` → 409 `loan_already_returned`(終態)
4. `UPDATE books SET status=? WHERE id=? AND status=?` ← `EVENTS.return`
5. `overdue_days = overdueDays(row.due_at, now)` — 只看第 1 步讀到的快照,不 JOIN 任何政策
6. 回傳 row + `returned_at` + `overdue_days`

兩個 UPDATE 不包 transaction:條件式寫入已保證不會「錯判」,只有 crash 在兩句中間會留下半套狀態,
最簡版接受;plan 裡先講清楚,之後要補可用 D1 `batch()`。

錯誤用 `class LoanError extends Error { status, code }` 丟出,route 轉成 JSON。

## Routes(`src/routes/loans.js`)— 硬規則 1

```js
export function createApp(clock = () => new Date().toISOString()) {
  const app = new Hono();
  app.post('/books/:bookId/loans', …)   // now = clock(); userId = header X-User-Id(缺→400)
  app.post('/loans/:loanId/return', …)  // now = clock()
  return app;
}
```
`clock` 注入讓測試可以釘死時間;`c.env.DB` 是 D1 binding。`src/index.js` 只 `export default createApp()`。

回應:
- 借書 201 `{ id, book_id, user_id, borrowed_at, due_at, returned_at: null }`
- 還書 200 上面 + `returned_at` + `overdue_days`
- 錯誤 `{ error: <code> }`,狀態碼 400 / 404 / 409

## 測試

`tests/helpers/db.js`:`new DatabaseSync(':memory:')`、`exec(migrations/0001_init.sql)`、
包成 `{ prepare(sql) → { bind(...a) → { run(), first() } } }`(D1 形狀,`run()` 回 `{ meta: { changes } }`)。
可選 `gate`:`run()` 遇到 `UPDATE` 先 `await gate.wait()` 再執行。
另給 `seedBook(db, id, title)`(直接 INSERT,因為沒有建書 endpoint)。

用 Hono `app.request(path, init, { DB })` 走完整 handler。

案例:
- domain:白名單只有兩條邊;`dueAt` 剛好 +14 天;`overdueDays` 準時=0、晚 1 秒=1、晚 1.5 天=2(A2 邊界)
- 借書:可借→201 且書變 `on_loan`;已借出→409;書不存在→404;沒 `X-User-Id`→400
- 還書:→200、書回 `available`、`returned_at` = clock;再還一次→409;不存在→404;還完馬上別人可借→201
- 快照:直接把 loan row 的 `due_at` 改成跟 `borrowed_at+14` 不一樣的值,還書時 `overdue_days` 必須跟著 `due_at` 走
- 併發(`tests/concurrency.test.js`):開一個閘門,兩個 `app.request` 借同一本(不同 user)並行到 UPDATE 前卡住,
  開閘 → 恰好一個 201、一個 409,`loans` 表 `returned_at IS NULL` 的列數 = 1。**迴圈 5 次**在同一測試裡,無隨機延遲。

先寫紅的再寫綠的:順序是 domain 測試 → domain;端對端測試 → migration/db/routes;併發測試最後。

## 靜態檢查(`scripts/check-rules.sh`)

```sh
grep -rnE 'Date\.now\(|new Date\(\)' src/domain && exit 1        # 規則 1
grep -rnE "status\s*=\s*'" src --include='*.js' | grep -v 'src/domain/book-state.js' && exit 1   # 規則 2
```
`package.json`:`"test": "sh scripts/check-rules.sh && vitest run"`。

## 驗證

1. `npm install` 後 `npm test` 全綠(含靜態檢查)
2. `for i in 1 2 3 4 5; do npx vitest run tests/concurrency.test.js || break; done` 五次都綠
3. 故意在 `src/domain/loan.js` 放一行 `Date.now()` → `npm test` 要紅;拿掉後綠
4. 有裝 wrangler 的話:`npx wrangler d1 migrations apply library-loan-lab --local` → `npx wrangler dev` →
   `curl -X POST -H 'X-User-Id: u1' localhost:8787/books/b1/loans` 手動走一次借/借/還/借

## 不在這次範圍

devlog(協定說那是使用者存原始輸出的地方)、罰款、預約、建書 endpoint、presentation 層、git commit。

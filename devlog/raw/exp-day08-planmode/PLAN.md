# 計畫:借閱 / 預約排隊 / 保留 48h 逾時釋放

## Context

repo 目前只有骨架(`src/domain|routes|presentation` 皆為 `.gitkeep`,無 `package.json`、無 schema、無測試)。
`docs/spec.md` 與 `docs/non-goals.md` 依實驗協定被拿掉,唯一的規格來源是 `CLAUDE.md` 五條硬規則 + README 的五條「機器可裁決」規則 + 這次的需求句:

> 讀者可以借一本可借的副本,借期 14 天;書全借出時可以預約排隊,歸還後隊首保留 48 小時,逾時自動釋放。

因為 repo 是空的,這次「實作借閱」等於從零把 schema、API、時間處理、狀態機、併發保護、測試、靜態檢查一次立起來。
CLAUDE.md 說「不要主動加表/欄位/endpoint,缺的先問」—— 下面「待確認」那節就是要問的,實作前需要你點頭。

---

## 待確認(實作前需要你回答)

1. **Schema(4 張表)**:`books`、`copies`、`loans`、`reservations`。**不建 `members` 表**,讀者身分 = JWT 的 `sub`。這 4 張是最小集合,可以嗎?
2. **Endpoint(3 條)**:
   - `POST /loans` `{copy_id}` → 借書
   - `POST /loans/:id/return` → 歸還(由借書人自己還,以 loan id 為準)
   - `POST /books/:id/reservations` → 預約排隊
   不做查詢類 GET(需求沒提)。可以嗎?
3. **保留逾時後,副本要「直接變 available」還是「順延給下一位隊首」?** 我建議順延(隊列語意才成立),但需求句只寫「釋放」。
4. **測試跑在哪**:建議 `vitest` + `@cloudflare/vitest-pool-workers`(真 workerd + 真 D1,SQL 語意跟上線一致),要 `npm install`。替代方案是 Node 內建 `node:sqlite` 加一層 D1 介面模擬,不裝 Cloudflare 工具鏈但 SQL 行為可能有出入。
5. 目錄:SQL 存取層不屬於 `domain`(有 I/O)也不該塞進 `routes`,我打算加 `src/db/`,以及 `src/index.js` 掛 `fetch` + `scheduled`(cron 觸發釋放)。可以嗎?

---

## 設計

### 狀態與時間(對應硬規則 1、2、4、5)

- `src/domain/copy-state.js`:唯一的轉移表。
  ```js
  // event → { from: to }
  borrow : { available: 'on_loan', held: 'on_loan' }
  return : { on_loan: 'available' }
  hold   : { available: 'held' }
  release: { held: 'available' }
  export function transition(from, event) // 回傳 to,不在白名單就 throw
  export const COPY_STATUS = ['available','held','on_loan']
  ```
  所有 SQL 的 `status` 一律用 **綁定參數**,值由 `transition()` 產生;原始碼裡不會出現 `status = '...'` 字面值(靜態檢查抓這個)。
- `src/domain/reservation-state.js`:`waiting → held → fulfilled | expired`,同樣輸出常數給 SQL 綁參數。
- `src/domain/loan-policy.js`:`LOAN_DAYS = 14`、`HOLD_HOURS = 48`、`dueAtFor(nowIso)`、`holdExpiresAtFor(nowIso)`。只用 `Date.parse` + `new Date(ms).toISOString()`,**不讀時鐘**。
- `src/domain/overdue.js`:`overdueDays(dueAtIso, nowIso)` = `max(0, floor((now - due)/86400000))`。只吃 `loans.due_at` 快照。
- `now` 一律由 `src/routes/*` 與 `scheduled()` 取 `new Date().toISOString()` 後往下傳。

### Schema(`migrations/0001_init.sql`)

```sql
books        (id TEXT PK, title TEXT NOT NULL)
copies       (id TEXT PK, book_id → books, status TEXT NOT NULL
              CHECK (status IN ('available','held','on_loan')))
loans        (id TEXT PK, copy_id → copies, member_id TEXT, borrowed_at TEXT, due_at TEXT, returned_at TEXT NULL)
  UNIQUE INDEX loans_active_copy ON loans(copy_id) WHERE returned_at IS NULL   -- 規則 1 第二道防線
reservations (id TEXT PK, book_id → books, member_id TEXT, status TEXT NOT NULL
              CHECK (status IN ('waiting','held','fulfilled','expired')),
              created_at TEXT, copy_id TEXT NULL, held_at TEXT NULL, hold_expires_at TEXT NULL)
  UNIQUE INDEX reservations_active ON reservations(book_id, member_id) WHERE status IN ('waiting','held')
  INDEX reservations_queue ON reservations(book_id, status, created_at, id)
```
所有時間欄位 = UTC ISO-8601 字串(規則 4)。

### 併發(規則 3):「同一前置條件貫穿整個 batch,改變前置條件的那句放最後」

D1 沒有互動式交易,但 `db.batch([...])` 是原子的。做法:每一句 SQL 的 `WHERE` 都帶同一個前置條件 **P**,
真正會讓 P 變 false 的那句放最後,所以 batch 內每句看到的都是同一份「前狀態」;
兩個並發請求會被 SQLite 序列化,第二個看到的 P 已經是 false → 全部 `changes = 0` → 409。
應用層只看 `results[i].meta.changes`,不先 SELECT 再決定。

**借書** `src/db/loans.js#borrow(db, {copyId, memberId, now})`
P = 副本 `status = available`,或 `status = held` 且存在 `reservations(copy_id, member_id, status=held, hold_expires_at > now)`
1. `INSERT INTO loans ... SELECT ?,?,?,?,? WHERE EXISTS(copies WHERE id=? AND P)`
2. `UPDATE reservations SET status=fulfilled WHERE copy_id=? AND member_id=? AND status=held`(不是保留借書時影響 0 列,無害)
3. `UPDATE copies SET status=?on_loan WHERE id=? AND P` ← 最後
→ `results[0].changes === 1` 才算成功,否則 409(副本不存在 404)。

**歸還** `src/db/loans.js#returnLoan(db, {loanId, memberId, now})`
P = `loans WHERE id=? AND member_id=? AND returned_at IS NULL` 存在
1. `UPDATE copies SET status=?available WHERE id=(loan.copy_id) AND status=?on_loan AND P`
2. `UPDATE reservations SET status=?held, copy_id=?, held_at=?, hold_expires_at=?
      WHERE id = (SELECT id FROM reservations WHERE book_id=? AND status=?waiting ORDER BY created_at, id LIMIT 1) AND P`
3. `UPDATE copies SET status=?held WHERE id=? AND status=?available
      AND EXISTS(reservations WHERE copy_id=? AND status=?held AND hold_expires_at > ?now) AND P`
4. `UPDATE loans SET returned_at=?now WHERE P` ← 最後
→ `results[3].changes === 1` 才算成功。回應帶 `overdue_days`,由 `overdueDays(loan.due_at, now)` 算(規則 5:不 JOIN 政策)。
副本走 `on_loan → available → held` 兩步,不走白名單外的 `on_loan → held`。

**預約** `src/db/reservations.js#reserve(db, {bookId, memberId, now})`
`INSERT INTO reservations ... SELECT ... WHERE EXISTS(books WHERE id=?) AND NOT EXISTS(copies WHERE book_id=? AND status=?available)`
→ `changes = 0` 表示有可借副本(409,叫他直接借);唯一索引撞到 → 409 已在隊列中。

**逾時釋放** `src/db/holds.js#releaseExpiredHolds(db, now)`
先 `SELECT id, copy_id, book_id FROM reservations WHERE status=?held AND hold_expires_at <= ?now`,對每一筆跑一個 batch,
P = 該 reservation `status=held AND hold_expires_at <= now`
1. `UPDATE copies SET status=?available WHERE id=? AND status=?held AND P`
2. (若採「順延隊首」)同歸還的第 2、3 句
3. `UPDATE reservations SET status=?expired WHERE id=? AND P` ← 最後
由 `src/index.js` 的 `scheduled()` 每 5 分鐘跑一次(wrangler `triggers.crons`);測試直接呼叫函式並傳 `now`。

### 身分(自製 JWT)

`src/routes/auth.js`:HS256 via WebCrypto,`Authorization: Bearer <jwt>`,payload `{sub, exp}`,密鑰 `env.JWT_SECRET`(`.dev.vars`,已在 .gitignore)。
無 login endpoint;`tests/helpers/jwt.js` 提供 `signToken(memberId)`。

### Routes / Presentation

- `src/routes/loans.js`:`POST /loans`、`POST /loans/:id/return`;`src/routes/reservations.js`:`POST /books/:id/reservations`。
  handler 負責:驗 JWT → 取 `now` → 產 `crypto.randomUUID()` → 呼叫 `src/db/*` → 交給 presentation → 回 JSON。
- `src/presentation/views.js`:`loanView()`、`reservationView()`,只做欄位整形;目前 API 只出 UTC ISO,所以沒有時區換算,但這是唯一允許做的地方。
- 錯誤碼:400 body 不合法、401 無/壞 token、404 找不到、409 狀態不允許。

### 靜態檢查(CLAUDE.md「CI 紅燈」)

`scripts/check-rules.sh`,`npm run check` 執行,任一命中即 exit 1:
1. `src/domain/` 內出現 `Date.now(` 或 `new Date()`
2. `src/` 內(排除 `src/domain/copy-state.js`)出現 `status = '` / `status='`
3. `src/domain/` 內 `import` 到 `../db` 或 `../routes`(純邏輯不碰 I/O)
4. `src/` 內(排除 `src/presentation/`)出現 `toLocale` / `getTimezoneOffset`

### 專案設定

- `package.json`:`hono`、devDeps `vitest`、`@cloudflare/vitest-pool-workers`、`wrangler`;scripts `test`、`check`、`ci`(check && test)。
- `wrangler.jsonc`:`main: src/index.js`、D1 binding `DB`、`triggers.crons: ["*/5 * * * *"]`、`compatibility_date`。
- `vitest.config.js`:`defineWorkersConfig`,`miniflare.d1Databases: ['DB']`,`readD1Migrations('./migrations')` → setup file `applyD1Migrations`。

---

## 測試(`tests/`,先紅後綠)

- `tests/helpers/`:`jwt.js`(簽 token)、`seed.js`(直接 INSERT books/copies)、`gate.js`(閘門:包住 `env.DB`,`batch()` 進入時等 N 個呼叫者到齊才放行)。
- `tests/domain/copy-state.test.js`:白名單內外每個組合。
- `tests/domain/overdue.test.js`:剛好到期 0 天、晚 1 秒 0 天、晚 1 天 1 天;`due_at` 快照優先於任何政策。
- `tests/borrow.test.js`:可借副本 → 201,`due_at = now + 14d`;`on_loan` 副本 → 409;`held` 給別人 → 409;`held` 給自己 → 201 且 reservation 變 `fulfilled`;保留已過期(worker 尚未跑)→ 409。
- `tests/reserve.test.js`:有可借副本 → 409;全借出 → 201 `waiting`;同人重複 → 409。
- `tests/return.test.js`:無隊列 → 副本 `available`;有隊列 → 隊首變 `held`、`hold_expires_at = now + 48h`、副本 `held`;非借書人 → 404/409;重複歸還 → 409;`overdue_days` 用快照算(歸還時傳一個比 `due_at` 晚 3 天的 `now`)。
- `tests/expire.test.js`:`now < expires` 不動;`now >= expires` → reservation `expired`、副本 `available`(或順延下一位,依待確認 3);重跑一次冪等。
- `tests/concurrency.test.js`:**閘門**讓兩個 `POST /loans` 同一副本同時進到 `batch()`,斷言剛好一個 201 一個 409、`loans` 只有一筆 active;同法測兩人同時歸還/兩個歸還同時搶隊首。`for (let i=0;i<5;i++)` 重跑 5 次結果一致。

## 驗證

1. `npm run check` 綠(靜態規則)。
2. `npm test` 綠,併發測試檔內建 5 次重跑。
3. `npx wrangler dev --local` + `wrangler d1 migrations apply DB --local`,用 curl 走一遍:借 → 第二人借同副本 409 → 第二人預約 201 → 第一人還 → 第二人的 reservation `held` → 第二人借 201。
4. `devlog/raw/` 存這次的原始輸出;commit message 中文、標「AI 版」、無 AI 署名 trailer(目前不是 git repo,commit 由你決定要不要 `git init`)。

## 檔案清單

```
package.json  wrangler.jsonc  vitest.config.js  migrations/0001_init.sql
src/index.js                       fetch + scheduled
src/domain/copy-state.js           轉移表(唯一)
src/domain/reservation-state.js
src/domain/loan-policy.js          14 天 / 48 小時
src/domain/overdue.js
src/db/loans.js  src/db/reservations.js  src/db/holds.js
src/routes/auth.js  src/routes/loans.js  src/routes/reservations.js
src/presentation/views.js
scripts/check-rules.sh
tests/helpers/{jwt,seed,gate}.js  tests/setup.js  tests/**/*.test.js
```

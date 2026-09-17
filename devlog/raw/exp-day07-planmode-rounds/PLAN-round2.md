# 計畫:借閱 / 預約排隊 / 保留 48h 逾時釋放(修訂版)

## Context

repo 目前只有骨架(`src/domain|routes|presentation` 皆為 `.gitkeep`,無 `package.json`、無 schema、無測試)。
`docs/spec.md` 與 `docs/non-goals.md` 依實驗協定被拿掉,規格來源 = `CLAUDE.md` 五條硬規則 + README 五條「機器可裁決」規則 + 需求句
「讀者可以借一本可借的副本,借期 14 天;書全借出時可以預約排隊,歸還後隊首保留 48 小時,逾時自動釋放」+ 你在第二輪的裁決:

- Schema 6 張:`readers`(含 `role`)、`loan_policies`(一列,借期存這裡)、`books`、`copies`、`loans`、`reservations`
- Endpoint 5 條:`POST /books/:id/loans`(系統挑副本)、`POST /loans/:id/return`(本人或館員)、`POST /books/:id/reservations`、`DELETE /reservations/:id`(僅本人)、`POST /holds/:id/checkout`(僅本人)
- 保留逾時 → 順延給下一位隊首;沒人排隊才變 `available`
- vitest,先不裝 Cloudflare 工具鏈;domain 純函式測試優先,D1 SQL 語意之後再驗
- 可加 `src/db/`、`src/index.js`
- 同一讀者對同一本書:只能有一筆進行中的借閱,也只能排一次隊

---

## 設計

### 1. 時間與狀態(硬規則 1、2、4、5)

- `src/domain/copy-state.js` —— 唯一的轉移表,SQL 裡的 `status` 一律用綁定參數,值由這裡產生:
  ```js
  // event → { from: to }
  borrow  : { available: 'on_loan' }          // POST /books/:id/loans
  checkout: { held: 'on_loan' }               // POST /holds/:id/checkout
  return  : { on_loan: 'available' }
  hold    : { available: 'held' }
  release : { held: 'available' }
  export function transition(from, event)     // 回傳 to,不在白名單就 throw
  ```
- `src/domain/reservation-state.js` —— `waiting → held | cancelled`、`held → fulfilled | expired | cancelled`,同樣輸出常數給 SQL 綁參數。
- `src/domain/roles.js` —— `ROLES = { reader, staff }`,常數給 SQL 綁參數。
- `src/domain/loan-policy.js` —— `dueAtFor(nowIso, loanDays)`、`holdExpiresAtFor(nowIso, holdHours)`。只用 `Date.parse` + `new Date(ms).toISOString()`,**不讀時鐘**;`loanDays` 從 `loan_policies` 讀出後當參數傳入。
- `src/domain/overdue.js` —— `overdueDays(dueAtIso, nowIso)` = `max(0, floor((now − due) / 86400000))`。只吃 `loans.due_at` 快照。
- `now` 一律由 `src/routes/*` 與 `scheduled()` 取 `new Date().toISOString()` 後往下傳;domain 與 db 層都只接參數。

### 2. Schema(`migrations/0001_init.sql`)

```sql
readers       (id TEXT PK, role TEXT NOT NULL CHECK (role IN ('reader','staff')))
                -- 只能用 SQL 改 role,沒有 endpoint
loan_policies (id INTEGER PK CHECK (id = 1), loan_days INTEGER NOT NULL)
                -- 單列;0001 migration 內 INSERT (1, 14)
books         (id TEXT PK, title TEXT NOT NULL)
copies        (id TEXT PK, book_id → books, status TEXT NOT NULL
               CHECK (status IN ('available','held','on_loan')))
loans         (id TEXT PK, copy_id → copies, book_id → books, reader_id → readers,
               borrowed_at TEXT, due_at TEXT, returned_at TEXT NULL)
  UNIQUE INDEX loans_active_copy   ON loans(copy_id)            WHERE returned_at IS NULL  -- 規則 1 第二道防線
  UNIQUE INDEX loans_active_reader ON loans(reader_id, book_id) WHERE returned_at IS NULL  -- 一人一書一筆進行中
reservations  (id TEXT PK, book_id → books, reader_id → readers, status TEXT NOT NULL
               CHECK (status IN ('waiting','held','fulfilled','expired','cancelled')),
               created_at TEXT, copy_id TEXT NULL, held_at TEXT NULL, hold_expires_at TEXT NULL)
  UNIQUE INDEX reservations_active ON reservations(book_id, reader_id) WHERE status IN ('waiting','held')  -- 一人一書排一次
  INDEX reservations_queue ON reservations(book_id, status, created_at, id)
```
`loans.book_id` 是刻意的反正規化:沒有它就做不出 `(reader_id, book_id)` 的 partial unique index 當第二道防線。
所有時間欄位 = UTC ISO-8601 字串。「保留」(hold)不是獨立的表,就是 `reservations.status = 'held'` 那一列,`/holds/:id` 的 `:id` 就是 reservation id。

### 3. 身分

`src/routes/auth.js`:HS256 via WebCrypto,`Authorization: Bearer <jwt>`,payload `{sub, exp}`,密鑰 `env.JWT_SECRET`(`.dev.vars`,已在 .gitignore)。
驗簽後 `SELECT id, role FROM readers WHERE id = sub`,查不到 → 401;`role` **以資料表為準,不信 JWT 裡的宣稱**。掛到 `c.var.reader = { id, role }`。
無 login / 註冊 endpoint;`readers` 只靠 SQL 塞。

### 4. 併發(硬規則 3):「同一前置條件貫穿整個 batch,改變前置條件的那句放最後」

D1 沒有互動式交易,但 `db.batch([...])` 是原子的。每句 SQL 的 `WHERE` 都帶同一個前置條件 **P**,真正讓 P 變 false 的那句放最後;
兩個並發請求被 SQLite 序列化,第二個看到的 P 已是 false → 全部 `changes = 0` → 409。應用層只看 `results[i].meta.changes`。
需要「系統挑副本」時,用 **先 INSERT loan(SELECT 挑副本)、再用已知的 loan id 反查 copy_id** 把兩句串起來,不必先 SELECT 再寫。
`changes = 0` 之後才允許做一次 SELECT,純粹是為了回 404 / 403 / 409 哪一個 —— 寫入已經被拒絕了,這個讀不參與決策。

**借書** `POST /books/:id/loans` → `src/db/loans.js#borrow(db, { bookId, readerId, loanId, now, dueAt })`
route 先 `SELECT loan_days FROM loan_policies WHERE id = 1`,`dueAt = dueAtFor(now, loan_days)`(這是規則 5 要的快照)。
P = 該讀者對此書無進行中借閱 `NOT EXISTS (loans WHERE reader_id=? AND book_id=? AND returned_at IS NULL)`
1. `INSERT INTO loans (id, copy_id, book_id, reader_id, borrowed_at, due_at)
      SELECT ?loanId, c.id, c.book_id, ?reader, ?now, ?dueAt FROM copies c
      WHERE c.book_id = ? AND c.status = ?available AND P ORDER BY c.id LIMIT 1`
2. `UPDATE copies SET status = ?on_loan
      WHERE id = (SELECT copy_id FROM loans WHERE id = ?loanId) AND status = ?available` ← 靠 loanId 串起來,第 1 句沒插就是 NULL → 0 changes
→ `results[0].changes === 1` 才成功(201);0 → 書不存在 404 / 已借此書 409 / 全借出 409(提示可預約)。

**保留兌換** `POST /holds/:id/checkout` → `src/db/loans.js#checkout(db, { reservationId, readerId, loanId, now, dueAt })`
P = `reservations WHERE id=? AND reader_id=? AND status=?held AND hold_expires_at > ?now`
1. `INSERT INTO loans ... SELECT ?loanId, r.copy_id, r.book_id, ?reader, ?now, ?dueAt FROM reservations r WHERE P`
2. `UPDATE copies SET status=?on_loan WHERE id = (SELECT copy_id FROM loans WHERE id=?loanId) AND status=?held`
3. `UPDATE reservations SET status=?fulfilled WHERE P` ← 最後
→ `results[0].changes === 1` 才成功;0 → 404 / 403(不是本人)/ 409(不是 held 或已過期)。

**歸還** `POST /loans/:id/return` → `src/db/loans.js#returnLoan(db, { loanId, actor: {id, role}, now, holdExpiresAt })`
P = `loans WHERE id=? AND returned_at IS NULL AND (reader_id = ?actor OR ?role = ?staff)`
1. `UPDATE copies SET status=?available WHERE id=(SELECT copy_id FROM loans WHERE id=?) AND status=?on_loan AND P`
2. `UPDATE reservations SET status=?held, copy_id=(loan.copy_id), held_at=?now, hold_expires_at=?
      WHERE id = (SELECT id FROM reservations WHERE book_id=(loan.book_id) AND status=?waiting ORDER BY created_at, id LIMIT 1) AND P`
3. `UPDATE copies SET status=?held WHERE id=(loan.copy_id) AND status=?available
      AND EXISTS (reservations WHERE copy_id=copies.id AND status=?held AND hold_expires_at > ?now) AND P`
4. `UPDATE loans SET returned_at=?now WHERE P` ← 最後
→ `results[3].changes === 1` 才成功。回應含 `overdue_days = overdueDays(loan.due_at, now)`(規則 5:不 JOIN `loan_policies`)。
副本走 `on_loan → available → held` 兩步,不走白名單外的 `on_loan → held`。

**預約** `POST /books/:id/reservations` → `src/db/reservations.js#reserve(db, { bookId, readerId, reservationId, now })`
```sql
INSERT INTO reservations (id, book_id, reader_id, status, created_at)
SELECT ?, ?, ?, ?waiting, ?now
WHERE EXISTS (books WHERE id=?)
  AND NOT EXISTS (copies WHERE book_id=? AND status=?available)
  AND NOT EXISTS (loans WHERE reader_id=? AND book_id=? AND returned_at IS NULL)   -- 見「待你決定 2」
```
→ `changes = 0` → 404 / 409(有可借副本,直接借)/ 409(已借此書);唯一索引撞到(SQLITE_CONSTRAINT)→ 409 已在隊列中。

**取消排隊** `DELETE /reservations/:id` → `src/db/reservations.js#cancel(db, { reservationId, readerId, now, holdExpiresAt })`
P = `reservations WHERE id=? AND reader_id=? AND status IN (?waiting, ?held)`
1. `UPDATE copies SET status=?available WHERE id=(r.copy_id) AND status=?held AND P` (waiting 的 copy_id 是 NULL → 0 changes,無害)
2. 隊首順延:同歸還的第 2、3 句,但子查詢排除 `id = ?reservationId`
3. `UPDATE reservations SET status=?cancelled WHERE P` ← 最後
→ `results[2].changes === 1` 才成功(204);0 → 404 / 403 / 409(已 fulfilled/expired/cancelled)。

**逾時釋放** `src/db/holds.js#releaseExpiredHolds(db, now, holdExpiresAt)`
`SELECT id, copy_id, book_id FROM reservations WHERE status=?held AND hold_expires_at <= ?now`,每筆一個 batch,
P = `reservations WHERE id=? AND status=?held AND hold_expires_at <= ?now`
1. `UPDATE copies SET status=?available WHERE id=? AND status=?held AND P`
2. 隊首順延:同歸還的第 2、3 句(第 3 句的 EXISTS 以 `hold_expires_at > ?now` 自然排除正在過期的這筆)
3. `UPDATE reservations SET status=?expired WHERE P` ← 最後
沒人排隊 → 第 2 步 0 changes,副本停在 `available`。`src/index.js` 的 `scheduled()` 每 5 分鐘跑(`wrangler.jsonc` `triggers.crons`);測試直接呼叫並傳 `now`,可重跑(冪等)。

### 5. Routes / Presentation

- `src/routes/loans.js`:`POST /books/:id/loans`、`POST /loans/:id/return`、`POST /holds/:id/checkout`
- `src/routes/reservations.js`:`POST /books/:id/reservations`、`DELETE /reservations/:id`
- handler 職責:`auth` middleware → 取 `now` → 讀 `loan_policies` 算 `dueAt` / `holdExpiresAt`(都是 domain 函式)→ `crypto.randomUUID()` → 呼叫 `src/db/*` → `src/presentation/views.js` 整形 → JSON。
- 錯誤碼:400 body 不合法、401 無/壞 token/`sub` 不在 `readers`、403 不是本人、404 找不到、409 狀態不允許。
- `src/presentation/views.js`:`loanView()`、`reservationView()` 只做欄位整形;目前 API 只出 UTC ISO,無時區換算,但這是唯一允許做的地方。

### 6. 靜態檢查(CLAUDE.md「CI 紅燈」)

`scripts/check-rules.sh`,`npm run check` 執行,任一命中即 exit 1:
1. `src/domain/` 出現 `Date.now(` 或 `new Date()`
2. `src/`(排除 `src/domain/copy-state.js`)出現 `status = '` / `status='`
3. `src/domain/` `import` 到 `../db`、`../routes` 或任何 `cloudflare:` / `hono`
4. `src/`(排除 `src/presentation/`)出現 `toLocale` / `getTimezoneOffset`
5. `src/db/` 出現 `JOIN loan_policies`(規則 5)

### 7. 專案設定

- `package.json`:`type: module`,deps `hono`;devDeps `vitest`;scripts `test`、`check`、`ci`(check && test)。**不裝** `wrangler` / `@cloudflare/vitest-pool-workers`。
- `wrangler.jsonc`:`main: src/index.js`、D1 binding `DB`、`triggers.crons: ["*/5 * * * *"]`、`compatibility_date`。先寫好,部署工具之後再裝。
- `migrations/0001_init.sql`:上面的 schema + `loan_policies` 種子列。
- `vitest.config.js`:純 Node 環境,`include: tests/**/*.test.js`。

---

## 測試(`tests/`,先紅後綠)

這一輪能跑的只有 domain 純函式;db / routes / 併發測試需要 D1,先把測試檔寫好並 `describe.skip`,檔頭註明「等 D1 工具鏈」。

**現在就跑(vitest)**
- `tests/domain/copy-state.test.js`:5 個 event × 3 個狀態,白名單內回傳 to、外面 throw;`transition` 不會產生 `'on_loan' → 'held'`。
- `tests/domain/reservation-state.test.js`:同上。
- `tests/domain/loan-policy.test.js`:`dueAtFor('2026-09-17T00:00:00.000Z', 14)` = `2026-10-01T00:00:00.000Z`;`holdExpiresAtFor(now, 48)` = +2d;跨月、跨年;輸出永遠以 `Z` 結尾。
- `tests/domain/overdue.test.js`:剛好到期 0、晚 1 秒 0、晚 1 天 1、晚 3 天 1 秒 3;提早還 0;只吃 `due_at`,傳不同政策值不影響結果(其實根本沒參數可傳)。

**先寫、先 skip(等 D1)**
- `tests/db/borrow.test.js`:有可借 → 201 且挑 `ORDER BY id` 最小的;全借出 → 409;已借此書 → 409;書不存在 → 404;`due_at` = `now + loan_policies.loan_days`。
- `tests/db/checkout.test.js`:本人 + 未過期 → 201、reservation `fulfilled`;非本人 → 403;過期但 worker 未跑 → 409;`waiting` 狀態 → 409。
- `tests/db/return.test.js`:無隊列 → `available`;有隊列 → 隊首 `held`、`hold_expires_at = now + 48h`、副本 `held`;館員可還別人的;非本人非館員 → 403;重複歸還 → 409;`overdue_days` 用快照(歸還前把 `loan_policies.loan_days` 改成 1,結果不變)。
- `tests/db/reserve.test.js`:有可借 → 409;全借出 → 201 `waiting`;重複 → 409;已借此書 → 409(依待決定 2)。
- `tests/db/cancel.test.js`:`waiting` → 204;`held` → 204 且副本順延下一位 / 無人則 `available`;非本人 → 403;已 fulfilled → 409。
- `tests/db/expire.test.js`:`now < expires` 不動;`now >= expires` → `expired`、順延下一位;無人排隊 → `available`;重跑冪等。
- `tests/db/concurrency.test.js`:閘門(`tests/helpers/gate.js` 包住 `env.DB.batch()`,N 個呼叫者到齊才放行)讓兩個 `POST /books/:id/loans` 搶最後一本副本 → 剛好一個 201 一個 409、`loans` 只有一筆 active;兩個歸還同時搶隊首 → 隊首只被 held 一次。外層 `for (i < 5)` 重跑,結果一致。
- `tests/helpers/`:`jwt.js`(簽 token)、`seed.js`(直接 INSERT readers/books/copies)、`gate.js`。

## 驗證

1. `npm run check` 綠。
2. `npm test` 綠(domain 全綠,db 系列顯示 skipped 而非 failed)。
3. D1 工具鏈裝好後:拿掉 `describe.skip`,`npm test` 全綠;`wrangler dev --local` 用 curl 走:A 借 → B 借同書 409 → B 預約 201 → A 還 → B 的 reservation `held` → B `POST /holds/:id/checkout` 201。
4. `devlog/raw/` 存這次原始輸出;commit message 中文、標「AI 版」、無 AI 署名 trailer(目前不是 git repo,`git init` 由你決定)。

## 檔案清單

```
package.json  wrangler.jsonc  vitest.config.js  migrations/0001_init.sql
src/index.js                          fetch + scheduled
src/domain/copy-state.js              轉移表(唯一)
src/domain/reservation-state.js
src/domain/roles.js
src/domain/loan-policy.js             dueAtFor / holdExpiresAtFor
src/domain/overdue.js
src/db/loans.js                       borrow / checkout / returnLoan
src/db/reservations.js                reserve / cancel
src/db/holds.js                       releaseExpiredHolds
src/routes/auth.js  src/routes/loans.js  src/routes/reservations.js
src/presentation/views.js
scripts/check-rules.sh
tests/domain/*.test.js  tests/db/*.test.js(skip)  tests/helpers/{jwt,seed,gate}.js
```

---

## 還需要你決定的

1. **`hold_hours`(48)放哪**:跟 `loan_days` 一樣放進 `loan_policies` 當第二個欄位(建議,同樣在歸還當下快照進 `reservations.hold_expires_at`),還是留在 domain 當常數?
2. **已借此書的人能不能再排隊同一本**:我建議不能(409),上面 `reserve` 的 P 已含這條;若你要允許,拿掉那個 `NOT EXISTS` 即可。
3. **`DELETE /reservations/:id` 對 `held` 狀態**:我建議允許(釋放副本、順延隊首),因為保留中的人仍在隊列裡;若你認為保留了就不能取消,改回 409。
4. **`loans.book_id` 反正規化欄位**:為了「一人一書一筆進行中」的 partial unique index 第二道防線。若不接受,這條規則只靠 SQL `WHERE` 一道防線。

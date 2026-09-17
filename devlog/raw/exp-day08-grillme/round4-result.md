**Frontier 清空。** 每個分支都到葉子了,沒有剩下靜默假設的地方。以下是把 Q26、Q27 定案後的最終版摘要。

## 設計樹(最終版)

### 1. 測試與基礎設施
- **D1 層**:`@cloudflare/vitest-pool-workers` + miniflare;**domain 純函式測試先寫先跑**,D1 層等工具鏈裝好再補。
- **時鐘**:`createApp({ db, clock })`,cron 的 `scheduled()` 吃同一個 `clock`;測試給可撥假鐘。
- **時間格式**:全站唯一 `Date#toISOString()`(含毫秒),一個 `toIso()` helper;domain 用 `Date.parse` 比,現有 `tests/hold.test.js` fixture 不用改。
- **目錄**:新增 `src/db/`(語句 + batch 組裝;`copies` 的轉移句從 `copy-state.js` 的表生成),CLAUDE.md 目錄表補一行。

### 2. 狀態模型
- **副本白名單不動**:`available→on_loan→available`、`available→held→on_loan|available`。所有釋放都經過 `available`;`on_loan→held`、`held→held` 不存在。
- **預約**:`queued→held→fulfilled|expired|cancelled`、`queued→cancelled`;補 `held→cancelled`。
- **hold 不是表**:`reservations` 一張表,`held` 時帶 `copy_id` + `expires_at`;`/holds/:id` 的 id = reservation id。
- **不變式**(每句 SQL 的 WHERE 只寫這些):
  1. 有 active loan 的 copy 必為 `on_loan`;沒有的不可為 `on_loan`。
  2. 被 `held` reservation 指到的 copy 必為 `held`;`held` 的 copy 必有人指。
  3. 有 `available` 副本 ⇒ 本書無人 `queued`(allocate 維持;直接借書用 `NOT EXISTS queued` 守)。
  4. 同一 (reader, book) 同時最多一個 `{active, queued, held}`。

### 3. Schema
- `loan_policies`(一列):`loan_days`、`hold_hours`(新欄)。
- `loans`:`reader_id`、`book_id`(新欄)、`copy_id`、`borrowed_at`、`due_at`、`returned_at`、`overdue_days`、`status ∈ {active, returned}`。不存 `reservation_id`。
- `reservations`:`reader_id`、`book_id`、`copy_id?`、`expires_at?`、`status`、`created_at`;隊首 = `queued` 中 `id` 最小。
- **第二道防線(三個 partial unique index,定案)**:
  - `loans(copy_id) WHERE status='active'` — 同一副本不雙借
  - `loans(reader_id, book_id) WHERE status='active'`
  - `reservations(reader_id, book_id) WHERE status IN ('queued','held')`
- `book_id` 與 copy 一致性不驗。CHECK 只驗 enum 與「held ⇒ copy_id / expires_at 非空」。跨表的不變式 4 只有 `NOT EXISTS`,沒有第二道。

### 4. 每條寫入的形狀(定案)
```
pre-read(只讀不可變/政策資料:loan_policies、loan.due_at、reservation.copy_id …)
batch [
  expire:UPDATE reservations → expired WHERE book_id=B AND status='held' AND expires_at <= now   ← 集合式,一句清完
  釋放:UPDATE copies → available WHERE book_id=B AND status='held' AND NOT EXISTS held reservation 指到它
  allocate 一對:最小 id available copy × 最小 id queued;expires_at = now + hold_hours
  意圖語句(完整商業前置條件都在它的 WHERE)
  跟隨語句(只守不變式,不依賴前一句成功)
]
意圖語句 changes=0 → 再 SELECT 一次決定 404 / 403 / 409(先寫再解釋)
```
同一本書同時兩筆過期、兩人排隊時,第二對留給 cron;中間暫態因不變式 3 的守衛對外不可觀察 — 這是接受的行為。

- **借**:意圖 = `INSERT loans … SELECT available copy WHERE NOT EXISTS queued AND NOT EXISTS 讀者關係`;跟隨 = copy→on_loan WHERE 有 active loan。
- **還**:意圖 = `UPDATE loans → returned`(`overdue_days` = JS `floor`,用 pre-read 的 `due_at`);跟隨 = copy→available WHERE 無 active loan;allocate。
- **預約**:意圖 = `INSERT reservations(queued) WHERE EXISTS 任何副本 AND NOT EXISTS available AND NOT EXISTS 讀者關係`。
- **取消**:意圖 = `UPDATE reservations → cancelled WHERE reader_id=me AND status IN (queued, held)`;跟隨 = 釋放 copy;allocate。
- **取書**:意圖 = `INSERT loans … FROM reservations WHERE id=? AND reader_id=me AND status='held' AND expires_at > now`;跟隨 = reservation→fulfilled、copy→on_loan。重送被 `status≠held` 自然擋。
- **新增副本**(館藏 feature):走同一個 allocate。
- **cron**(每 5 分鐘):每筆過期各一個 batch:expire → 釋放 → allocate。
- 邊界:有效 ⟺ `now < expires_at`;sweep 用 `<=`、checkout 用 `>`。

### 5. 授權與錯誤
- 「讀者」= 任何登入者,館員也能借/排;還書「本人或館員」進 WHERE(館員時不帶 `reader_id`)。
- 409 = 所有 domain 拒絕;403 = 非本人/非館員;404 = id 不存在。

### 6. 讀取
- `GET /books/:id`:副本數 = 全部;可借數 = `available`;排隊人數 = `queued`。GET 不 sweep,略舊接受。

### 7. 測試清單
- **domain(先紅先跑)**:`canCheckout`(現有)、`overdueDays` floor 邊界、`dueAt` / `holdExpiresAt` 快照、`copy-state` 白名單拒絕 `on_loan→held`。
- **D1**:spec 九條規則各一支 + 三方五支(A 過期 409 / B 順延並可取 / 無 B 時 C 借到 / 有 B 時 C 409 / 閘門 A(T−1ms) vs C(T) 恰一人拿到)。閘門測試重跑 5 次要一致。

### 8. 要回寫到文件的變更
- **spec**:狀態機圖(經 available)、`held→cancelled`、直接借書的 `NOT EXISTS queued`、預約前置(有可借 / 零副本皆 409)、`overdue_days = floor`、錯誤碼三種、cron 5 分鐘、每條寫入先 expire + allocate。
- **CLAUDE.md**:目錄表加 `src/db/`。
- **Migration**:`loan_policies.hold_hours`、`loans.book_id`、三個 partial unique index。

拷問到此結束。我沒有動任何檔案;要開始的話你說一聲,照 Q1 的順序先從 domain 純函式的紅測試起手。
兩個小分支還開著,問完 frontier 就空了。這輪一起附上整棵樹的摘要,Q26/Q27 的地方標「待定」。

---

❓ **Q26** - **請求內的 expire 是「集合式、同 batch」還是「重用 sweep、分 batch」?**:Q16(a) 說每條寫入先 expire + allocate;Q20(a) 說 allocate 永遠一對、cron sweep 每筆過期各開一個 batch。兩者在「同一本書同時兩筆過期、兩人排隊」時打架:
(a) **同一個 batch**:`UPDATE reservations … expired WHERE book_id=B AND status='held' AND expires_at <= now`(一句清完)、釋放 copy 一句、allocate **一對**、再接主語句。第二對留給 ≤5 分鐘後的 cron;中間那個「available 副本 + 有人 queued」的暫態,因為直接借書已被 `NOT EXISTS queued` 擋住,對外不可觀察;
(b) 主 batch 之前先呼叫 `sweep(db, now, {bookId: B})`— 跟 cron 同一段程式、每筆各一個 batch — 然後主 batch 自己再 allocate。

➡️ (a)。一個請求 = 一個原子 batch,測試推理最單純;spec 的競態場景最多一筆過期,暫態碰不到。代價是 expire 有兩份寫法(請求內集合式、cron 逐筆),但兩份用的守衛條件字面相同。

---

❓ **Q27** - **「同一副本不雙借」要不要第二道防線?**:硬規則 3 說「用 `CHECK` 當第二道防線」,但 SQLite 的 CHECK 不能跨列,能當第二道的是 partial unique index。
(a) `loans` 加 `UNIQUE(copy_id) WHERE status='active'`;若 WHERE 守衛有洞,INSERT 會炸 → batch 整個 rollback;
(b) 只靠 WHERE。

➡️ (a)。這是整個專案最重要的規則,值得兩道。跟 Q19 的兩個 partial unique index 一起放 migration。

---

## 設計樹摘要(待你確認後才動手)

### 1. 測試與基礎設施
- **D1 層**:`@cloudflare/vitest-pool-workers` + miniflare;**domain 純函式測試先寫先跑**,D1 層等工具鏈裝好再補(Q1)。
- **時鐘**:`createApp({ db, clock })`,cron 的 `scheduled()` 也吃同一個 `clock`;測試給可撥假鐘(Q14)。
- **時間格式**:全站唯一 `Date#toISOString()`(含毫秒),一個 `toIso()` helper;SQL 字串比較才不會在「等於」那一刻比錯;domain 用 `Date.parse` 比,現有 fixture 不用改(Q23)。
- **目錄**:新增 `src/db/`(語句 + batch 組裝;`copies` 的轉移句從 `copy-state.js` 的表生成),CLAUDE.md 目錄表補一行(Q24)。

### 2. 狀態模型
- **副本白名單不動**:`available→on_loan→available`、`available→held→on_loan|available`。**所有釋放都經過 `available`**,`on_loan→held`、`held→held` 不存在(Q3)。spec 狀態機圖要改。
- **預約**:`queued→held→fulfilled|expired|cancelled`、`queued→cancelled`;**補 `held→cancelled`**(Q5)。
- **hold 不是表**:`reservations` 一張表,`status='held'` 時帶 `copy_id` + `expires_at`;`/holds/:id` 的 id 就是 reservation id(Q4)。
- **不變式**(每句 SQL 的 WHERE 只寫這些):
  1. 有 active loan 的 copy 必為 `on_loan`;沒有的 copy 不可為 `on_loan`。
  2. 被 `held` reservation 指到的 copy 必為 `held`;`held` 的 copy 必有人指。
  3. 有 `available` 副本 ⇒ 本書無人 `queued`(靠 allocate 維持,直接借書用 `NOT EXISTS queued` 守)。
  4. 同一 (reader, book) 同時最多一個 `{active, queued, held}`(Q6)。

### 3. Schema(只列本 feature 決定的)
- `loan_policies`(一列):`loan_days`、**`hold_hours`(新欄,Q11)**。
- `loans`:`reader_id`、**`book_id`(新欄,Q19)**、`copy_id`、`borrowed_at`、`due_at`、`returned_at`、`overdue_days`、`status ∈ {active, returned}`。**不存 `reservation_id`**(Q21)。
- `reservations`:`reader_id`、`book_id`、`copy_id?`、`expires_at?`、`status`、`created_at`;隊首 = `queued` 中 `id` 最小(Q12)。
- 第二道防線(partial unique):`loans(reader_id, book_id) WHERE active`、`reservations(reader_id, book_id) WHERE queued|held`(Q19)、**`loans(copy_id) WHERE active`(Q27 待定)**。`book_id` 與 copy 一致性不驗。CHECK 只驗 enum 與「held ⇒ copy_id/expires_at 非空」。
- 跨表的不變式 4 只有 WHERE `NOT EXISTS`,沒有第二道。

### 4. 每條寫入的形狀(Q16、Q18、Q20、Q22、Q26)
```
pre-read(不可變/政策資料:loan_policies、loan.due_at、reservation.copy_id …)
batch [
  expire 本書過期保留(集合式,Q26 待定)
  釋放沒人指的 held copy
  allocate 一對(最小 id available copy × 最小 id queued;expires_at = now + hold_hours)
  意圖語句(完整商業前置條件都在它的 WHERE)
  跟隨語句(只守不變式,不依賴前一句成功)
]
意圖語句 changes=0 → 再 SELECT 一次決定 404 / 403 / 409(先寫再解釋)
```
- **借**:意圖 = `INSERT loans … SELECT available copy WHERE NOT EXISTS queued AND NOT EXISTS 讀者關係`;跟隨 = copy→on_loan WHERE 有 active loan。
- **還**:意圖 = `UPDATE loans → returned`(`overdue_days` 由 JS `floor` 算,pre-read 的 `due_at`,Q10/Q22);跟隨 = copy→available WHERE 無 active loan;allocate。
- **預約**:意圖 = `INSERT reservations(queued) WHERE EXISTS 任何副本 AND NOT EXISTS available AND NOT EXISTS 讀者關係`(Q8)。
- **取消**:意圖 = `UPDATE reservations → cancelled WHERE reader_id=me AND status IN (queued, held)`;跟隨 = 釋放 copy;allocate。
- **取書**:意圖 = **`INSERT loans … FROM reservations WHERE status='held' AND expires_at > now AND reader_id=me`**(不是先改 reservation — 意圖擺在 INSERT,重送才會被 `status≠held` 自然擋掉,不需要 `reservation_id`);跟隨 = reservation→fulfilled、copy→on_loan。
- **新增副本**(館藏 feature,但走同一個 allocate,Q7)。
- **cron**(每 5 分鐘):每筆過期各一個 batch:expire → 釋放 → allocate。
- 邊界:有效 ⟺ `now < expires_at`;sweep 用 `<=`、checkout 用 `>`(Q9)。

### 5. 授權與錯誤
- 「讀者」= 任何登入者,館員也能借/排(Q15);還書「本人或館員」進 WHERE(館員時不帶 `reader_id`)。
- 409 = 所有 domain 拒絕;403 = 非本人/非館員;404 = id 不存在(Q13)。

### 6. 讀取
- `GET /books/:id`:副本數 = 全部;可借數 = `available`;排隊人數 = `queued`。GET 不 sweep,略舊接受(Q25)。

### 7. 測試清單
- **domain(先紅先跑)**:`canCheckout`(現有)、`overdueDays` floor 邊界、`dueAt`/`holdExpiresAt` 快照、`copy-state` 白名單拒絕 `on_loan→held`。
- **D1**:spec 九條規則各一支 + **三方五支**(A 過期 409 / B 順延並可取 / 無 B 時 C 借到 / 有 B 時 C 409 / 閘門 A(T−1ms) vs C(T) 恰一人拿到)(Q17)。閘門測試重跑 5 次要一致。

### 8. 要回寫到文件的變更
spec:狀態機圖(經 available)、`held→cancelled`、直接借書的 `NOT EXISTS queued`、預約前置(有可借/零副本皆 409)、`overdue_days = floor`、錯誤碼三種、cron 5 分鐘。
CLAUDE.md:目錄表加 `src/db/`。
Migration:`loan_policies.hold_hours`、`loans.book_id`、三個 partial unique index。

Q26、Q27 答完,如果沒有新分支,frontier 就清空了。
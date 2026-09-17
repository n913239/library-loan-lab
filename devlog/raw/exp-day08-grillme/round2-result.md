第一輪全部收到。Q10 選 floor 的理由成立,記下。以下第二輪,都是前面答案打開的問題。

---

❓ **Q16** - **每條寫入請求先替「這本書」做一次 lazy sweep?**:Q2(c) 說 WHERE 帶 `expires_at > now` 保正確性。但 spec 的測試「時間推 48h 後,無人排隊時副本**已** `available`」— 如果只有 cron 會做 expire+allocate,測試就得先手動呼叫 `sweep(now)`,而且直接來借的人(第三方)在 cron 跑之前會吃到 409(副本還是 `held`)。
(a) 每條對書的寫入(借/預約/取消/取書/歸還/新增副本)的 batch 開頭先跑 `expireHolds(book, now)` + `allocate(book)`,cron 只服務「只 GET 不寫」的人;
(b) 只有 cron 做,寫入路徑只擋不清。

➡️ (a)。三方競態的結果就不依賴 cron 有沒有剛好跑過;測試也不用先呼叫 sweep。代價是每個 batch 多兩三句。

---

❓ **Q17** - **三方競態測試矩陣**:我打算釘這五支,每支獨立檔案。前提 A=隊首(held)、B=下一位(queued)、C=沒排隊直接來借。時間推到 `T ≥ expires_at`。

| # | 情境 | 斷言 |
|---|---|---|
| 1 | A 在 T checkout | 409;A 的 reservation = `expired` |
| 2 | 有 B:任何人在 T 寫入本書後 | B = `held`、拿到 A 原本的 copy、`expires_at = T + 48h`;B checkout → 201;A checkout 仍 409 |
| 3 | 無 B:C 在 T 直接借 | 201;copy `on_loan` |
| 4 | 有 B:C 在 T 直接借 | 409(copy 已 held 給 B) |
| 5 | **閘門**:A 用 `now = T−1ms` checkout,C 用 `now = T` 借,同時放行 | 恰好一人拿到 loan;copy 恰好 `on_loan` 一次;另一人 409。兩種順序都合法 |

第 5 支才是「競態」,前四支是「行為」。要不要再加一支「A checkout vs cron sweep 同時」?

➡️ 五支都要;A-vs-cron 那支**不加**— 它跟第 5 支在 DB 層是同一條路(都是「A 的 UPDATE … WHERE status='held' AND expires_at > now」對上「expire 的 UPDATE … WHERE expires_at <= now」),重複釘沒有新資訊。若 Q16 選 (b),第 2–4 支多一行「測試先呼叫 `sweep(now=T)`」,其餘不變。

---

❓ **Q18** - **D1 `batch()` 內語句怎麼串,不能分支怎麼辦?**:歸還是三句:loan→returned、copy→available、allocate。D1 batch 原子但不能「第一句 changes=0 就停」。危險案例:loan L1 早已歸還,copy 又借給 L2;有人重送 L1 的 return → 第一句 0 changes,但第二句 `UPDATE copies SET status='available' WHERE id=? AND status='on_loan'` 會**放掉 L2 的書**。
(a) **每一句的 WHERE 只寫它要維持的不變式**,不依賴「上一句成功」:copy 釋放句要加 `AND NOT EXISTS (active loan on this copy)`;allocate 的 copy→held 句要加 `AND EXISTS (held reservation pointing at this copy)`。第一句 changes=0 就回 409,其餘句自動空轉;
(b) 兩次 round trip:先寫第一句看 changes,成功才送後面的(非原子,中間有窗)。

另一個子問題:403/404/409 怎麼分?第一句 WHERE 含 `reader_id=?`,非本人跟已過期都是 changes=0。
➡️ (a),加上「**先寫再解釋**」:條件式寫入是唯一裁判;changes=0 之後才 SELECT 一次判定該回 404/403/409。解釋可以略舊,裁決不會錯。

---

❓ **Q19** - **Q6 的「一人一書一關係」怎麼落地?**:它跨兩張表(loans 的 active、reservations 的 queued/held),partial unique index 只能管單表。
(a) 單表用 partial unique index 當第二道防線:`loans(reader_id, book_id) WHERE status='active'`、`reservations(reader_id, book_id) WHERE status IN ('queued','held')`;跨表靠 INSERT 的 `WHERE NOT EXISTS`,沒有第二道;
(b) 只靠 WHERE,不加 index。

子問題:`loans` 要不要存 `book_id`?不存的話 index 跟 NOT EXISTS 都要 JOIN copies。
➡️ (a)。`loans.book_id` **存**— copy→book 不會變,冗餘無害,換來 index 能建、NOT EXISTS 不用 JOIN。這是加欄位,你點頭。

---

❓ **Q20** - **`allocate(book)` 一次配一對,還是配到沒有為止?**:歸還/新增副本一次釋放一個 copy,一對就夠。但 cron sweep 一次可能 expire 同一本書兩個保留。
(a) allocate 永遠「一對」(最小 id 的 available copy × 最小 id 的 queued);sweep 對**每一筆**過期保留各開一個 batch(expire + 釋放 + allocate);
(b) allocate 用迴圈配到 changes=0。

➡️ (a)。每個 batch 都是「一個事件 → 一次 allocate」,同一個函式在四條路上長得一模一樣,測試也只要證一對。

---

❓ **Q21** - **`loans` 要不要存 `reservation_id`?**:checkout 的 INSERT loans 要有冪等守衛。有 `reservation_id` 就可以 `NOT EXISTS (loan WHERE reservation_id=?)`;沒有就用 `NOT EXISTS (active loan on this copy)`。

➡️ **不存**。copy 上不能同時有兩個 active loan 本來就是不變式,守衛用它就夠,少一個欄位。

---

❓ **Q22** - **`overdue_days` 在 domain JS 算,還是 SQL 算?**:
(a) JS:歸還前先 SELECT loan 的 `due_at`(不可變欄位,pre-read 沒有 TOCTOU),`overdueDays(dueAt, returnedAt)` 純函式算好,當參數寫進 UPDATE;
(b) SQL:`MAX(0, CAST(julianday(?now) − julianday(due_at) AS INTEGER))`,不用 pre-read。

同理 `due_at`、`expires_at`:borrow/allocate 前先 SELECT `loan_policies`,算好當 bound param 傳進去,**不在 SQL 裡用子查詢讀政策表**。
➡️ (a)。硬規則 5 要的「快照」在 (a) 是結構性的:UPDATE 語句裡根本沒有政策表可以 JOIN。pre-read 只讀不可變資料,可接受。`tests/hold.test.js` 那種純函式測試也才有東西可測。

---

❓ **Q23** - **時間字串的正準格式**:SQL 的 `expires_at <= ?` 是**字串比較**。`2026-09-18T02:00:00Z` 和 `2026-09-18T02:00:00.000Z` 混用時,`.`(0x2E)< `Z`(0x5A),等於的時刻會比錯。現有 `tests/hold.test.js` 用的是無毫秒格式。

➡️ 全站唯一格式 = JS `Date#toISOString()`(含毫秒)。一個 `toIso(date)` helper,所有進 DB 的時間都經過它;domain 純函式比較用 `Date.parse`,所以現有測試的 fixture 不用改。

---

❓ **Q24** - **SQL 語句住哪裡?**:CLAUDE.md 的目錄只有 `domain`(無 I/O)、`routes`(取時間、驗身分)、`presentation`。SQL 字串不是 I/O,但塞進 routes 會讓 handler 變胖;塞進 domain 又讓 domain 知道 D1。
(a) 新開 `src/db/`:語句 + batch 組裝,`copies` 的轉移句從 `copy-state.js` 的表生成;
(b) 直接寫在 routes。

➡️ (a)。這是加目錄不是加表/欄位/endpoint,但 CLAUDE.md 的目錄表要補一行。

---

❓ **Q25** - **`GET /books/:id` 的三個數字怎麼算,讀取可以略舊嗎?**:
- 副本數 = 全部 copies(下架是 DELETE,不會留);
- 可借數 = `status='available'` 的 copies(不含 `held`);
- 排隊人數 = `queued`(不含 `held`— 拿到保留的人已經離開隊伍)。
GET 不做 sweep,所以「48h 後、cron 前」的可借數會顯示少一本。

➡️ 照上面三條;讀取略舊接受(非目標 14)。這是別的 feature 的 endpoint,但數字定義得跟這裡的狀態模型對齊,所以現在釘。

---

答完這輪,剩下的分支我目前看到的只有:sweep 的 cron 頻率(純設定,不影響設計)、以及 Q19 若選存 `book_id` 時 CHECK 要不要驗 `book_id` 與 copy 一致(D1 做不到跨表 CHECK,答案大概是「不驗」)。如果這輪答完沒有新分支冒出來,我會宣告 frontier 清空,把整棵樹整理成一份摘要給你確認。
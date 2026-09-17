規格、非目標、CLAUDE.md、`tests/hold.test.js`、`EXPERIMENT-PROTOCOL.md` 都讀過了。先講我查到的事實(這些不用你回答),再開第一輪。

**事實**
- Repo 是空殼:`src/` 只有 `.gitkeep`,`tests/hold.test.js` import 的 `src/domain/hold.js` 還不存在;`package.json` 只有 vitest,沒有 hono、wrangler、D1 schema、migration。
- **矛盾 A**:CLAUDE.md 硬規則 2 的白名單只有 `available→on_loan→available`、`available→held→on_loan|available`。**沒有 `on_loan→held`,也沒有 `held→held`**。但 spec 狀態機 + 決定 5 要求「歸還時直接保留給隊首」「逾時順延給下一位」— 照字面就是這兩條被禁的轉移。
- **矛盾 B**:預約狀態機只畫了 `queued→cancelled`、`held→expired`;但副本圖寫「held ──(逾時 48h **或取消**)」。`held→cancelled` 到底存不存在,兩處對不起來。
- **缺口**:「逾時自動釋放」沒說誰觸發;`holds.expires_at` 暗示一張 `holds` 表,但預約狀態機又有 `held` 狀態(同一件事兩種表示);`overdue_days` 沒有算法;48h 不像 14 天那樣放在政策表;排隊順序沒有 tie-break;D1 沒有互動式交易(只有 `batch()` 原子、不能中途分支),這會直接決定「條件式寫入」怎麼切。

以下是第一輪,全部是現在就能回答、彼此不互相等待的問題。

---

❓ **Q1** - **併發測試跑在什麼上面?**:「同一副本不雙借」「保留只給隊首」都是 SQL `WHERE` 層的行為,純 domain 測不到。選項:
(a) `@cloudflare/vitest-pool-workers` + miniflare D1 — 跟 prod 同一種 `batch()` 語意和 `meta.changes`;
(b) Node + `better-sqlite3` 走一層 repository 抽象 — 快、但測的不是 D1;
(c) 只測 domain,SQL 層靠 code review。

➡️ (a)。硬規則 3 的「條件式寫入 + 檢查 `changes`」是 D1 特有的形狀,換 driver 等於沒測。(c) 直接違反 spec「沒有一個能靠讀 code 檢查」。

---

❓ **Q2** - **保留逾時由誰觸發?**:「逾時自動釋放」有三種做法:
(a) Cron Trigger worker 定期掃 `expires_at <= now` 的保留;
(b) 純 lazy — 只有寫入請求(借/取書/預約)順手清;
(c) a + b:cron 掃,**同時**每條寫入的 `WHERE` 都帶 `expires_at > now`,正確性不依賴 cron 有沒有跑到。

注意非目標 5:下一位是靠 `GET /me/loans` 看到「保留中」。純 lazy(b)的話,沒人寫入,下一位永遠看不到自己的保留。

➡️ (c)。CLAUDE.md 已經把 `worker` 列為「取現在時間的責任方」,顯然預期有 cron。測試直接呼叫 `sweep(db, now)` 傳假時間,不等 cron。

---

❓ **Q3** - **矛盾 A 怎麼解:副本一律經過 `available`,還是放寬白名單?**:
(a) **維持白名單,所有釋放都經過 `available`**:歸還 = 借閱 returned + 副本 `on_loan→available`;逾時/取消 = 預約 expired/cancelled + 副本 `held→available`;然後統一跑一個 `allocate(book)`:「有 `available` 副本且有人 `queued` → 副本 `available→held`、隊首 `queued→held`」。歸還、逾時、取消、(可能)新增副本四條路都收斂到同一個 allocate,同一個 `batch()` 內完成。
(b) 放寬白名單,加 `on_loan→held` 與 `held→held`,每條路各寫各的。

(a) 有個副作用:直接借書的人必須被擋在「本書有人 `queued`」之外(WHERE 加 `NOT EXISTS queued`),否則 allocate 前的瞬間會被插隊。

➡️ (a)。白名單看起來就是為這個設計寫的;而且「四條路一個 allocate」讓三方競態只剩一個要釘死的函式。但這等於改了 spec 的圖,你要點頭。

---

❓ **Q4** - **`holds` 是一張表,還是 reservation 的一個狀態?**:`POST /holds/:id/checkout` 的 `:id`,和 `DELETE /reservations/:id` 的 `:id` 是同一個 id 空間嗎?
(a) 一張 `reservations` 表:`status ∈ {queued, held, fulfilled, expired, cancelled}` + `copy_id` + `expires_at`;`/holds/:id` 的 id 就是 reservation id;
(b) 獨立 `holds` 表,reservation `held` 時另開一列。

➡️ (a)。(b) 是同一個事實兩處存,還要多一組同步規則。`tests/hold.test.js` 的 `canCheckout(hold, now)` 兩種都相容。

---

❓ **Q5** - **矛盾 B:`held` 狀態可以取消嗎?**:讀者已經拿到保留但改變主意,`DELETE /reservations/:id` 要:
(a) 允許,`held→cancelled`,副本照逾時的路釋放(順延下一位 / available);
(b) 拒絕 4xx,只能等 48h 自然過期(副本白白卡兩天)。

➡️ (a)。(b) 沒有任何人受益。預約狀態機要補一條 `held→cancelled`。

---

❓ **Q6** - **「一人一本書一份關係」要多嚴?**:spec 決定 4 說「一借閱、一排隊」是兩條獨立限制。那:借閱中同時排同一本 → 允許嗎?這正是非目標 15 說不做的續借後門(還書→自己是隊首→保留→再借)。
(a) 嚴:同一 (reader, book) 同時最多一個 `{active loan, queued, held}`;
(b) 鬆:借閱與排隊各一,可以並存。

➡️ (a)。一條 partial unique index 就釘死,還順便堵了續借。

---

❓ **Q7** - **館員新增副本時,書有人在排隊怎麼辦?**:spec 對 `POST /books/:id/copies` 只寫「新增副本」。
(a) 新副本直接餵 allocate → 隊首拿到保留;
(b) 新副本就是 `available`,排隊的人不管;直接來借的人先搶到。

(b) 會打破「有 `available` 副本 ⇒ 沒人排隊」這個不變式,Q3(a) 的 direct-borrow 擋條件會讓那本書變成:有副本但沒人借得到、隊首也永遠等不到。

➡️ (a),雖然這踩到「館藏」feature。或者最少:新增副本呼叫同一個 `allocate(book)`,不另寫邏輯。

---

❓ **Q8** - **預約的准入條件**:「排隊(全借出時)」要釘成什麼?
1. 有 `available` 副本時預約 → 4xx(去借就好)?還是允許?
2. 這本書**零副本**(館員還沒新增)→ 可以排嗎?

➡️ 1. 4xx,條件寫在 `INSERT … SELECT … WHERE NOT EXISTS (available copy)` 裡。2. 4xx — 排隊是等人還,沒東西可等就不該排;搭 Q7(a) 的話其實允許也自洽,但我傾向不開。

---

❓ **Q9** - **逾時邊界:剛好等於 `expires_at` 算過期嗎?**:現有測試只測了 +1 秒。

➡️ 保留有效 ⟺ `now < expires_at`(嚴格);`now == expires_at` 已過期。sweep 用 `expires_at <= now`,checkout 用 `expires_at > now`,兩邊互補不重疊。

---

❓ **Q10** - **`overdue_days` 公式**:歸還晚 1 秒是 1 天還是 0 天?
(a) `max(0, ceil((returned_at − due_at) / 86400s))` — 晚就是晚;
(b) `floor` — 未滿一天不算;
(c) 按某時區的日曆日 — 違反硬規則 4。

➡️ (a)。純 UTC 秒差,domain 一個純函式 `overdueDays(dueAt, returnedAt)`。

---

❓ **Q11** - **48 小時放哪?**:14 天在 `loan_policies`(一列),48h spec 沒說。
(a) 同一列加 `hold_hours` 欄;
(b) code 常數。

➡️ (a)。一樣做快照寫進 `expires_at`,而且「改政策不影響已存在的保留」可以用同一支測試模式證。但這是「加欄位」,要你點頭。

---

❓ **Q12** - **排隊順序**:`now` 從 route 傳進來,併發測試裡兩個請求會拿到同一個 `created_at`。

➡️ 隊首 = `queued` 中 `id` 最小(INTEGER PRIMARY KEY,插入序即到達序);`created_at` 只是紀錄不當排序鍵。

---

❓ **Q13** - **錯誤碼**:非目標說「只有 status code + 一句話」,那 domain 規則被拒用什麼碼?

➡️ 全部 **409**(無副本、重複借、非隊首取書、保留已過期、returned 再 return、有副本還預約);**403** 非本人/非館員;**404** id 不存在。不區分 410/422,少一個是一個。

---

❓ **Q14** - **測試怎麼「時間推 48h」?**:硬規則 1 說 route 負責取現在時間。
(a) app factory 注入 `clock`:`createApp({ db, clock })`,測試給可撥的假鐘;
(b) 測試專用 header `X-Test-Now`;
(c) 不推時間,直接 UPDATE `expires_at` 到過去。

➡️ (a)。(b) 是 prod 後門;(c) 測不到 sweep 對 `now` 的判斷。

---

❓ **Q15** - **「讀者」授權欄包含館員嗎?**:館員能不能自己借書、排隊?

➡️ 能。「讀者」= 任何已登入者,「館員」= `role='staff'`。否則要多寫一堆館員被拒的測試,沒人要。

---

回答完這輪之後,下一輪會問:三方競態的測試矩陣(依賴 Q2/Q3)、歸還 `batch()` 內的語句切法(依賴 Q1/Q3)、以及 `GET /books/:id` 的「可借數 / 排隊人數」要不要算 `held`(依賴 Q4)。
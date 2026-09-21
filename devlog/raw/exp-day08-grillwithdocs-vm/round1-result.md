讀完了:`CLAUDE.md`(5 條硬規則)、`docs/spec.md`(4 個 feature、4 條 API、8 條必測規則、5 個規格層決定)、`docs/non-goals.md`(6 條 + 3 個刻意的醜)、`README.md`、`docs/EXPERIMENT-PROTOCOL.md`、`tests/overdue.test.js`。

現況先講清楚,免得後面的問題像在空中討論:`src/` 三個目錄全是 `.gitkeep`,`src/domain/overdue.js` 不存在(所以 `overdue.test.js` 現在是紅的,符合協定)、`src/domain/book-state.js` 不存在、`devlog/` 不存在、`package.json` 只有 vitest —— **沒有 hono、沒有 wrangler、沒有任何 D1 或 SQLite driver**。另外硬規則 1 說「取現在時間是 `routes` / `worker` 的責任」,但目錄表裡沒有 `worker/`。

規格寫得比一般的緊,能裁決的句子夠多。但我找到幾條**互相衝突、或看起來被決定了其實沒有**的地方。第一輪:

---

❓ **Q1** - **書的狀態是一個欄位,還是從借閱紀錄推導出來的?**

這是整棵樹的根,規格在這裡自我矛盾。

非目標 5 寫「書只有 `id`、`title`、`status`」、硬規則 2 寫「不准在別處寫 `status = '...'`」—— 兩句都預設 `books.status` 是**真的欄位**。但 spec 查書那列寫「狀態跟借閱紀錄一致:有未歸還紀錄 ⇔ `on_loan`,測試證明」—— 這句話只有在 `status` 是獨立儲存的欄位時才需要被證明;如果狀態是 JOIN 推導出來的,這條測試是恆真的廢話,測不到任何東西。

再加一層不對稱:**借閱紀錄的狀態是推導的**(`active` / `returned` 沒有欄位,是 `returned_at IS NULL`),**書的狀態卻是儲存的**。同一件事實(這本書現在在誰手上)有兩個真相來源,你就簽下了維護不變量的債。

具體場景:書 A 借出(`books.status='on_loan'`,一筆 active 紀錄)。有人手動跑了 `UPDATE books SET status='available' WHERE id='A'`。現在 `GET /api/books/A` 回 `available`,但有未歸還紀錄。下一個人按到借書 —— 他借得到嗎?借得到就是雙借。

- **(a)** `books.status` 是真相,`borrow_records` 是帳本。併發判斷 = `UPDATE books SET status='on_loan' WHERE id=? AND status='available'` 檢查 `changes`。
- **(b)** `borrow_records` 是真相,`books.status` 是冗餘快取,靠測試證明一致。
- **(c)** 沒有 `status` 欄位,`GET` 時推導,併發靠 `borrow_records` 的 partial unique index。

➡️ 選 **(a)**。理由不是它最乾淨(它不是,它有冗餘),而是只有 (a) 讓硬規則 3 的「條件式寫入 + 檢查 `changes`」有地方落腳,也只有 (a) 讓 spec 那條「狀態跟紀錄一致」的測試有內容可測。(c) 最省事但直接牴觸非目標 5 和硬規則 2,要選就得改文件。

---

❓ **Q2** - **併發測試在什麼底下跑,才算真的裁決了⭐?**

spec 自己說這是「整個練習的重心」,而且「沒有一個能靠讀 code 檢查」。但現在裁判台是空的:沒有 wrangler、沒有 D1、沒有 SQLite driver。

而且有個更難堪的事實:**D1 local(和 SQLite)是序列化的**。你的閘門把 N 個請求同時放行,它們還是會排隊進去。所以「恰好一人成功」這個結果,在一個**寫錯的實作**(先 `SELECT` 查狀態、再 `UPDATE`)底下也可能通過 —— 只要中間沒有 await 讓出控制權。

- **(a)** `@cloudflare/vitest-pool-workers` + miniflare 的 D1,測試裡 N 個 `fetch` 卡在同一個閘門上齊發。最接近正式環境。
- **(b)** `better-sqlite3` in-memory,測試直接呼叫 repository 層,Promise 閘門放行。最快最穩,但 Hono 那層沒被測到。
- **(c)** `wrangler dev` 起真 server 打 HTTP。最真,但慢、CI 難、違反「重跑 5 次一致」。

➡️ 選 **(a)**,再加一個 CLAUDE.md 沒寫但我認為該加的紀律:**先寫一版故意違規的實作**(`SELECT` 狀態 → `await` → `UPDATE`,不帶 `WHERE status='available'`),確認併發測試**會紅**。測試沒有被證明抓得到 bug 之前,它通過不代表任何事。這正好符合「先寫一個會紅的測試」的精神,只是紅的來源是實作而不是缺函式。你接受多一個這種「反向驗證」的步驟嗎?

---

❓ **Q3** - **還書時,`due_at` 快照怎麼從資料庫進到純函式?**

硬規則 5 要求用紀錄上的 `due_at` 快照算逾期,硬規則 1 要求 `now` 從參數進來(`overdueDays(dueAt, now)` 已經是這個形狀),硬規則 3 要求併發判斷在 `WHERE` 裡。三條在還書這條路徑上打架:

要算 `overdue_days`,你得先有 `due_at`;`due_at` 在資料庫裡;但「先查再寫」正是硬規則 3 禁止的形狀。

- **(a)** 在 SQL 裡算:`UPDATE ... SET overdue_days = max(0, cast((julianday(?) - julianday(due_at)) as int)) WHERE ... AND returned_at IS NULL`。一個語句解決併發與計算,但逾期邏輯從 `src/domain/` 漏進 SQL,`overdueDays()` 變成只有測試在用的裝飾品。
- **(b)** 先 `SELECT due_at`(這不是併發判斷,只是讀快照)→ 純函式算 → `UPDATE ... SET returned_at=?, overdue_days=? WHERE book_id=? AND user_id=? AND returned_at IS NULL`,檢查 `changes`。競態下最壞是白算一次,寫不進去,回 4xx。

➡️ 選 **(b)**,並且把這個區分寫進 CLAUDE.md 硬規則 3:禁的是「**用查到的值做通過/拒絕的判斷**」,不是禁所有的讀。現在的措辭「不能在應用層先查再寫」字面上把 (b) 也禁掉了,而 (b) 是唯一能讓硬規則 1 和 5 同時成立的做法。這條規則的文字需要修。

---

❓ **Q4** - **「借出後改借期政策」這個動作,具體是什麼 SQL?**

⭐ 的第二個條件全靠它。`loan_policies` 一列,但「改」有兩種意思,而且決定了測試長什麼樣:

- **(a)** 就地 `UPDATE loan_policies SET loan_days = 30`。測試:`borrow`(14 天)→ 改成 30 → `return` → `overdue_days` 仍照原 `due_at` 算。
- **(b)** INSERT 一列新政策 + 生效日,借書時取最新的。→ 這等於加欄位、加版本概念,超出 spec 說的「一列」,也踩到「不要主動加表、加欄位」。

➡️ 選 **(a)**。它讓測試短到無可爭辯,而且如果實作偷懶用 JOIN 即時重算,測試會立刻紅 —— 這正是這條規則要抓的東西。(b) 反而會讓 bug 躲起來。

---

❓ **Q5** - **一本逾期但還沒還的書,`GET /api/users/:id/borrows` 要不要告訴他逾期幾天?**

spec 完全沒提。`overdue_days` 只在還書那一刻被「押上」,所以未歸還紀錄的這個欄位是 `NULL`。意思是:讀者在還書前,系統不會直接告訴他逾期了幾天,他得自己拿 `due_at` 跟今天比。

「逾期只記天數」如果連看都看不到,那記給誰看?

- **(a)** 不回。`overdue_days` 是結算欄位,只有終態有值。
- **(b)** 未歸還的那段,由 route 取 `now` 丟進**同一個** `overdueDays()` 純函式即時算,只出現在 response,不寫 DB。

➡️ 選 **(b)**。不加表、不加欄位、不加 endpoint,同一個純函式兩處復用,而且順便多一個「時間是參數」的證據點(同一筆紀錄、不同 `now`、不同答案)。非目標 3 禁的是**主動**通知,被動查詢不在裡面。

---

❓ **Q6** - **這一版的 `src/presentation/` 到底有沒有東西?**

硬規則 4:「時區換算只能在 `src/presentation/`」。但整份 spec 沒有任何一處要求回傳當地時間 —— 進出資料庫是 UTC ISO,API 回應也是 UTC ISO。那 presentation 層這一版是個空目錄,硬規則 4 是一條**在這個 repo 裡無法被任何測試證明的規則**。

README 說這題的價值在「五條能被機器裁決、而眼睛看不出來的規則」。硬規則 4 不在那五條裡,而且它目前誰也裁決不了。

- **(a)** 承認它是預防性規定,保留空目錄,由 `scripts/` 的靜態檢查守(grep `src/domain` 和 `src/routes` 裡不准出現時區相關字樣)。
- **(b)** 回應多帶一個 `due_at_local`(`Asia/Taipei`),讓 presentation 有活幹、硬規則 4 可測。→ 但這是主動加欄位,得你點頭。
- **(c)** 這一版刪掉硬規則 4,等真的有 UI 再加回來。

➡️ 選 **(a)**。靜態檢查也是機器裁決,只是裁的是「有沒有寫」而不是「行為對不對」,比 (b) 誠實 —— (b) 是為了讓規則可測而發明需求,尾巴搖狗。但 `scripts/` 現在只有 `.gitkeep`,選 (a) 就等於承諾要寫這個檢查,以及一併檢查硬規則 1(`src/domain/` 不准出現 `Date.now()` / `new Date()`)和硬規則 2(`status = '` 只准出現在 `book-state.js`)。

---

這六題答完,下一輪會解鎖的是:第二道防線到底是 `CHECK` 還是 partial unique index(硬規則 3 的措辭我懷疑不準,`CHECK (status IN (...))` 只擋拼錯字,擋不住雙借)、`books` 與 `borrow_records` 兩次寫入在 D1 沒有 interactive transaction 下怎麼不留孤兒、以及各種 4xx 的具體碼與錯誤 body 形狀。
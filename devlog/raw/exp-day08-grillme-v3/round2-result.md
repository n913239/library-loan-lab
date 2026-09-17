Node 是 v26.5.0,`node:sqlite` 可用。想跑一個小探針確認 `run()` 的回傳形狀和 partial UNIQUE index 行為,但寫 `/tmp` 被擋了;下面以我對 `DatabaseSync` 的認知為準(`run()` 回 `{ changes, lastInsertRowid }`、沒有 `transaction()` 助手、要自己 `BEGIN`/`COMMIT`),實作時第一件事就是驗這個。

第一輪答案裡有一條我要追問(Q8-2),其餘往下展開:

---

❓ **Q12** - **併發閘門插在哪一層?**:Q1(b) 給了一個 DB 介面,`node:sqlite` 又是同步的——代表所有「真正的」SQL 執行都是瞬間完成、不可能交錯。要製造 TOCTOU,閘門必須在**應用層的 await 點**上。選項:

- (a) 測試用一個 `gatedDb` 包住 adapter:每個 request **第一次呼叫 `batch()`(第一次寫)** 前先 `await barrier.arrive()`,湊滿 N 個才放行。所有 request 的讀(存在檢查、policy)都在放行前完成,寫全部擠在放行後。`src/` 零改動
- (b) `createApp({ db, clock, hooks: { beforeWrite } })`,測試傳 hook。多一個只為測試存在的參數
- (c) 靠 `Promise.all` 硬打 N 次,不放閘門——CLAUDE.md 明禁

➡️ 選 (a)。而且要**先證明它會紅**:對照組是一版「先 SELECT status,是 available 就 UPDATE 不帶 WHERE 條件」的 naive borrow,同一個閘門下要出 N 個 201。這一步是「先寫一個會紅的測試」在併發題上的實質意義——沒有紅過的閘門等於沒有閘門。

---

❓ **Q13** - **`now` 怎麼進 routes?**:硬規則 1 說取時間是 routes 的責任,但測試要控制時間(due_at 快照測試、Q8 的 active overdueDays)。選項:

- (a) `createApp({ db, clock })`,`clock: () => string`(UTC ISO),production 給 `() => new Date().toISOString()`,測試給固定或可撥動的 clock
- (b) request header `X-Now` 覆寫——會漏到 production
- (c) vitest fake timers 改全域 `Date`——能動,但 domain 的「不讀時鐘」就沒法用 static check 之外的方式證明

➡️ 選 (a)。`new Date()` 這行只會出現在 worker entry 一處。測試的 clock 用一個 `let now = '...'; const clock = () => now` 就能撥。

---

❓ **Q14** - **Q8(2) 追問:history 段的 `overdueDays` 讀存的還是重算?**:你說兩段用同一支純函式——active 用 `now`、history 用 `returned_at`。但 spec 的還書是「**押上** `returned_at` 與 `overdue_days`」,欄位是存的。如果 history 也重算,`borrow_records.overdue_days` 就變成**只寫不讀**(除了還書當下的回應)。三種收法:

- (a) history 讀存的欄位;active 現算。存的欄位是「當時的裁決」,list 只是轉述
- (b) history 也重算,存的欄位純粹是稽核用;另加一條不變量測試 `stored == overdueDays(due_at, returned_at)`
- (c) 不存 `overdue_days` 欄位,還書回應也現算——但這改到 spec 的 API 表

➡️ 選 (a)。你的論點「同一個快照對不同 now 的讀數」我同意,但 history 的 `now` 就是 `returned_at`,而那個讀數已經在還書當下押進去了;再算一次不是錯,是多一個可以分岔的地方。若你堅持 (b),我要把那條不變量測試列進 spec 的「必須被測試證明」表。

---

❓ **Q15** - **借書的讀:幾次、什麼順序?**:Q4(b) 的 `batch` 只管寫。寫之前要知道 user 存在、book 存在、policy 幾天,才能分 404 / 409 和算 `due_at`。選項:

- (a) 三次 SELECT(users、books、loan_policies),依序回 404
- (b) 一次 SELECT 把三件事撈回來:`SELECT (SELECT 1 FROM users WHERE id=?) AS u, (SELECT 1 FROM books WHERE id=?) AS b, (SELECT loan_days FROM loan_policies LIMIT 1) AS d`,應用層看哪個是 NULL 決定 404(user 先於 book)

這裡的「先讀再寫」不違反硬規則 3:user/book 的存在性沒有任何 endpoint 會改,不是併發判斷;併發判斷仍在 batch 的 WHERE 裡。

➡️ 選 (b)。借書 = **1 讀 + 1 batch(2 句)+ 1 讀回**(見 Q16),數字寫進 spec。

---

❓ **Q16** - **成功回應怎麼拿到紀錄?**:borrow 回 201 + 紀錄,return 回 200 + 紀錄。選項:

- (a) batch 之後再 `SELECT * FROM borrow_records WHERE id = ?`(borrow 用 `lastInsertRowid`/D1 的 `last_row_id`;return 先讀的那筆已有 id)。多一次讀,但回的是資料庫裡真的有的東西
- (b) 用 `RETURNING`——D1 和 node:sqlite 都支援,但 `RETURNING` 要走 `.all()` 而非 `.run()`,`changes` 得改用 rows.length 推,adapter 介面被搞髒
- (c) 應用層拿手上的值拼一個物件回去,不讀回

➡️ 選 (a)。這也是 GET 之外第二個「狀態跟紀錄一致」的觀察窗:借完讀回的紀錄若不存在,就是 batch 沒真的寫進去。adapter 介面因此固定為:`first(sql, params)`、`all(sql, params)`、`run(sql, params) → { changes, lastRowId }`、`batch([...]) → [{ changes, lastRowId }]`。

---

❓ **Q17** - **還書的 `overdue_days` 從哪算?**:`overdueDays(due_at, now)` 需要 `due_at`,那在紀錄上。所以還書必然是:先 SELECT 這人這本書的 active 紀錄拿 `due_at` → domain 算 → batch 條件更新。另一條路是在 SQL 裡算 `max(0, (unixepoch(?) - unixepoch(due_at)) / 86400)`,不用先讀。

➡️ 先讀再算。SQL 裡算會把規格決定 3 的公式複製到第二個地方,而且 `tests/overdue.test.js` 那支函式就沒人用了。先讀的 SELECT 不是併發判斷——判斷還是 `WHERE returned_at IS NULL` 加 `changes`;兩個人同時還同一筆,一個 200 一個 409。這個「雙重還書併發」測試 spec 沒要求,我建議**加**,閘門和借書共用。

---

❓ **Q18** - **batch 回來的 `changes` 不一致怎麼辦?**:Q2(c) 的世界裡,還書的 batch 是兩句 UPDATE(紀錄、書),理論上 `changes` 必為 `[1,1]` 或 `[0,0]`。若出現 `[1,0]`(紀錄改了但書沒轉),交易已 commit,不可逆。選項:

- (a) 當 bug:throw → 500,靠測試在開發期抓
- (b) 補償:再打一句把紀錄改回去——在單寫者 SQLite 上是多餘的複雜度

➡️ (a)。而且把「任何時刻 `books.status = 'on_loan'` ⇔ 存在 active 紀錄」寫成一支測試用的 `assertInvariant(db)`,每個 route 測試結尾都跑一次。這比 500 更早抓到。

---

❓ **Q19** - **併發測試的 N 與「重跑 5 次」怎麼落地?**:

1. N 取多少?
2. 「重跑 5 次結果一致」是測試內迴圈 5 輪(每輪新 DB),還是 `npm test` 跑 5 遍?

➡️ N = 20(夠多到 naive 版一定爆,又不會讓 barrier 慢)。5 次用測試內 `for (round of 1..5)`,每輪 fresh DB + fresh barrier,單一 `npm test` 就能證明;另外 `package.json` 加 `"test:5x"` 給 CI 跑整包 5 遍,兩個層次都有。

---

❓ **Q20** - **Workers 那一端這次做多少?**:README 說技術棧是 Workers + Hono + D1,但 `package.json` 只有 vitest,沒有 hono、wrangler、`wrangler.toml`。測試用 node:sqlite 不需要這些。選項:

- (a) 加 `hono` 依賴、`src/app.js` 的 `createApp({ db, clock })`、`src/db/sqlite-node.js` adapter;**同時**加 `src/db/d1.js` adapter + `src/worker.js` entry + `wrangler.toml`,但 D1 那條路這次不跑、不測
- (b) 只做 (a) 的前半,D1 adapter 和 worker entry 留到能實際 `wrangler dev` 的時候
- (c) 全做,並用 `@cloudflare/vitest-pool-workers` 跑一次 smoke

➡️ (b)。沒跑過的 D1 adapter 是「看起來有」的程式碼,和你這個實驗的精神相反;而且 D1 `batch()` 的 `meta.changes` 語意要真的打過才知道對不對。README 技術棧不改,spec 加一行「D1 接線在下一個 feature」。

---

❓ **Q21** - **這一輪拷問出來的決定要落到哪?**:`EXPERIMENT-PROTOCOL.md` 說乾淨 session 會拿掉 `spec.md` 和 `non-goals.md`,只留 `CLAUDE.md`。所以這 20 個決定放 spec 的話,AI 版看不到;放 CLAUDE.md 的話,就改變了實驗的變因(「規則已經寫給它了」的那個規則集)。選項:

- (a) 全部進 `docs/spec.md` 的「規格層的決定」表(第 6 條起),CLAUDE.md 不動——AI 版看不到是**刻意的**,差異正是文章要寫的東西
- (b) status code 表、回應格式、adapter 介面這種「契約」進 spec;閘門/測試策略進 `tests/README.md`
- (c) 用 `domain-modeling` skill 寫成 ADR

➡️ (a) 加上 (b) 的第二半:契約進 spec 決定表,測試策略進 `tests/README.md`(因為 AI 版會看到 `tests/`,那正是「規則已經寫給它了」的一部分——你得決定閘門的做法算不算「規則」)。CLAUDE.md 一字不動。

---

下一輪(最後一輪)會剩:依 Q12 的答案定 barrier 的 API、依 Q21 定我最後要交的東西是「改 spec + 寫 tests/README」還是連程式碼一起,以及 devlog 這次要不要記(你現在是「AI 尚未介入」階段,還是我就是 AI 版?)。
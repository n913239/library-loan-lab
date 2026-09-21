第二輪的答案:

先回你兩個事實:(1) 這台機器刻意沒裝 node,你的假設成立 —— Node 26 的 node:sqlite 只有 DatabaseSync,prepare() 回 StatementSync,run() 回 { changes, lastInsertRowid },沒有 batch();adapter 的 batch() 用 BEGIN/COMMIT 自己包,這點記進決定裡。(2) 沒有 .git 是刻意的:這是 EXPERIMENT-PROTOCOL 說的乾淨 session,clone 之後 rm -rf .git,git 歷史在外面由我接。不要 git init。

Q6 照你的:INSERT … WHERE EXISTS 在前、UPDATE 在後,同一個 batch;兩個 changes 必須相等,不等就 throw。201 的 body 不回查,id 從 last_row_id 拿。
Q7 接受「讀不可變快照 → 純函式 → 條件式寫入」,靜態檢查開具名例外。拒絕把逾期規則搬進 SQL,同意。
Q8 照你的:negative control 跑 no-index schema、檔頭寫明理由;另一支測試單獨證明 partial unique index 擋得住。
Q9 閘門只掛 run()/batch()、一次性 barrier + 2 秒 timeout + 到達數訊息、每個請求恰好一次 gated 寫入、adapter 加 calls 計數器 —— 都照你的。但 GET /api/users/:id/borrows 不是 1 次:規格決定 5 說 userId 查不到才 4xx,一句 WHERE user_id=? 撈到 0 列分不出「沒這個人」和「有人但沒紀錄」。所以是 2 次(先查 users 存在,再撈紀錄),測試斷言 === 2 而且與筆數無關(塞 0 筆和 50 筆都是 2);「有算過」防的是 N+1,不是 2 vs 1。分段在應用層做,同意。
Q10 照上表。還書三種失敗同一個 404、不分,同意;failure 之後那次 SELECT 只決定錯誤碼、收成 classifyBorrowFailure(),同意。寫回 docs/spec.md 這件事由我事後做,這個 session 不寫檔。
Q11 (b)。時鐘只准在 src/routes/clock.js 出現,靜態檢查照這條寫,比硬規則 1 現在的字面嚴,同意。
Q12 你這個 session 不碰 src/,也不碰任何檔 —— 這次只到規劃,產出就是這幾輪的決定。實作的順序照 protocol:我先寫、commit、再開乾淨 session 讓 AI 出版本。你說的 docs/DECISIONS.md 和寫回 spec 的三件事(錯誤碼表、overdue_days 兩段語意、決定 4 降級)我事後做。

請開下一輪。

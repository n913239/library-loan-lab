第一輪的答案:

先回你的環境觀察:沒裝 hono / wrangler / driver 是刻意的,這次只到規劃;沒有 .git 也是刻意的(EXPERIMENT-PROTOCOL 的乾淨 session,歷史在外面由我接,不要 git init)。worker 進入點放 src/worker.js。

Q1 (a)。
Q2 不選 (a) 的 miniflare。走 (b) 的變形:抽一層極薄的 DB 介面(D1 API 的子集:prepare/bind/run/first/all + batch),測試用 Node 26 內建的 node:sqlite 實作它(這台機器沒裝 node,假設它只有 DatabaseSync、沒有 batch,adapter 用 BEGIN/COMMIT 自己包),production 用 D1 原生物件;不裝 better-sqlite3、不裝 wrangler。Hono 那層有測到:測試用 app.fetch(new Request(…)) 打四條 endpoint,不起 server。閘門放在測試 adapter 的寫入呼叫前(await gate,N 個到齊才放行)—— 你說的「先 SELECT 再 UPDATE 中間沒有 await」正是閘門要撐開的縫。反向驗證接受:故意違規的實作留在 tests/ 當 fixture 永久跑,正確的綠、它必須紅。
Q3 (b)。硬規則 3 的措辭改成「禁的是拿查到的值做通過/拒絕的判斷,不是禁所有的讀」—— 同意,記為規格的洞,CLAUDE.md 由我事後改,這個 session 不動它。
Q4 (a)。
Q5 (b)。兩段共用同一個欄位名 overdue_days,分段(active / history)已經說明哪個是定格、哪個是當下。
Q6 (a)。靜態檢查一併寫:硬規則 1、2、4 各一條。

請開下一輪。

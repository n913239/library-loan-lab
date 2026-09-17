計畫寫在 `<plan 檔>(本資料夾的 PLAN-round*.md)`。這個 session 沒有 `AskUserQuestion` / `ExitPlanMode` 可用,所以我把要問的事都寫成「可推翻的假設」放在計畫裡,你看一眼就能改。

**摘要**

repo 是空殼(只有 CLAUDE.md 和 vitest),Node 26 內建 `node:sqlite`,測試不用另裝 sqlite。要加 `hono`(必要)和 `wrangler`(dev)。

設計重點,一條硬規則對一個機制:
- 規則 1 → `createApp(clock)` 注入時間;domain 只吃 ISO 字串
- 規則 2 → `book-state.js` 匯出 `EVENTS.borrow / EVENTS.return`,SQL 寫 `SET status = ? WHERE status = ?` 帶參數,沒有其他地方出現狀態字面值
- 規則 3 → `UPDATE … WHERE status = ?` 檢查 `changes`;`CHECK` 管 enum,**partial unique index**(`loans(book_id) WHERE returned_at IS NULL`)管「一本書只有一筆未歸還」
- 規則 5 → 還書時 `overdue_days` 只讀 loan row 上的 `due_at`,沒有政策表可 JOIN

**七個假設,最值得你先看的三個:**
- A1 `userId` 從 header `X-User-Id` 拿
- A2 逾期天數用 `ceil`(晚 1 秒 = 1 天)
- A3 還書是 `POST /loans/:loanId/return`,不是以書為主鍵

另外 `scripts/check-rules.sh` 用 grep 把規則 1、2 接進 `npm test`——這算稍微超出「借書還書」,但 CLAUDE.md 說違反 = CI 紅燈,沒有檢查那句話就是空的;不要的話拿掉即可。

沒開 git,所以不會 commit;devlog 依協定由你存原始輸出。
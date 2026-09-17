計畫已修訂(`<plan 檔>(本資料夾的 PLAN-round*.md)`)。

這次改動:
- `listUserBorrows(db, { userId, now })`:仍是 2 次 SQL,每筆補 `overdue_days` — active 用 `overdueDays(due_at, now)`,history 用 `overdueDays(due_at, returned_at)`,同一支 `src/domain/loan.js` 的純函式
- `GET /api/users/:id/borrows` handler 取 `clock()` 傳進去;回應兩段都帶 `overdueDays`
- 加測試:clock 釘在 due 後 3 天 → active 那筆 = 3;history 那筆用 `returnedAt` 算,之後 clock 再往後撥數字不變

還需要你決定的:**沒有了。**

這個 session 沒有 `ExitPlanMode` 可用,所以要開始實作請直接說「照計畫做」。
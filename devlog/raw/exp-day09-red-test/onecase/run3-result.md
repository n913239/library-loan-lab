測試通過(1/1)。

新增 `src/domain/overdue.js`,提供 `overdueDays(dueAt, now)`:

- 算 `now - dueAt` 的毫秒差,除以一天後無條件捨去(只算完整天數)
- 未逾期回傳 0(不會出現負數)
- 日期解析失敗時丟 `TypeError`

測試檔沒動。`npm install` 這步被權限擋下,但 `npx vitest` 直接可跑,代表環境已有 vitest,不需另外安裝。
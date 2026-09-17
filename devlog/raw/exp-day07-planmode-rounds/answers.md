回答你的五個待確認事項,然後請你據此修訂計畫。修訂完請把「還有哪些地方需要我決定」單獨列出來;如果沒有了,明講「沒有了」。

1. Schema:不只 4 張。要有 `readers`(含 `role`,值是 `reader` 或 `staff`,只能用 SQL 改,沒有 endpoint 能設角色)和 `loan_policies`(一列,借期 14 天存這裡);借出時把算好的 `due_at` 寫進 `loans`,歸還時只看快照。讀者身分仍是 JWT 的 `sub`,但要對得到 `readers.id`。
2. Endpoint:借書是 `POST /books/:id/loans`(指定書,由系統挑一本可借副本),不是指定副本。歸還 `POST /loans/:id/return` 本人或館員都可以。預約 `POST /books/:id/reservations` 保留。另外要加兩條:`DELETE /reservations/:id`(取消排隊,僅本人)和 `POST /holds/:id/checkout`(把保留變成借閱,僅本人)。查詢類 GET 這次不做,你判斷對。
3. 順延給下一位隊首;沒有人排隊才變 `available`。
4. 用 vitest(repo 已經在用),先不裝 Cloudflare 工具鏈;domain 層純函式測試優先,D1 的 SQL 語意之後再驗。
5. 可以加 `src/db/` 和 `src/index.js`。

還有一條你沒問、但我要補的:同一個讀者對同一本書,只能有一筆進行中的借閱,也只能排一次隊。

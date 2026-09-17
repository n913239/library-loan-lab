七個假設我逐條回,照我的規格:

A1 不用 header。借書與還書都是 POST body 帶 `{ userId, bookId }`;路徑是 `POST /api/borrow`、`POST /api/return`,不是 RESTful 的巢狀路徑。`userId` 在 `users` 表查不到才 4xx。
A2 用 floor,不是 ceil:`max(0, floor((now − due_at) / 86400 秒))`,未滿一天不算。理由:逾期只記錄不收錢,寬鬆沒有成本。
A3 還書以「這個讀者對這本書未歸還的那一筆」為準(userId + bookId),不是 loanId。已歸還再還 → 4xx;別人的紀錄 → 4xx。
A4 可以,`returned_at IS NULL` 推導。
A5 可以加 `src/db/`。
A6 可以,書靠 SQL 塞。
A7 可以。

另外三件你的計畫沒有、我的規格有的:
1. 借期 14 天要存在 `loan_policies` 表(一列),不是 code 常數;借出時把算好的 `due_at` 寫進紀錄,之後只看快照。要有一支測試證明「借出後改政策,既有紀錄的 due_at 不變」。
2. 還要有 `GET /api/books/:id`(書名、狀態)和 `GET /api/users/:id/borrows`(未歸還 + 歷史兩段,SQL 查詢次數要算過)。
3. 一人同一本書只能一筆未歸還(同一人重複借同一本 → 4xx);還完要立刻可借(測試:return 之後緊接 borrow → 201)。

請據此修訂計畫。修訂完把「還需要我決定的」單獨列出;沒有了就明講「沒有了」。

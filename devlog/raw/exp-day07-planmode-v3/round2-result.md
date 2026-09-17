計畫已修訂,在 `<plan 檔>(本資料夾的 PLAN-round*.md)`。

**改了什麼**

- 路徑改 `POST /api/borrow`、`POST /api/return`(body `{ userId, bookId }`),加 `users` 表,查不到 → 404
- 逾期改 `max(0, floor(diff / 86400s))`;測試邊界:晚 23h59m = 0、晚 24h = 1、晚 2.5 天 = 2
- 還書改以 `user_id + book_id + returned_at IS NULL` 找紀錄;先 SELECT 拿快照,再 `UPDATE … WHERE returned_at IS NULL` 檢查 `changes`
- 加 `loan_policies` 單列表(`id CHECK (id = 1)`,初始 14 天);borrow 讀政策 → `dueAt(now, periodDays)` 寫快照;測試「借出後改成 30 天,舊紀錄 `due_at` 不動、新借的才 +30」
- 加 `GET /api/books/:id`(1 次 SQL)、`GET /api/users/:id/borrows`(**2 次**:users 一次、loans JOIN books 一次,JS 切 active/history;test adapter 有 counter 斷言)
- 加測試:同一人重複借同一本 → 409;return 之後緊接 borrow → 201

**我補的小決定**(寫在計畫裡,不喜歡就改):

- 還書找不到「這人這本未歸還」— 已歸還 / 別人的 / 沒借過 — SQL 上長一樣,統一 404 `no_active_loan`,不多查一次去區分
- 同一人重複借:一本書一冊,書已 `on_loan`,走同一條 409 `book_on_loan`;不另加 `(user_id, book_id)` 索引,`(book_id)` 那支已更嚴格
- JSON camelCase(跟 body 一致),DB snake_case,轉換在 routes

**還需要你決定的:**

1. `GET /api/users/:id/borrows` 要不要帶 `overdueDays`?history 段可純算(`returned_at − due_at`),active 段要用 `now`(routes 取 clock 傳入,不違規)。目前計畫**不帶**。

只有這一項。
第三輪的答案:

CONTEXT.md 看過了,九條照這樣。

Q15 (a)。借書 = 2 次 adapter 呼叫(1 讀 1 寫),寫進測試註解並斷言。
Q16 due_at = borrowed_at + loan_days × 86400 秒,純秒差;dueAt(borrowedAt, loanDays) 純函式跟 overdueDays 對稱,兩個都先寫會紅的測試。schema 加 CHECK (loan_days > 0);政策表空 → 500,同意。
Q17 衝突一:樣式區分有沒有參數,禁的清單照你的,放行帶參數的 new Date(…) 和 Date.parse。衝突二:(a),狀態值從 book-state.js 來、SQL 一律綁參數;硬規則 2 措辭改法同意,記為第五個洞。硬規則 4 的樣式照你的。
Q18 照你的:adapter 統一映成 D1 的 { success, meta: { changes, last_row_id } }、rowid 強制 Number、changes === 0 時 last_row_id 設 null;加那條「成功請求回的 id = 資料庫裡唯一那筆的 id」測試。

ADR 兩張都開,你判斷三個條件都滿足我就照你的。寫進 docs/adr/。CLAUDE.md 一字不動,五個洞列給我就好。

請開下一輪。

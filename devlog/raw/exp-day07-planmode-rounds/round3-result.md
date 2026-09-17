計畫已修訂:`<plan 檔>`(本資料夾的 `PLAN-round2.md` / `PLAN-round3.md`)。

這輪改動:

- `loan_policies` 變成 `(id=1, loan_days=14, hold_hours=48)`,migration 種子一併寫入。
- 所有寫入類 route 和 `scheduled()` 開頭都 `SELECT loan_days, hold_hours FROM loan_policies WHERE id = 1`,交給 domain 的 `dueAtFor` / `holdExpiresAtFor` 算好快照再往下傳;歸還、取消、逾時釋放三條路徑建立保留時寫進 `reservations.hold_expires_at`,之後只看快照。
- 決定 2、3、4 上一版已照建議寫進設計(`reserve` 的 `NOT EXISTS` active loan、`cancel` 對 `held` 的順延、`loans.book_id` + partial unique index),這次把「待決定」標記拿掉,改為定案。
- 測試補了兩條快照驗證:`expire.test.js` 先把 `hold_hours` 改成 1 再跑,結果不變;`loan-policy.test.js` 驗兩個函式同輸入同輸出、不讀時鐘。

## 還需要你決定的

沒有了。
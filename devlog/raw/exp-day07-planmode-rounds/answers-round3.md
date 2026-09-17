四題的答案:

1. `hold_hours` 跟 `loan_days` 一起放 `loan_policies`;建立保留時把算好的 `expires_at` 快照進去,之後只看快照。
2. 已借此書的人不能再排同一本,409。
3. `DELETE /reservations/:id` 遇到 `held`:允許取消,副本順延給下一位隊首,沒人才 `available`。
4. 接受 `loans.book_id` 反正規化,當第二道防線。

請據此再修訂計畫。修訂完一樣把「還需要我決定的」單獨列出;沒有了就明講「沒有了」。

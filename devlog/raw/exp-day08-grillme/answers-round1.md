第一輪的答案:

Q1 (a)。但 domain 純函式測試先寫、先跑;D1 那層等工具鏈裝好再補。
Q2 (c)。
Q3 (a)。同意所有釋放都經過 available、統一走一個 allocate(book);spec 的狀態機圖我會改成這樣。直接借書的人在本書有人 queued 時要被擋,這條也接受。
Q4 (a)。一張 reservations 表,/holds/:id 的 id 就是 reservation id。
Q5 (a)。允許 held → cancelled,副本照逾時那條路釋放;預約狀態機補這一條。
Q6 (a)。嚴:同一 (reader, book) 同時最多一個進行中的關係。
Q7 (a)。新副本呼叫同一個 allocate(book),不另寫邏輯。
Q8 1. 有可借副本時預約 → 4xx。2. 零副本 → 4xx。
Q9 嚴格:now < expires_at 才有效,等於就算過期。
Q10 (b) floor,未滿一天不算 —— 這裡跟你的建議不同,理由是圖書館慣例,而且逾期只記錄不收錢,寬鬆一點沒有成本。
Q11 (a)。loan_policies 加 hold_hours,建立保留時快照進 expires_at。
Q12 同意:隊首 = queued 中 id 最小。
Q13 同意:409 / 403 / 404 三種。
Q14 (a)。createApp({ db, clock }),測試給假鐘。
Q15 能。館員也是讀者。

請開下一輪。

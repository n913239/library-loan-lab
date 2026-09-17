第一輪的答案:

Q1 (b),但測試端用 Node 26 內建的 node:sqlite,不裝 better-sqlite3。
Q2 (c)。
Q3 可以,就這樣落地。
Q4 (b)。
Q5 (a)。
Q6 照你的表。
Q7 (a)。
Q8 (1) 一次查詢,應用層分段。(2) 要帶 overdueDays —— 這裡跟你的建議不同:active 用 request 當下的 now 算、history 用 returned_at 算,兩段同一支純函式 overdueDays;它不是第二個真相,是同一個快照 due_at 對不同 now 的讀數。(3) borrowed_at DESC。(4) 404。
Q9 照上面。
Q10 (a)。
Q11 (1) 一起 (2) 一起 (3) 一起 (4) 測試各自塞,migration 只建表 + policy 那一列。

請開下一輪。

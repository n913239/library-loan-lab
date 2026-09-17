第二輪的答案:

Q16 (a)。每條對書的寫入先 expireHolds(book, now) + allocate(book)。
Q17 五支都要;A-vs-cron 不加,同意你的理由。
Q18 (a),先寫再解釋。
Q19 (a)。loans 存 book_id,同意。
Q20 (a)。allocate 永遠一對。
Q21 不存 reservation_id,同意。
Q22 (a)。JS 算,政策表 pre-read 後當參數傳進去。
Q23 同意:全站唯一格式 = toISOString()(含毫秒),一個 toIso helper。
Q24 (a)。加 src/db/,CLAUDE.md 目錄表補一行。
Q25 照你列的三條;讀取略舊接受。

cron 頻率:每 5 分鐘。book_id 與 copy 一致性:不驗。
請繼續;如果 frontier 清空了,給我整棵樹的摘要。

第一輪的答案:

Q1 泛指。照你的:第一道條件式 UPDATE 看 changes,第二道 partial unique index,CHECK 照加當白名單的 DB 版。
Q2 (a)。
Q3 不裝 vitest-pool-workers。抽一層極薄的 DB 介面(prepare/bind/run/first/all + batch),測試用 Node 26 內建的 node:sqlite 實作(batch 用 transaction 模擬),production 用 D1 原生物件。理由:測試要能重跑 5 次、跑得快;D1 batch 語義的差異記進 CONTEXT.md 或 ADR,由你判斷夠不夠格開 ADR。
Q4 照上表,「已歸還再還」和「還別人的」不區分,都 409 同一句話。
Q5 不要獨立 code path,照你的。
Q6 存。但列表那條 GET 的未歸還段要回「目前逾期幾天」:用 request 當下的 now 現算、同一支 overdueDays 純函式;歷史段讀存的欄位。這是規格的決定,不是今天才加的。
Q7 (1)(2)(3) 都照你的。
Q8 照你的。
Q9 照你的。
Q10 照你的,兩支 script 現在就寫。
Q11 加 (a),不加 (b)。
Q12 不要 git init,你只改檔,git 歷史我在外面接。
Q13 照你的:中文「借閱」,英文 borrow 為主,on_loan / loan_policies 註明是契約遺留。請寫 CONTEXT.md。

請開下一輪。

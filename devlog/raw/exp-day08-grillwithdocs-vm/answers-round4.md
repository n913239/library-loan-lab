第四輪的答案:

五個文件洞收到,spec 決定 6 那條也記了,都由我事後改。

Q19 照你的:併發還書測試照做、跟借書共用 helper;batch 兩句的 changes 分開檢查,第一句 0 → 409、第一句 1 第二句 0 → 500;借書那邊對稱補「守衛 INSERT 與守衛 UPDATE 的 changes 必須相等,不等 → 500」。還書 200、body { id, book_id, returned_at, overdue_days }(結算逾期天數)。
Q20 (a)。N = 8,helper 內跑 5 輪、每輪重建 in-memory DB,斷言五輪都是 1 個 201、7 個 409。
Q21 (a)。

請給實作順序表,然後停在那裡;這次只到規劃,不動手。

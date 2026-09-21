第一輪的答案:

Q1 不選 (b)。走 (a) 的變形:抽一層極薄的 DB 介面(D1 API 的子集:prepare/bind/run/first/all + batch),測試用 Node 26 內建的 node:sqlite 實作它,production 用 D1 原生物件;不裝 better-sqlite3、不用 miniflare。閘門不放進 production code,放在測試 adapter 裡:每次寫入前 await gate,N 個請求都到了才一起放行 —— 「先查再寫」的實作會在查與寫之間被撐開,N 個都查到 available、N 個都寫成功,測試就紅。理由:重跑 5 次一致、快、不用 wrangler。negative control 同意:naive 的先查再寫留在 tests/ 當 fixture,同一支併發測試跑兩種實作,正確的綠、naive 的紅,永久保留。
Q2 C。硬規則 3 的字面同意改成「CHECK + partial UNIQUE 索引當第二道防線」—— 這是規格的洞,記下來;CLAUDE.md 這個 session 不動,由我事後改。
Q3 同意。併發測試用 N 個不同 userId,測互斥;決定 4 降級成第 2 列的特例測試,不加獨立索引或欄位;spec 註明「多副本版才有獨立意義」,理由留著。
Q4 (a)。測試直接 UPDATE loan_policies,檔頭註明是刻意繞過應用層。那一列由 migration(schema.sql)的 INSERT seed。不加第 5 條 endpoint。
Q5 (b) 現算,同一支 overdueDays 純函式。但欄位不分開命名,兩段都叫 overdue_days:回應本來就分 active / history 兩段,分段已經說明哪個是定格、哪個是當下,多一個名字等於多一個詞。規格這一條當時沒寫,現在補進去:未歸還段用 request 的 now 現算、歷史段讀存的值。

請開下一輪。

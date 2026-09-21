第三輪的答案:

Q13 三件都照你的:user 存在性不進述詞、兩句 WHERE 逐字等價只管書;user + policy 合成一次查詢(user_exists NULL → 404,loan_days NULL → throw);豁免理由改成「讀到的值不進 WHERE 的併發判斷,只當計算輸入」,policy 的競態不處理。還書不查 users、撈不到列直接 404、1 次(失敗)/ 2 次(成功),同意。
Q14 照你的:轉移表是 SQL 狀態值的唯一來源,from/to 綁參數;合法字面值只在 book-state.js 和 schema.sql 的 CHECK,靜態檢查對 schema.sql 開白名單並註明要一致。
Q15 五條照上表;無參數 new Date() 才算讀時鐘;ISO↔epoch 收進 src/domain/time.js;checks.js export 給 tests/rules.test.js 跑。「硬規則 3 靜態只擋得住忘了寫 WHERE,其餘靠 review 和併發測試」這句照你的寫進決定文件,同意。
Q16 schema 照你的。全系統 ISO 形式統一成 toISOString() 的 24 字元,由 time.js 的 normalize 把關,寫進 DB 的每個時間值都過它;tests/overdue.test.js 不改。adapter 建構時 FK 明確設 ON,記為刻意對齊的語意差。
Q17 切「值 / 形狀」:domain 算值、presentation 定形狀,presentation 是純函式、now 從參數進來、不碰 DB;GET /api/books/:id 也走 presentation。照你的。
Q18 裝 hono、不裝 wrangler;測試用 app.fetch(new Request(…)),每支測試一個 :memory: 灌 schema.sql;production 端寫 src/db/d1.js 和 src/worker.js 但薄到接近宣告;README「刻意保留的醜」加第 4 條「production adapter 從來沒被真的 D1 執行過」—— 同意,這句我會原文放進去。

請把收尾一次列完,並整理三輪的結論(DECISIONS.md 的內容由你給,檔我來寫)。

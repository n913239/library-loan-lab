第二輪的答案:

Q7 照你的:自我守衛的 INSERT 在前、條件式 UPDATE 在後,一次 batch、恰好一次閘門報到。「書不存在」和「被借走」在這條路徑上同形,留給 Q10。
Q8 兩者都要,分工照你的;partial unique index 真的被觸發 → 500 + 大聲記錄,不包成 409,同意。記為規格的第二個洞,CLAUDE.md 由我事後改。
Q9 adapter 外層 async、batch() 內層同步不 await,閘門放在 batch() 的 await 之前。照你的。
Q10 (b)。對照表:書 / 使用者不存在 → 404;狀態衝突(已借出、重複借、已歸還、別人的紀錄)→ 409;body { "error": "一句話" };測試斷言 status + error 字串。
Q11 這題我維持同名,理由是規格:列表兩段都帶 overdueDays 是規格層的決定(這個 commit 還沒寫進 spec,是我後來補的),欄位名就是同一個。你的區分我接受進詞彙表:「結算逾期天數」(還書時押進紀錄,不變)和「當下逾期天數」(用 request 的 now 現算,不落庫)是兩個概念,CONTEXT.md 記兩條,並註明 API 上兩段共用 overdue_days 這個欄位名、由所在的段落決定是哪一個。DB 的 CHECK 說未歸還時該欄是 NULL,跟 API 在 active 段回現算值不衝突 —— 一個是儲存、一個是投影,這句也寫進詞彙表。請開 CONTEXT.md。
Q12 選 (b):id 由 SQLite 的 INTEGER PRIMARY KEY 給,domain 不碰 id(domain 純函式只算 due_at 和 overdue_days,不需要身分);借書回應的 id 從 batch 結果的 meta.last_row_id 拿,不用多查一次。硬規則 1 的表述改成「所有非決定性輸入都是參數」同意,記為第三個洞。
Q13 (a) migrations/0001_init.sql,測試 adapter 啟動時 exec 同一個檔;種子資料測試自己塞。CLAUDE.md 目錄表加 migrations/(第四個要補的地方)。
Q14 2 次,理由寫進測試註解,斷言 === 2 且與筆數無關。

請開下一輪。

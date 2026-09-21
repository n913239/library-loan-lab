寫好了三個檔案、改了一行:

- `CONTEXT.md` — 照第二輪貼的內容。
- `docs/adr/0001-tests-on-node-sqlite-not-d1.md` — Q3 + Q16(閘門在 adapter、證明的是什麼、不是什麼)。
- `docs/adr/0002-batch-with-changes-guard.md` — Q2(a) + Q14 + Q21。我判斷夠格的理由:`WHERE changes() = 1` 是下一個人一定會想「修掉」的東西,而且有兩個被拒的真替代方案。
- `CLAUDE.md` 目錄表加了 `src/db/` 一行。

沒開 ADR 的:錯誤碼表、欄位命名、`overdue_days` 存欄位——都是規格延伸或容易改的,不夠格。

第三輪。Q17 把「我的借閱」拉進來之後展開的 frontier,外加兩個前兩輪沒問到、但實作前一定會撞到的根問題(Q27、Q28):

---

❓ **Q22** - **「SQL 查詢次數有算過」怎麼算、算出來是幾**:規格要「有算過」,意思是測試斷言次數,不是口頭說。測試 adapter 加一個計數器(每次 `run/first/all/batch` +1)。次數本身:讀者不存在要 404、存在但沒紀錄要 200 空陣列,所以至少要知道讀者存不存在。(a) 兩次:`SELECT id FROM users` + `SELECT * FROM borrow_records WHERE user_id = ?`,JS 分段;(b) 一次:`users LEFT JOIN borrow_records`,0 列 = 404、有列但紀錄欄全 null = 空。

➡️ (a),測試斷言 `=== 2` 且**與紀錄筆數無關**(塞 0 筆和 50 筆都是 2)。「有算過」要防的是 N+1,不是 2 vs 1;(b) 省一趟換來 LEFT JOIN 的 null 判讀,不值。`borrow`/`return` 不斷言次數,規格沒要求。

---

❓ **Q23** - **未歸還段現算的逾期天數叫什麼**:歷史段讀存的 `overdue_days`;未歸還段用 request 的 `now` 現算。同名 `overdue_days`(概念相同、glossary 一個詞)還是另取名(例如 `overdue_days_now`)強調它會隨時間變?

➡️ 同名 `overdue_days`。分段本身(`active` vs `history`)已經說明了「這個會變、那個不會」;兩個名字等於在 glossary 裡多一個詞。DB 裡未歸還紀錄該欄是 NULL,回應裡被現算值取代,這點寫在 presentation 的註解。

---

❓ **Q24** - **回應形狀與排序**:規格說「未歸還、歷史兩段」。段名 `active` / `history`(照規格中文)還是 `active` / `returned`(照 glossary 狀態名)?排序:未歸還段依 `due_at` 升冪(最快到期的在前)、歷史段依 `returned_at` 降冪(最近還的在前)?不分頁。

➡️ `{ active: [...], history: [...] }`,排序如上,不分頁。段名跟規格字面走;`returned` 留給紀錄的狀態,不拿來當段名。排序在 SQL 裡做(`ORDER BY`),不在 JS。

---

❓ **Q25** - **分段與現算放哪一層**:route 取 `now`、拿到紀錄陣列之後,「分成兩段 + 未歸還段填現算值」是顯示轉換,該放 `src/presentation/`;presentation 可以呼叫 `src/domain/overdueDays`(純函式)。這樣 route 只剩:取 now → 查 db → 丟給 presentation。

➡️ 對。`src/presentation/borrows.js` 匯出 `presentBorrows(records, now)`;它是本 feature 唯一有實質內容的 presentation 檔。

---

❓ **Q26** - **`GET /api/books/:id` 的「⇔」測試怎麼寫**:規格要「有未歸還紀錄 ⇔ `on_loan`,測試證明」。這是不變量測試,不是 endpoint 測試:借之後、還之後、併發 N 次之後,每個節點都同時查 `books.status` 與 `COUNT(active records)`,兩邊要一致。

➡️ 寫成一個 `assertConsistent(db, bookId)` helper,在借書、還書、併發測試的**每個**斷言點都呼叫;另外單獨一個測試從 `available` 走完整一圈。不做「掃全表」的一致性測試——那是 worker/排程的題目,不在範圍。

---

❓ **Q27** - **`now` 怎麼注入 route**:硬規則 1 只限制 `src/domain/`,route 負責取時間。但測試要驗「借出 T,還於 T+20 天,`overdue_days = 6`」,不能等 20 天。選項:(a) app factory `createApp({ db, clock })`,`clock()` 回 ISO 字串;worker 入口傳 `() => new Date().toISOString()`,測試傳假時鐘;(b) 測試直接改 DB 裡的 `due_at` 往回撥。

➡️ (a)。(b) 等於測試偷改快照,剛好把「快照不重算」這條規則的證據弄髒。`src/index.js` 是 worker 入口(讀 `env.DB`、真時鐘),`src/app.js` 是 `createApp`,測試只碰 `createApp`。

---

❓ **Q28** - **借書失敗時 404 與 409 怎麼分**:batch 第二句 `changes = 0` 只知道「沒借到」,分不出書不存在(404)和書 `on_loan`(409)。選項:(a) batch 之前先 `SELECT` 書與讀者存在——這是「先查再寫」,但查的是**存在性**不是**狀態**,而書和讀者沒有刪除 endpoint,存在性不會被併發改變;併發判斷仍完全在 `WHERE` 裡。(b) batch 失敗後再 `SELECT` 書決定回哪個碼。

➡️ (a),而且**明寫在 code 註解**:「這個 SELECT 不是併發判斷,只是存在性;狀態判斷在下面的 batch WHERE」。理由:(b) 在輸家路徑多一趟,而且讀到的狀態可能已經又變了(A 輸給 B、B 馬上還、A 再查 → `available` → 該回什麼?)。存在性用一句 `SELECT (SELECT 1 FROM users WHERE id=?) AS u, (SELECT 1 FROM books WHERE id=?) AS b` 一趟解決。還書同理:讀者/書不存在 404,存在但沒 active 紀錄 409。

---

Q28 是這輪唯一會被人拿硬規則 3 的字面來挑戰的決定;如果你覺得「先查存在性」也不該有,替代方案是全部回 409、放棄 404——那要改 Q4 的表,你決定。
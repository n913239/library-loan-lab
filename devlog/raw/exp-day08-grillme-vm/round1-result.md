讀完了 `docs/spec.md`、`docs/non-goals.md`、`CLAUDE.md`、`README.md`、`docs/EXPERIMENT-PROTOCOL.md`,還有目前 repo 的實際狀態。

先說我查到的事實,因為它們會改變下面的問題:`src/` 三個目錄都是空的(只有 `.gitkeep`),`tests/` 只有 `overdue.test.js` 一支紅的測試,`package.json` 的相依只有 `vitest` — **沒有 hono、沒有 wrangler、沒有任何 SQLite driver**,也沒有 schema 或 migration 檔。所以「怎麼跑、怎麼測」還完全沒有被決定,而規格把整個練習的重心壓在一個併發測試上。

這就是第一輪的攻擊點。

---

❓ **Q1** - **那個 ⭐ 併發測試,在你打算跑的環境裡有可能變紅嗎?**

規格說借書的「做完」是「N 個人同時借同一本,恰好一人成功」,而且第 19 行自誇「沒有一個能靠讀 code 檢查」。但這個測試的裁決力完全取決於執行環境會不會真的讓兩個請求交錯:

- **(a) `better-sqlite3` 記憶體 DB**:同步 API,兩個 borrow 不可能交錯。**先查再寫的爛實作也會全綠。**這個測試就變成擺設,而且是最危險的那種擺設 — 你會以為自己證明了什麼。
- **(b) `wrangler unstable_dev` / miniflare 的本地 D1**:同一個 isolate 內 `await` 點可以交錯,有機會紅,但不保證 — 要靠閘門把兩個請求都卡在「查完、還沒寫」的那一刻。
- **(c) 真的 remote D1**:慢、要帳號、CI 會飄,違反「重跑 5 次結果一致」。

而 `CLAUDE.md` 要求「併發測試一律用閘門,不用隨機延遲」。閘門只能夾在**我們自己的 code 裡**(例如 repository 層一個可注入的 `beforeWrite` hook),這代表測試必須有能力暫停實作內部的某個點 — 這件事會反向決定 borrow 的函式怎麼切。實作寫完才發現「測不出來」就來不及了。

更狠的一題:你要怎麼證明這支測試**有**裁決力?唯一的辦法是先寫一個「先查再寫」的爛實作,讓它紅(negative control)。

➡️ 選 (b),並且**把 naive 的先查再寫實作留在 repo 裡當測試 fixture**,同一支併發測試跑兩種實作:正確的必須綠、naive 的必須紅。沒有這個 negative control,⭐ 這一列就沒有裁判資格,規格第 3 行那句「不寫沒有裁判資格的話」就自打嘴巴。

---

❓ **Q2** - **借書的真相來源是 `books.status` 還是 `borrow_records`?兩個寫入怎麼變成一個原子動作?**

規格要求查書「狀態跟借閱紀錄一致:有未歸還紀錄 ⇔ `on_loan`」。但 borrow 天生是兩個寫入(改書的狀態、插一筆紀錄),而 **D1 沒有互動式交易**,只有 `batch()`。三條路:

- **A:`books.status` 當唯一閘門。**`UPDATE books SET status='on_loan' WHERE id=? AND status='available'`,`changes===1` 才 INSERT。符合硬規則 3 的字面,但若 UPDATE 成功、INSERT 沒進去,書就永遠卡在 `on_loan` 且沒有紀錄 — 剛好違反規格要求的那個 ⇔。
- **B:`borrow_records` 當唯一閘門。**`CREATE UNIQUE INDEX ... ON borrow_records(book_id) WHERE returned_at IS NULL`(SQLite partial index),INSERT 撞索引就是被拒。**一個寫入、一個真相來源,不一致在結構上不可能發生**;`books` 根本不存 `status`,查書時用 `EXISTS` 推導。代價:硬規則 2 的 `book-state.js` 轉移表沒有欄位可以轉移,規則本身要重寫成「推導函式」。
- **C:A 當閘門,B 的 partial unique index 當第二道防線,`batch()` 把兩個寫入綁在一起。**

順帶拆一個硬規則的 bug:硬規則 3 說「用 `CHECK` 當第二道防線」— 但 **`CHECK` 約束表達不了「一本書只能有一筆未歸還紀錄」**,它只看得到單一 row。這裡能當第二道防線的東西只有 partial unique index。`CHECK` 在這個 schema 裡最多只能寫 `status IN ('available','on_loan')` 和 `returned_at IS NULL OR returned_at >= borrowed_at`,那是型別檢查不是併發防線。

➡️ 選 **C**,並且把硬規則 3 的字面從「用 `CHECK` 當第二道防線」改成「用 `CHECK` + partial `UNIQUE` 索引當第二道防線」。不改的話,你的 CI 靜態檢查會去驗一條做不到它宣稱的事的規則。

---

❓ **Q3** - **規格層決定 4 在一書一冊下是死規則,它永遠不可能被違反。**

「同一本書一人只能一筆未歸還」— 可是一本書只有一冊,書一旦 `on_loan`,**任何人**都借不到,包含借走它的那個人。所以「必須被測試證明的規則」第 3 列(同一人重複借同一本 → 4xx)和第 2 列(書在 `on_loan` 不能借 → 4xx)**是同一個測試,差別只有 `userId` 填一樣的值**。

它的理由寫「讓同一人重複送出不污染併發測試」也對不上:如果併發測試是 N 個不同 user 搶同一本,這條規則根本沒出場;如果併發測試是**同一個 user 送 N 次**,那你測到的是去重不是互斥。

➡️ 併發測試用 **N 個不同 `userId`**(測的是互斥),決定 4 降級成「第 2 列規則的一個特例測試」,別為它加任何獨立的索引或欄位。同時在 spec 裡註明:這條規則要到第二階段多副本才有獨立意義 — 留著理由,免得三週後有人以為它沒被實作。

---

❓ **Q4** - **「借出後改借期政策」這個測試,要怎麼改政策?系統根本沒有寫入政策的路。**

⭐ 那一列的第二個條件是「借出後改借期政策,既有紀錄的 `due_at` 不變」,硬規則 5 也押在這上面。但 API 只有 4 條,沒有一條能改 `loan_policies`;非目標也沒說要做管理介面。所以測試只剩兩種寫法:

- **(a) 測試直接 `UPDATE loan_policies SET days=7`**,繞過應用層。誠實、簡單,但測的是「DB 被人改了」而不是「政策變更」這個業務事件。
- **(b) 為了可測性加一條 `PATCH /api/loan-policy`** — 直接違反 `CLAUDE.md`「不要主動加 endpoint」,也不在 4 條 API 裡。

另外:`loan_policies` 只有一列,誰把那一列放進去?migration 的 seed?還是 schema.sql 裡的 `INSERT`?這件事現在沒有任何檔案負責。

➡️ 選 **(a)**,測試直接寫 DB,並在測試檔頭寫明「這裡繞過應用層是刻意的,因為改政策不是這一版的 use case」。`loan_policies` 的那一列由 `schema.sql` 的 `INSERT` seed。**不要為了可測性長出第 5 條 endpoint。**

---

❓ **Q5** - **`overdue_days` 是還書時落地的欄位,那「還沒還但已經逾期」的紀錄,`GET /borrows` 要回什麼?**

規格說 return 時「押上 `returned_at` 與 `overdue_days`」,所以 `overdue_days` 是存下來的。但「我的借閱」要回未歸還那一段 — 一筆 3 天前就該還、還沒還的紀錄,回出去的 JSON 裡:

- **(a) 不算,未歸還就不給 `overdue_days`**(欄位是 `null`)。讀者自己拿 `due_at` 比。
- **(b) 現算**,用 route 傳進來的 `now` 對 `due_at` 快照算,跟還書用同一個 `overdueDays()` 函式,只是不落地。

(b) 比較有用,而且**剛好是硬規則 1 的第二個證人** — 同一個純函式,一邊給還書時刻、一邊給查詢時刻。但它也讓同一個欄位名在兩種紀錄上意義不同(已歸還=定格快照、未歸還=當下值),文件不寫清楚一定有人誤讀。

➡️ 選 **(b)**,但**欄位分開命名**:已歸還的叫 `overdue_days`(定格),未歸還的叫 `overdue_days_now`(當下)。同名不同義是之後最容易出事的地方,而這裡分開的成本是零。

---

這五題答完,下一輪才輪得到:錯誤碼分類(規格全篇只寫「4xx」,`404`/`409`/`403` 完全沒分)、條件式寫入 `changes===0` 之後怎麼分辨「書不存在」和「書被借走」、schema 與 migration 機制、`src/presentation/` 在這個純 UTC 的 API 裡到底還有沒有工作、以及 domain 函式的簽章。這些的前提都壓在 Q1、Q2 上,現在問等於猜。
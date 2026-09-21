收到。你的 Q2 變形比我推薦的 (a) 好 —— 沒有 miniflare 這層黑箱,閘門插得進真正的縫裡。但它同時把三個新東西推上檯面:**adapter 的同步/非同步語意**、**閘門的釋放語意**、**單一連線下的交易巢狀**。這三個是同一個決定的三個面,而且如果搞錯,`tests/` 裡那個故意違規的 fixture 會**變綠**,⭐ 整個蒸發。

第二輪:

---

❓ **Q7** - **借書的兩次寫入,怎麼變成一次原子操作?**

Q1 選了 (a),`books.status` 是真相。那借書最直覺的寫法是兩句:

```sql
UPDATE books SET status='on_loan' WHERE id=? AND status='available';  -- 檢查 changes
INSERT INTO borrow_records (...);                                      -- changes=1 才做
```

兩個問題。第一,分支在中間:你得**看到** `changes` 才決定要不要 INSERT,而 D1 的 `batch()` 是原子的但不能分支,D1 又沒有 interactive transaction。中間掛掉 → 書卡在 `on_loan`、沒有紀錄:借不了(狀態擋),也還不了(沒紀錄可還)。這本書永久消失。

第二,更現實的:**這會讓 Q2 的閘門死鎖**。閘門是「N 個到齊才放行」。N 個請求都卡在第一次寫入,放行後只有 1 個 `changes=1`,其餘 N−1 直接回 409 走人。那個贏家走到第二次寫入(INSERT)時,閘門只等到 1 個,永遠等不到 N。測試掛死。

把分支搬進 SQL,借書就變成**恰好一次** adapter 寫入呼叫:

```sql
-- batch 裡第一句:自我守衛的 INSERT
INSERT INTO borrow_records (id, user_id, book_id, borrowed_at, due_at)
SELECT ?, ?, ?, ?, ?
WHERE (SELECT status FROM books WHERE id = ?) = 'available';
-- 第二句:條件式 UPDATE,檢查它的 changes
UPDATE books SET status='on_loan' WHERE id = ? AND status='available';
```

一次 `batch()`、一個交易、兩句共用同一個守衛條件、判斷仍然在 `WHERE` 裡(硬規則 3 滿足)、每個 borrow 請求對閘門剛好報到一次(Q2 的計數閘門成立)。

➡️ 選這個。代價要先講明:書不存在時子查詢回 `NULL`,`NULL = 'available'` 不成立,`changes` 一樣是 0 —— **「書不存在」和「書被借走」在這條路徑上長得一模一樣**。這直接餵到 Q10。

---

❓ **Q8** - **第二道防線是 `CHECK`,還是 partial unique index?我認為硬規則 3 在這裡寫錯了。**

硬規則 3 說「用 `CHECK` 當第二道防線」。但 `CHECK (status IN ('available','on_loan'))` 擋的是**拼錯字**,擋不住「同一本書出現兩筆未歸還紀錄」—— 那需要:

```sql
CREATE UNIQUE INDEX ux_active_loan_per_book
  ON borrow_records(book_id) WHERE returned_at IS NULL;
```

這才是真正能在 `WHERE` 守衛失效時把雙借攔下來的東西。`CHECK` 在這版該守的是**欄位之間的一致性**,尤其是 Q3 選了 (b) 之後:

```sql
CHECK (status IN ('available','on_loan'))
CHECK ((returned_at IS NULL AND overdue_days IS NULL)
    OR (returned_at IS NOT NULL AND overdue_days IS NOT NULL))  -- 還書的兩個欄位同生同死
CHECK (overdue_days IS NULL OR overdue_days >= 0)
CHECK (due_at > borrowed_at)
```

➡️ 兩者都要,分工如上,並把這記成**第二個規格的洞**(跟 Q3 那條一起,由你事後改 CLAUDE.md)。

附帶一個決定:index 真的被觸發時,拋的是 constraint error,不是 `changes=0`。要不要 catch 成 409?**我建議不要 —— 讓它 500 並且大聲記錄。** 這條 index 一旦叫,意思是條件式 `WHERE` 沒守住,那是 bug,不是使用者做錯事。包成 409 等於用第二道防線去掩蓋第一道防線的失效,正好相反。

---

❓ **Q9** - **DB adapter 的方法回 Promise 還是同步回值?**

`node:sqlite` 的 `DatabaseSync` 是**同步**的。如果 adapter 就照著同步暴露,那整個測試裡**沒有任何一個 await point** —— N 個「同時」的請求會一個做完才輪到下一個,零交錯。後果很具體:那個故意違規的 fixture(`SELECT` 狀態 → 判斷 → `UPDATE`,不帶守衛)會**穩穩地綠**,因為它的縫從來沒被撐開過。你的反向驗證會反過來證明錯誤的事。

所以 adapter 必須**回 Promise**,鏡射 D1 的形狀:`prepare().bind().run() / .first() / .all()`、`batch()`,`run()` 的結果是 `{ success, meta: { changes } }`(硬規則 3 要檢查的 `changes` 在 `meta` 裡,不是頂層)。每個 `await` 都讓出 microtask queue,交錯就回來了。

同時有一條反向的約束:**`batch()` 內部必須一路同步跑完,中間不准有 await**。`node:sqlite` 只有一條連線,`:memory:` 又不能靠開第二條連線分身;如果兩個 `batch()` 的 `BEGIN` 交錯,SQLite 直接吐 `cannot start a transaction within a transaction`。

➡️ **adapter 外層 async(製造縫)、`batch()` 內層同步(保護交易)。** 閘門就放在 `batch()` 的 await 之前。這兩件事看起來矛盾,其實正好是你要的:縫開在請求之間,不開在交易中間。

---

❓ **Q10** - **四種失敗長得一模一樣,你要付多少代價去分辨它們?**

Q7 之後,借書失敗只有一個訊號:`changes === 0`。它同時代表:書不存在 / 書被別人借走 / **書被你自己借走**(spec 規則 3)。還書失敗同樣是 `changes === 0`,代表:書不存在 / 你沒借過 / 已經還了(spec 規則 5)/ 那是別人的紀錄(spec 規則 6)。

spec 的必測表只要求這些都回 4xx,所以「全部一律 409」在字面上是合格的。但那會讓「只能還自己的」和「已歸還再還」這兩條規則的測試**無法互相分辨** —— 兩個測試斷言同一個數字,其中一條壞掉你不會知道。

- **(a)** 全部 409 + 一句話。最省,但上面那個問題還在。
- **(b)** `changes === 0` 之後,在**失敗路徑上**多跑一次 `SELECT` 把真正的原因查出來。成功路徑零成本(永遠不會走到),失敗路徑多一次查詢但反正已經失敗了。

➡️ 選 **(b)**,並定下對照表:書 / 使用者不存在 → **404**;狀態衝突(已借出、重複借、已歸還、別人的紀錄)→ **409**;body 固定 `{ "error": "<一句話>" }`(非目標:錯誤訊息不友善,就一句話,不做 i18n、不做 error code 列舉)。測試斷言 status + `error` 字串,四條規則才各自站得住。

---

❓ **Q11** - **`overdue_days` 一個名字,兩個意思 —— 這是名詞問題,不是分段問題。**

你 Q5 答 (b),然後說「分段已經說明哪個是定格、哪個是當下」。我要在這裡頂你一下,因為這正是詞彙表該管的事。

history 段的 `overdue_days` 是**結算值**:還書那一刻算出來寫進資料庫,之後永遠不變,重跑一百次都一樣。active 段的 `overdue_days` 是**投影值**:每次 `GET` 拿當下的 `now` 重算,明天再看會變大,而且根本不在資料庫裡。一個是事實,一個是快照函式的輸出。

同名的代價不在你看得懂,在於:任何拿到這份 JSON 的人(包括三個月後的你),都得先確認自己在哪一段,才知道這個數字明天會不會變。而 Q8 剛剛才加了一條 `CHECK`,保證未歸還的紀錄 `overdue_days` **必須是 NULL** —— 你的 API 卻在那一段回一個數字。資料庫說「這裡沒有值」,API 說「這裡是 3」,同一個名字。

- **(a)** 維持同名,靠分段區分。
- **(b)** 兩個名字:history 段 `overdue_days`(結算,對應資料庫欄位),active 段 `overdue_days_so_far`(投影,不落庫)。
- **(c)** active 段只回 `due_at`,不回天數 —— 但這推翻 Q5。

➡️ 選 **(b)**。這是這個 session 的第一條詞彙表條目,我會在你確認後開 `CONTEXT.md` 寫下這組對照(**結算逾期天數** / **當下逾期天數**),因為這正是那種「三個月後會被誤用一次」的詞。

---

❓ **Q12** - **`borrow_records.id` 誰生的?這是硬規則 1 漏掉的同一類問題。**

硬規則 1 說「時間是參數,不是副作用」,理由是 `Date.now()` 讓 domain 不可測。`crypto.randomUUID()` 是**一模一樣的形狀**:同樣是讀外部狀態、同樣讓同一組輸入產生不同輸出、同樣讓 domain 函式測不了 —— 但硬規則一個字都沒提。

- **(a)** `id` 跟 `now` 一起由 `routes`(或 `src/worker.js`)產生,當參數傳進 domain。
- **(b)** 讓 SQLite 給 `INTEGER PRIMARY KEY` 自動編號,domain 完全不碰 id。
- **(c)** domain 裡直接 `crypto.randomUUID()`。

➡️ 選 **(a)**,並記成**第三個規格的洞**:硬規則 1 的正確表述是「**所有非決定性輸入都是參數**」,時鐘只是其中最常見的一個。(b) 看起來更省,但會讓 domain 的回傳值在寫入資料庫前沒有身分,借書回應要多一次查詢才拿得到紀錄。

---

❓ **Q13** - **schema 放哪?兩個執行環境要吃同一份。**

測試用 `node:sqlite`、production 用 D1,兩邊必須是**同一份 DDL**,否則 Q8 那些 `CHECK` 和 partial index 只存在於其中一邊,第二道防線在正式環境形同虛設 —— 而且這種偏差不會有任何測試抓得到。

- **(a)** `migrations/0001_init.sql`。wrangler 的慣例路徑,以後 `wrangler d1 migrations apply` 直接吃;測試 adapter 啟動時讀同一個檔案 `exec()` 進 in-memory DB。
- **(b)** `src/db/schema.sql`,自己寫套用邏輯。
- **(c)** 寫在 JS 裡當字串常數。

➡️ 選 **(a)**。CLAUDE.md 的目錄表要加一行 `migrations/`(第四個要補的地方)。順帶:`users`、`books`、`loan_policies` 的種子資料是另一個檔(`migrations/0002_seed.sql`)還是測試自己塞?我傾向**測試自己塞** —— 種子資料是測試的輸入,不是 schema。

---

❓ **Q14** - **「我的借閱」的查詢次數,你要的數字是多少?**

spec 寫「SQL 查詢次數**有算過**」。這條的「做完」定義是你講得出一個數字並且守得住,所以現在得講。

紀錄 + 書名一次 JOIN 就夠:

```sql
SELECT r.*, b.title FROM borrow_records r
JOIN books b ON b.id = r.book_id
WHERE r.user_id = ? ORDER BY r.borrowed_at DESC
```

分成 active / history 是 domain 拿 `returned_at IS NULL` 切,不是第二次查詢。但還有一件事:spec 決定 5 說「`userId` 查不到才 4xx」。**零筆紀錄**和**使用者不存在**在上面這句 SQL 裡結果一樣(都是空陣列),要分辨就得多一次 `SELECT 1 FROM users WHERE id=?`。

➡️ **2 次,而且把「為什麼是 2 不是 1」寫進測試註解。** 第二次純粹買「使用者不存在 → 404」這個語意,不是 N+1。這比硬凹成 1 次(例如 `LEFT JOIN users` 再判斷)誠實,也比默默回空陣列符合 spec。

---

這輪答完,我看剩下的樹枝只有:`loan_policies` 一列的讀取時機(借書時多一次 `SELECT loan_days`,那就是 Q7 之外的第 2 次查詢,要不要併進 batch)、`due_at = borrowed_at + 14×86400 秒` 的確認、以及靜態檢查三條的具體 grep 樣式。之後 frontier 就空了,我會把詞彙表(Q11 那組)和該補的四個文件洞整理給你。
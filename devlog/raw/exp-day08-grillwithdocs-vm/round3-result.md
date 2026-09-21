`CONTEXT.md` 已建立在 repo 根目錄:9 個詞條分三組(書與借閱 / 時間與逾期 / 動作),你 Q11 指定的三條 —— 兩個逾期天數是兩個概念、API 共用欄位名由段落決定、儲存與投影不衝突 —— 都寫進去了。沒有任何 SQL 或實作細節。

最後一輪。Q12 改選 (b) 之後多長出一題(Q18),而 Q17 我在寫 grep 的時候撞到兩個**直接衝突**:

---

❓ **Q15** - **借期政策什麼時候讀?借書總共幾次 adapter 呼叫?**

Q3 已經確立「讀快照不是判斷」,借期政策的讀取套用同一條:

- **(a)** 借書時先 `SELECT loan_days FROM loan_policies` → 純函式算 `due_at` → 一次 `batch()` 寫入。**2 次 adapter 呼叫,其中 1 次是寫入** —— 閘門仍然只報到一次,Q7 的死鎖不會回來。
- **(b)** 把 `loan_days` 讀進 batch 的 SQL 裡算 `due_at`(`datetime(?, '+' || loan_days || ' days')`)。1 次呼叫,但借期計算漏進 SQL,跟 Q3 選 (b) 的理由直接矛盾,而且 `overdue.test.js` 測得到的那個純函式會少一個對稱的兄弟。
- **(c)** worker 啟動時讀一次快取起來。1 次呼叫,但改政策後**新借**的書仍套舊借期 —— 而 Q4 的測試(借 → 改政策 → 還)只驗 `due_at` 快照不變,**抓不到這個 bug**。測不到的優化就是純粹的風險。

➡️ 選 **(a)**,並且把「借書 = 2 次 adapter 呼叫(1 讀 1 寫)」跟 Q14 的 2 次一樣寫進測試註解斷言。「查詢次數有算過」如果只算「我的借閱」那一條,那條紀律就是裝飾。

---

❓ **Q16** - **`due_at` 是秒差還是日曆日?政策表是空的怎麼辦?**

規格決定 3 只規定了**逾期**用純 UTC 秒差不看日曆。`due_at` 本身沒規定,但如果它用日曆日(「14 天後的同一個鐘點」跨 DST 會偏移),兩端就不對稱,`overdueDays` 的 `floor` 語意會在某些日期出現差一天。

➡️ `due_at = borrowed_at + loan_days × 86400` 秒,純秒差,domain 出一個 `dueAt(borrowedAt, loanDays)` 純函式跟 `overdueDays` 對稱,兩個都先寫會紅的測試。

附帶要定的邊界(規格沒提):`loan_policies` 是空的、或 `loan_days ≤ 0` 時怎麼辦?➡️ schema 加 `CHECK (loan_days > 0)`,表空 → **500 而不是 4xx** —— 這是部署設定壞了,不是讀者做錯事,不該讓他看到 409。

---

❓ **Q17** - **靜態檢查的兩個衝突:grep 會把正確的 code 判成違規。**

**衝突一(硬規則 1)**:`src/domain/` 不准出現 `new Date`。但 `overdueDays(dueAt, now)` 收的是 ISO 字串,它**一定得解析**,`Date.parse()` 或 `new Date(str)` 跑不掉。而 `new Date('2026-09-18T02:00:00Z')` 是純的(同輸入同輸出),`new Date()` 才是副作用。粗暴的 grep 會把唯一正確的寫法擋掉。

➡️ 樣式必須區分**有沒有參數**:禁 `new Date\(\s*\)`、`Date\.now\(\)`、`performance\.now\(`、`crypto\.randomUUID\(`、`Math\.random\(`;**放行帶參數的 `new Date(...)` 和 `Date.parse(...)`**。這正好是硬規則 1 擴充成「所有非決定性輸入都是參數」之後該有的樣子 —— 判準是決定性,不是某個 API 的名字。

**衝突二(硬規則 2,比較嚴重)**:規則說 `status = '...'` 只准出現在 `book-state.js`。但 Q7 的 SQL 裡就有 `SET status='on_loan'` 和 `WHERE status='available'`,而那段 SQL 在 repository 層。**這條 grep 會直接判 Q7 違規。**

- **(a)** `book-state.js` export 狀態常數與轉移表,SQL 一律用參數綁定:`SET status = ? WHERE id = ? AND status = ?`,兩個值從 `book-state.js` 來。grep 乾淨,而且字面值真的只有一個出處 —— 這本來就是硬規則 2 想要的效果,只是原文沒預料到 SQL。
- **(b)** grep 加白名單放行 `.sql` 字串或 repository 檔。

➡️ 選 **(a)**。(b) 是為了遷就檢查而開的後門,開了之後這條規則就只擋得住老實人。這算**第五個文件洞**:硬規則 2 的措辭該從「不准在別處寫 `status = '...'`」改成「狀態字面值只准出現在 `book-state.js`,其他地方一律綁參數」。

**硬規則 4** 沒有衝突:`src/domain/` 與 `src/routes/` 禁 `toLocale|timeZone|Intl\.|Asia/|[+-]0[0-9]:00`。

---

❓ **Q18** - **Q12 選 (b) 之後,adapter 要正規化 `meta`,而且有一個只會在測試環境炸的坑。**

你要從 `meta.last_row_id` 拿 id,但兩邊的形狀不一樣:

1. **命名**:D1 是 `meta.last_row_id`(snake),`node:sqlite` 的 `run()` 回 `lastInsertRowid`(camel)。
2. **型別**:`node:sqlite` 的 rowid 可能是 **BigInt**。`JSON.stringify` 碰到 BigInt 直接 throw。這個坑只在測試環境出現、production 的 D1 回 number —— **最糟的那種偏差:測試紅了但你會以為是測試的錯**,或反過來測試綠了而 production 不同。
3. **陳舊值**:SQLite 的 `last_insert_rowid()` 是**連線層級**的。Q7 的守衛 INSERT 在書不可借時插 0 列,這時它回的是**上一個請求**成功插入的 rowid —— 一個看起來完全合法、卻屬於別人的 id。

➡️ adapter 是唯一知道差異的地方,三件事都在那裡收掉:命名一律映射成 D1 的 `{ success, meta: { changes, last_row_id } }`、rowid 強制 `Number(...)`、**`changes === 0` 時把 `last_row_id` 設成 `null`**。第三點尤其別留給上層自律 —— 那是個不會拋錯、只會回錯 id 的 bug。

再加一條測試:同一個併發案例跑完,斷言**成功的那一個請求回的 id,跟資料庫裡那唯一一筆紀錄的 id 相同**。這條專門抓陳舊 rowid,而且是 Q12 選 (b) 才需要的 —— 選 (a) 由外部產生 id 就沒這個問題。這是 (b) 的代價,現在付清。

---

這四題答完 frontier 就空了。之後我會給你:`CONTEXT.md` 的補充(如果 Q15–Q18 有新詞)、**五個文件洞的整理清單**(硬規則 3 措辭、硬規則 3 的 CHECK 寫錯、硬規則 1 擴充、目錄表缺 `migrations/`、硬規則 2 措辭)—— 依你的指示只記錄、不動 `CLAUDE.md`。

另外有兩個決定我認為值得各開一張 ADR,理由是它們三個條件都滿足(難逆轉、看了會納悶為什麼、有真的取捨):**(1) 測試不用 miniflare 而自己抽 D1 子集 adapter 跑 `node:sqlite`**、**(2) `books.status` 明知冗餘仍當成唯一真相來源**。要不要開,你決定 —— 不開我就只留在這次對話裡。
兩個事實要先講,因為其中一個會影響 Q9:

1. **這個 sandbox 裡沒有 `node`,也不准我看工作目錄以外的路徑**,所以 `node:sqlite` 的 API 我沒辦法親自驗。我下面的推薦建立在一個假設上:`node:sqlite` 只有 **`DatabaseSync`(同步)**,`prepare()` 回 `StatementSync`,`.run()` 回 `{ changes, lastInsertRowid }`,**而且沒有 `batch()`**。請你用一行 `node -e` 確認;如果 Node 26 已經長出非同步版本,Q9 的閘門形狀要重想。
2. **這個目錄不是 git repo**(環境回報 `Is a git repository: false`,而且 `git` 指令我被擋下來沒能親驗)。`docs/EXPERIMENT-PROTOCOL.md` 整套紀律押在「兩個 commit 的先後就是證據」上 — 現在沒有那個證據載體。這是 Q12。

同步這件事其實對你有利:閘門放行之後每個請求的寫入會跑到底、不會再交錯,等於乾淨地模擬「循序 commit」。但它也代表 **adapter 的 `batch()` 要自己用 `BEGIN/COMMIT` 實作**,而 D1 的 `batch()` 是一個交易、整批失敗整批 rollback — 兩邊語意必須對得起來,否則 production 和測試跑的是兩套併發模型,而你整個實驗就是在賭這兩套一樣。

---

❓ **Q6** - **`batch()` 沒有「條件中止」。你的 UPDATE 和 INSERT 怎麼同進同出?**

方案 C 是「`UPDATE books ... WHERE status='available'`,`changes===1` 才 INSERT」。但 `batch()` 是**一次送出、循序執行的一整批**,沒有「看前一句的 changes 再決定要不要跑下一句」這種東西。所以字面上的 C 有兩種寫法,都壞:

- **先跑 batch 再檢查 changes**:UPDATE 影響 0 列(書被借走了),**INSERT 還是會跑** → 一本沒有轉移狀態的書多了一筆 active 借閱紀錄。剛好打爆規格要求的「有未歸還紀錄 ⇔ `on_loan`」。除非 partial unique index 攔下它 — 但那是整批 rollback + 丟例外,不是乾淨的 409。
- **先 UPDATE、檢查、再 INSERT(兩次往返)**:兩個寫入不在同一個交易裡,中間掛掉書就卡在 `on_loan` 沒有紀錄。

真正能成立的是:**兩個 statement 掛同一個述詞,而且 INSERT 要排在 UPDATE 前面**(UPDATE 一旦把 status 翻成 `on_loan`,排在後面的 INSERT 就再也讀不到 `available`):

```sql
-- 1
INSERT INTO borrow_records (user_id, book_id, borrowed_at, due_at)
SELECT ?1, ?2, ?3, ?4
WHERE EXISTS (SELECT 1 FROM books WHERE id = ?2 AND status = 'available');
-- 2
UPDATE books SET status = 'on_loan' WHERE id = ?2 AND status = 'available';
```

兩句都是條件式寫入、述詞都在 `WHERE` 裡(硬規則 3 滿足兩次),同一個 batch 交易內同生共死。回來檢查 `changes`:`1/1` → 成功;`0/0` → 被拒;**`1/0` 或 `0/1` → 不變量已經壞了,直接丟例外**,別吞掉。

順帶一個小決定:201 的 body 從哪來?

➡️ 用上面這個寫法,並且**檢查兩個 `changes` 必須相等**(不等就 throw,這是最便宜的不變量偵測器)。201 的 body **不回查 DB** — `borrowed_at`、`due_at`、`user_id`、`book_id` 全是我們剛寫進去的值,`id` 從 `results[0].meta.last_row_id` 拿(adapter 把 `node:sqlite` 的 `lastInsertRowid` 映成 D1 的 `last_row_id`)。少一次查詢,而且 response 保證等於寫進去的東西。

---

❓ **Q7** - **還書必須「先讀 `due_at` 才能算 `overdue_days`」— 這是不是你自己禁止的先查再寫?**

`POST /api/return` 要在同一個動作裡:(a) 認定這筆紀錄還沒還、(b) 用 `due_at` 快照算逾期天數、(c) 押上 `returned_at` 和 `overdue_days`、(d) 把書翻回 `available`。但 `overdueDays()` 是 domain 的純函式,**要算就必須先把 `due_at` 讀到 JS 這一側**。於是還書路徑長這樣:SELECT → 純函式算 → 條件式 UPDATE。硬規則 3 說「不能在應用層先查再寫」。

我認為**這裡不算違反,但理由必須寫下來**:硬規則 3 禁的是「拿讀到的值去做併發判斷」。這裡讀到的 `due_at` 是**不可變快照**(一筆紀錄寫進去之後沒有任何路徑會改它),它只是計算的輸入,不是判斷的依據。真正的併發判斷仍然在 `WHERE returned_at IS NULL` 裡。兩個請求同時還同一筆,只有一個 `changes===1`,另一個拿 0 → 404,而且兩邊算出來的 `overdue_days` 一模一樣,所以就算搶輸也沒有寫到錯的值。

替代方案是把 `max(0, (julianday(?now) - julianday(due_at)))` 直接寫進 SQL 表達式,省掉那次 SELECT —— 但那等於把逾期規則搬進 SQL,`tests/overdue.test.js` 就測不到正在跑的那份邏輯了。**明確拒絕。**

還書的 batch 同樣是兩句:

```sql
-- 1
UPDATE borrow_records SET returned_at = ?1, overdue_days = ?2
WHERE user_id = ?3 AND book_id = ?4 AND returned_at IS NULL;
-- 2
UPDATE books SET status = 'available' WHERE id = ?4 AND status = 'on_loan';
```

➡️ 接受「讀不可變快照 → 純函式 → 條件式寫入」,並在 `scripts/` 的靜態檢查裡**為這個模式開一個具名例外**(而不是讓檢查寬鬆到抓不到真的違規)。同樣檢查兩個 `changes` 相等。

---

❓ **Q8** - **negative control 跑在哪個 schema 上?這決定它到底在證明什麼。**

naive fixture(先 SELECT 看 available,再無條件 UPDATE + INSERT)在閘門下的結果,**完全取決於 partial unique index 在不在**:

- **index 在(production schema)**:N 個請求全部撐開,全部以為 available,放行後第一個成功,第 2..N 個的 INSERT 撞索引 → 整批 rollback → 丟例外 → `500`。測試如果斷言「恰好一個 201,其餘 409」,naive 得到 `1×201 + (N-1)×500`,**是紅的,但紅在第二道防線,不是紅在缺了 `WHERE`**。而且一個把 constraint error catch 起來轉成 409 的 naive 實作會**全綠** — 那正是你在 Q2 拒絕掉的方案 B。
- **index 不在**:naive 得到 `N×201`,紅得乾淨俐落,直指「應用層的先查再寫沒有互斥力」。但它跑的不是 production schema。

換句話說:negative control 要麼證明「應用層擋不住」(要拿掉第二道防線),要麼證明「production schema 擋得住」(但證不到硬規則 3)。**一支測試拿不到兩個。**

➡️ negative control 跑 **no-index 的 schema**,並在測試檔頭寫明「這裡刻意拿掉 partial unique index,因為要測的是應用層的互斥力;第二道防線由另一支測試單獨證明」。另外加一支獨立的 schema 測試:直接對 DB 硬塞第二筆 active 紀錄,斷言索引擋下來。兩件事、兩支測試、各自可裁決。

---

❓ **Q9** - **閘門的形狀:攔哪些呼叫、幾個人算到齊、卡住怎麼辦?而且順便讓「SQL 次數」變成斷言。**

薄 adapter 是你這個設計最大的紅利,但閘門的細節有三個會讓測試飄的地方:

- **攔哪裡?** D1 的 API 不分讀寫,只有 `.run()`/`.first()`/`.all()`/`.batch()`。用 SQL 字串嗅 `^\s*(INSERT|UPDATE)` 太髒。推薦:**只在 `run()` 和 `batch()` 上掛閘門**,讀完全不攔 — 這剛好讓 naive 的那次 SELECT 自由通過、在閘門前就已經讀到 `available`,正是要撐開的縫。
- **幾個人算到齊?** 一次性 barrier 等 N 個到達。但**兩個 fixture 的 gated 呼叫次數必須一樣**,否則 barrier 要嘛提早放行要嘛永遠等 — 測試就從「紅/綠」變成「掛住」。規定:**每個 borrow 請求恰好一次 gated 寫入呼叫**(naive 也用 `batch()`,差別只剩 `WHERE`)。這樣 negative control 只變動一個變數。
- **卡住怎麼辦?** barrier 一定要有 timeout,到了就 reject 並印出「已到達 k/N」。「重跑 5 次一致」的反面不只是偶爾紅,還包括**偶爾 hang**,而 hang 在 CI 上最難讀。
- **順便**:`GET /api/users/:id/borrows` 的「做完」是「SQL 查詢次數**有算過**」— 這句話現在沒有裁判。adapter 天生看得到每一次呼叫,加個計數器,測試就能斷言「這個 endpoint 恰好 1 次查詢」。

➡️ 閘門只掛 `run()`/`batch()`;一次性 barrier + 2 秒 timeout + 到達數診斷訊息;兩個 fixture 各自恰好一次 gated 寫入;adapter 加 `calls` 計數器,`GET /borrows` 斷言 **1 次查詢**(一句 `WHERE user_id=?` 全撈,`returned_at IS NULL` 的分段在應用層做)。把「有算過」從形容詞變成數字。

---

❓ **Q10** - **規格全篇只寫「4xx」。八條規則裡有六條的驗收條件是「4xx」,那不是可判定的句子。**

規格第 3 行自己說「『做完』要寫成能判定的句子」,結果驗收表寫的是 `4xx` — `400`、`404`、`409` 全部滿足,等於沒規定。我的提案:

| 情境 | 碼 |
|---|---|
| body 缺 `userId`/`bookId` 或型別不對 | `400` |
| `userId` 查無此人 | `404` |
| `bookId` 查無此書 | `404` |
| 書已被借走(**包含同一人重複借**) | `409` |
| 借書成功 | `201` |
| 還書:找不到「該人 × 該書 × 未歸還」的紀錄 | `404` |
| 還書成功 | `200` |

兩個要你拍板的犧牲:

- **還書的三種失敗(別人的紀錄 / 已經還過 / 根本沒借過)回同一個 `404`**,不分。分開需要額外查詢,而且「還別人的」回 `403` 在一個沒有身分驗證的系統(非目標 6)裡是自欺 — 你連他是不是本人都沒驗。
- **borrow 的 `changes===0` 之後,要再發一次 `SELECT` 才知道是 `404` 還是 `409`。** 這次查詢**只決定錯誤碼、不決定成敗**,必須在 code 裡註明,否則它看起來就像硬規則 3 禁的那種先查再寫,三個月後會被誤殺(或更糟:被當成先例援引)。

錯誤 body 就照「刻意保留的醜」:`{ "error": "一句話" }`。

➡️ 照上表,把它**寫回 `docs/spec.md` 的驗收欄**取代 `4xx`。失敗路徑的那次 SELECT 收斂成一個具名函式 `classifyBorrowFailure()`,名字自己說明它只管錯誤碼。

---

❓ **Q11** - **`now` 從 route 進來 — 那測試怎麼把 `now` 餵給 route?縫開在哪?**

硬規則 1 說取現在時間是 routes/worker 的責任。但測試要決定論(「借出後改政策」那支測試必須控制借出時刻和歸還時刻),所以 route 裡不能直接寫 `Date.now()` —— 否則縫就沒了,而硬規則 1 只是把 `new Date()` 從 domain 推到 routes,沒有真的解決可測性。三種縫:

- **(a) app 工廠注入**:`createApp({ db, now: () => new Date().toISOString() })`,production 傳真時鐘,測試傳假的。
- **(b) 每個 handler 從 `c.get('now')` 拿**,由一個 middleware 塞進去,middleware 在 app 工廠注入。
- **(c) 只有 worker 進入點取一次時間**,往下全部當參數傳。

➡️ 選 **(b)**:一個 `clock` middleware 在請求進來的**第一時間**取一次 `now`,塞進 context,整個請求(借書算 `due_at`、還書算 `overdue_days`、查借閱算當下逾期)共用同一個時刻。好處是同一個請求裡不會出現兩個相差幾毫秒的 `now`,而「時鐘只在一個檔案裡被讀到」讓 `scripts/` 的靜態檢查變得極簡單:`Date.now()`/`new Date()` **只准出現在 `src/routes/clock.js`**,全 repo 其他地方一律紅燈。比硬規則 1 現在寫的「domain 不准出現」更嚴、也更好檢查。

---

❓ **Q12** - **我現在算不算「AI 版」?而且沒有 git,你的實驗根本沒有證據載體。**

`docs/EXPERIMENT-PROTOCOL.md` 說順序不可逆:①你自己寫 → commit 註明「AI 尚未介入」→ ②**開乾淨 session** → AI 出一版 → ③兩個 commit 的先後就是證據。而「乾淨 session」的定義是拿掉 `docs/spec.md` 和 `docs/non-goals.md`。

問題是:**我這個 session 讀了 spec、讀了 non-goals,而且剛剛跟你來回改了十幾個設計決定。** 如果我接著實作,產出既不是「你自己寫的」也不是「乾淨 session 的 AI 版」,它是第三種東西 —— 而且是污染力最強的那種:後面那個「乾淨 session」要嘛看得到我留下的 code,要嘛看不到但你心裡已經有答案了。文章裡那個對照組就毀了。

再加上 `Is a git repository: false` — `.gitignore` 在、README 還引用了 `4cf64d3` 這個 commit,但當前目錄沒有 `.git`。整套紀律押在 commit 先後上,載體卻不存在。(這點我沒能親自驗證,`git` 指令在這個 sandbox 被擋;請你確認。)

➡️ 順序:**(1) 先 `git init` 並把現況 commit 起來**(「AI 尚未介入:規格、非目標、一支紅的測試」);**(2) 這一輪拷問的結論寫成 `docs/DECISIONS.md` 單獨 commit**,message 註明「AI 參與:只有設計決定,沒有實作」;**(3) 實作由你自己先寫**,那才是對照組的基準;**(4) 之後開乾淨 session 讓 AI 出一版。**

我建議**我這個 session 不碰 `src/`**。我能交出最有價值的東西是 `docs/DECISIONS.md` 加上把 Q10 的錯誤碼表、Q5 的 `overdue_days` 兩段語意、Q3 的決定 4 降級寫回 `docs/spec.md` —— 規格層的洞補起來,實作留給你。**但這是你的實驗,你的決定。**

---

這 7 題答完,frontier 剩下的是純機械的:`schema.sql` 的欄位與約束清單、`book-state.js` 轉移表的形狀、domain 函式簽章(`planBorrow`/`planReturn`)、`src/presentation/` 在全 UTC 的 API 裡到底還有沒有工作(我懷疑沒有,但目錄和硬規則 4 還在)、以及 `scripts/` 靜態檢查具體查哪幾條。那些等這輪定了我一次列完。
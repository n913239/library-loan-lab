`CONTEXT.md` 的寫入被權限擋下來了(harness 把它標成敏感檔案)。內容我先放在下面最後一段,你允許後我再寫;或你直接複製。ADR(Q3 的 node:sqlite 決定,我判斷夠格:難逆、沒脈絡看不懂、有真取捨)等第二輪 R2 決定完再寫,因為它的內容取決於 Q2/Q3 的細節。

先開第二輪。Q1–Q3 定案後展開的 frontier:

---

❓ **Q14** - **batch 裡「輸家」怎麼被偵測**:Q2(a) 原本的說法是「輸家靠 INSERT 撞 unique index 拋錯、batch 回滾」。這有兩個代價:(1) route 要**解析錯誤訊息**分辨 UNIQUE 與其他錯,而 D1 與 node:sqlite 的錯誤形狀不同;(2) 第二道防線變成主要路徑。有個更乾淨的作法:INSERT 用 SQLite 內建的 `changes()` 綁住前一句——

```sql
UPDATE books SET status = ? WHERE id = ? AND status = ?;
INSERT INTO borrow_records (...) SELECT ?, ?, ?, ? WHERE changes() = 1;
```

`changes()` 回傳同一連線上一句改了幾列。UPDATE 輸了 → `changes()=0` → INSERT 插 0 列 → batch 正常 commit 但什麼都沒動 → route 看 `results[1].meta.changes === 0` → 409。**正常路徑零例外**,unique index 回到純第二道防線。還書同理:第二句 `UPDATE books ... WHERE id=? AND status=? AND changes()=1`。

失效模式我推過:D1 若 `changes()` 永遠回 0 → 所有借書都 409,冒煙測試立刻爆;若回錯值 → unique index 接住,仍正確。兩種都是「大聲」的失敗。唯一不能保證的是 D1 batch 是否單一連線,只有上線才驗得到。

➡️ 用 `changes()`。要在 SQL 旁邊註解說明依賴,並在 ADR 記「僅在 node:sqlite 驗證過,D1 上是假設」。若你不想賭 D1 內部,退回解析 UNIQUE 錯誤,那 Q15 的錯誤正規化就是必要的。

---

❓ **Q15** - **薄 DB 介面的長相與位置**:你說 prepare/bind/run/first/all + batch。這其實就是 D1 的表面,所以「介面」= **D1 API 的子集**,測試 adapter 去長得像 D1,production 直接傳 `env.DB`。要定的是:(1) 我們依賴 D1 回傳的哪些欄位——`meta.changes`、`meta.last_row_id`、`results`,其他不碰;(2) SQL 放哪:CLAUDE.md 目錄表沒有放 SQL 的地方,domain 不准 I/O,route 只該取時間和 userId。選項:SQL 直接寫在 route 裡,或新開 `src/db/`(`queries.js` 放 SQL、`index.js` 放介面 JSDoc typedef)。(3) adapter 放 `tests/helpers/sqlite-d1.js`,永遠不進 `src/`。

➡️ (1) 只依賴那三個;(2) 開 `src/db/`,route 不寫 SQL 字串——不然 route 會同時管 HTTP、時間、SQL 三件事,狀態字面值的靜態檢查也更難劃界;(3) 對。目錄表要加一行 `src/db/`,這是我唯一主動加的目錄,需要你點頭。

---

❓ **Q16** - **閘門放哪**:CLAUDE.md 要閘門不要隨機延遲。node:sqlite 是同步的,DB 層永遠不會真的交錯;能交錯的只有 JS 的 await 點。閘門的意義是「N 個請求都到了寫入前那一步,才一起放行」。選項:(a) 閘門在測試 adapter 裡——adapter 每次 `run`/`batch` 前 `await gate`,測試數到 N 個到達才 resolve;(b) 在 production code 留 hook。

➡️ (a)。production 零侵入;而且它確實能抓到「先查再寫」這種違反硬規則 3 的寫法(查跟寫之間的 await 會被閘門撐開,N 個都查到 available、N 個都寫成功 → 測試紅)。ADR 要老實寫:這證明的是「守門在 SQL 裡」,不是 D1 真實併發。

---

❓ **Q17** - **這次實作的範圍是幾條 endpoint**:你說「借書與還書」,規格有 4 條。`GET /api/books/:id` 便宜,而且借還測試用它讀狀態比直接查 DB 乾淨;`GET /api/users/:id/borrows` 有自己的「SQL 查詢次數有算過」要求,而且 Q6 補充的現算逾期天數也在那。

➡️ 做 borrow、return、`GET /api/books/:id` 三條;「我的借閱」下一個 feature。若你要四條一起,我要另開一輪問查詢次數怎麼算、現算欄位名等。

---

❓ **Q18** - **`loan_policies` 讀不到或多列**:規格說「一列」。借書流程是:讀政策(一趟)→ domain 算 `due_at` → batch(第二趟)。政策列缺 → 這是部署錯不是使用者錯;多列 → 取哪列?

➡️ `SELECT loan_days FROM loan_policies LIMIT 1`,缺列 → 500;多列不防(migration 只塞一列,測試改政策用 UPDATE 不用 INSERT)。兩趟之間政策被改,`due_at` 用讀到的那個——快照就是這個意思,不補救。

---

❓ **Q19** - **錯誤回應的長相與請求驗證**:非目標說「status code + 一句話」。JSON `{ "error": "..." }` 還是 text/plain?句子用中文還是英文?`userId`/`bookId` 收到 `"1"`(字串)算不算合法?

➡️ JSON `{ error: "book is on loan" }`,英文小寫一句,測試只斷言 status 不斷言句子。id 嚴格 `Number.isInteger`,`"1"` → 400——寬鬆轉型是之後 debug 的坑,現在收緊不花錢。

---

❓ **Q20** - **domain 函式清單與紅燈測試順序**:目前只有 `overdueDays(dueAt, now)` 有紅燈測試。另外還需要:`dueAt(now, loanDays)` → ISO 字串;`book-state.js` 的 `transition(from, event)`(非法轉移拋錯)。每支先寫紅燈測試再實作,順序:overdueDays → dueAt → transition → 靜態檢查 script → schema + adapter → borrow route(含閘門併發)→ return route(含 N 次 return 併發)→ GET book(含「⇔」一致性測試)。

➡️ 照這順序。`dueAt` 的紅燈測試要包含「`now` 有毫秒也正確」(Q8 的格式決定)。

---

❓ **Q21** - **batch 第二句 `changes=0` 但第一句成功——不變量已破**:用 Q14 的寫法,還書時若 `borrow_records` 更新成功但 `books` 那句改了 0 列,代表 DB 在請求前就不一致(有 active 紀錄但書卻 `available`)。batch 已 commit,無法回滾。

➡️ 回 500 + 把 (userId, bookId) 寫進 log,不做自動修復。只有 DB 事先壞掉才到得了這裡;自動修復等於在 route 裡偷寫狀態轉移,違反硬規則 2。

---

以下是被擋下的 `CONTEXT.md` 內容,你看過沒問題就允許寫入(或告訴我要改哪裡):

```md
# 圖書館借閱

單一館、一書一冊的借閱規則:書借走了別人就不能借,還了才能借。對內是「有限資源的分配規則」壓到最簡。

## Language

### 書與讀者

**書(Book)**:
一本實體書,一列就是一冊,沒有副本的概念。
_Avoid_: 副本、館藏、copy、item

**書的狀態(Book status)**:
書當下能不能借,只有 `available`(可借)與 `on_loan`(借出中)兩種,轉移只有 `available → on_loan → available`。
_Avoid_: 已借、borrowed、checked out、reserved

**讀者(User)**:
借書的人;系統只認 id 與 name,不驗身分、不分角色。
_Avoid_: 會員、館員、patron、reader、account

### 借閱

**借閱(Borrow)**:
讀者把一本書借走並在到期時刻前歸還的整件事;本專案的核心領域。英文以 `borrow` 為主。
_Avoid_: loan(見「契約遺留」)、lending、checkout、出借

**借書 / 還書(Borrow / Return)**:
讀者對一本書做的兩個動作,分別把書從 `available` 帶到 `on_loan`、再帶回 `available`。
_Avoid_: 借出、歸還登記、check in / check out

**借閱紀錄(Borrow record)**:
一次借閱的事實紀錄,狀態 `active → returned`,`returned` 是終態。未歸還 ⇔ `active`;「逾期」不是狀態,只是逾期天數大於零。
_Avoid_: loan record、交易、transaction、訂單

**未歸還 / 已歸還(Active / Returned)**:
借閱紀錄的兩個狀態。同一本書同一時刻至多一筆未歸還紀錄。
_Avoid_: 進行中、open / closed、pending

### 時間

**現在(Now)**:
每個請求取一次、從外面傳進領域邏輯的時刻,領域邏輯不自己讀時鐘。
_Avoid_: 系統時間、current time、timestamp(泛稱)

**借期(Loan period)**:
借書到到期的長度,目前固定 14 天。
_Avoid_: 期限、租期、duration

**借期政策(Loan policy)**:
決定借期長度的規則,只在借書那一刻被查一次;之後改政策不影響既有紀錄。
_Avoid_: 設定、config、rule table

**到期時刻(Due at)**:
借書當下用借期算好、寫死在借閱紀錄上的時刻快照;還書時只讀不重算。是一個時刻不是一個日曆日。
_Avoid_: 到期日、deadline、expiry

**逾期天數(Overdue days)**:
還書時刻超過到期時刻的完整天數(每 86400 秒算一天,未滿不算,永不為負),純 UTC 秒差、不看日曆日與假日。歸還時押在紀錄上;未歸還的紀錄可用「現在」現算。
_Avoid_: 罰款天數、late days、delay

## 契約遺留

`on_loan`(書的狀態值)與 `loan_policies`(借期政策的儲存名)是 API / 資料契約已定的識別字,保留原樣;除此之外不再新造 `loan*` 名字。

## 單冊版的推論規則

「一人同一本書只能有一筆未歸還」在一書一冊之下由「書 `on_loan` 就不能借」順帶滿足,不是獨立規則;多副本版才需要獨立實作。
```
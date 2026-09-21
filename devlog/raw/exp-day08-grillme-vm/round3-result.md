三件事先釘住,因為它們改變下面的問題:adapter 的 `batch()` 要自己 `BEGIN/COMMIT` 包(記進決定);不 `git init`;這個 session 不寫任何檔。

然後 —— **上一輪 Q6 的結論有一個洞,我現在才看見。** 先處理它。

---

❓ **Q13** - **`userId` 不存在時,那個 `INSERT ... WHERE EXISTS` 會插進一筆指向幽靈使用者的紀錄;而「兩個 `changes` 必須相等」有一個沒講出來的前提。**

Q6 定案的兩句是:

```sql
INSERT ... SELECT ?1,?2,?3,?4 WHERE EXISTS (SELECT 1 FROM books WHERE id=?2 AND status='available');
UPDATE books SET status='on_loan' WHERE id=?2 AND status='available';
```

**述詞只檢查書,完全沒檢查人。** 借一本 available 的書、帶一個不存在的 `userId` → INSERT 成功、UPDATE 成功、`1/1` → 回 `201`,DB 裡多一筆 `user_id` 指向不存在使用者的 active 紀錄,而且那本書被鎖住了,誰都借不走。Q10 的表說這該是 `404`。

想把 user 檢查塞進述詞來修,會撞上第二個問題:**如果只加在 INSERT 上**,user 不存在 → INSERT `0`、UPDATE `1` → `1≠0` → 我們自己設計的不變量警報 throw 出 `500`,而正確答案是 `404`。所以要加就**兩句都要加**。這就逼出那個沒講出來的前提:

> **「兩個 `changes` 必須相等」只在兩句的 `WHERE` 述詞邏輯上完全等價時才成立。** 任何一天有人只改了其中一句,這個檢查就從「偵測不變量壞掉」變成「自己製造 500」。

兩句長述詞要永遠保持同步,是很脆的東西。

另外,Q7 的豁免理由也要改寫:我上一輪寫的是「讀的是**不可變**快照」,但 borrow 還得讀 `loan_policies` 才能算 `due_at` —— **而 policy 是可變的,測試本人就會去改它**。理由撐不住。

➡️ 三件事:

1. **user 存在性不進 SQL 述詞**,改成 batch 之前一次讀。兩句的 `WHERE` 維持逐字等價,只管書。
2. **user 和 policy 合成一次查詢**,不要兩次往返:
   ```sql
   SELECT (SELECT 1 FROM users WHERE id = ?1)              AS user_exists,
          (SELECT loan_days FROM loan_policies WHERE id = 1) AS loan_days;
   ```
   `user_exists` 是 NULL → `404`;`loan_days` 是 NULL → 不變量壞了,throw(那一列是 schema seed 的,不該消失)。於是 **borrow 恰好 2 次 SQL**(成功)/ **3 次**(失敗時多一次 `classifyBorrowFailure`),可以直接斷言。
3. **豁免理由改寫成:「讀到的值不進入 `WHERE` 的併發判斷,只當計算輸入」**。這條同時涵蓋不可變的 `due_at`、不可變的 `users`、以及可變的 `loan_days`。順帶承認一個無害的競態:讀完 `loan_days` 到 batch 之間政策被改,這次借閱會用舊值 —— 規格只要求**既有紀錄**的 `due_at` 不變,進行中的請求用哪個值都說得通,不處理。

另外送一個對稱性:**還書路徑不需要查 `users`。** `SELECT due_at FROM borrow_records WHERE user_id=? AND book_id=? AND returned_at IS NULL` 撈不到列就直接 `404`,連 batch 都不用發 —— 人不存在、書不存在、還別人的、已經還過,四種情況天然收斂到同一個 `404`,正好是 Q10 要的。**還書是 1 次(失敗)/ 2 次(成功)SQL。**

---

❓ **Q14** - **`book-state.js` 的轉移表在這個架構下沒有任何 caller,它會是個裝飾品。**

硬規則 2 要求轉移白名單寫在 `src/domain/book-state.js`。但借書的轉移**已經完整表達在 SQL 裡了**(`WHERE status='available'` … `SET status='on_loan'`),執行路徑上根本不會去問那張表。寫成 `canTransition(from, to)` 的話,唯一的呼叫者會是它自己的單元測試 —— 一條規則,一張表,零個生產呼叫點。三個月後它跟真實行為長歪了也沒人發現。

而且硬規則 2 還說「不准在別處寫 `status = '...'`」—— 可是上面那兩句 SQL 字面上就寫了 `status = 'on_loan'`,靜態檢查一跑就紅。

兩個問題有同一個解:**讓轉移表變成 SQL 狀態值的唯一來源。**

```js
// src/domain/book-state.js
export const BOOK_STATE = { AVAILABLE: 'available', ON_LOAN: 'on_loan' }
const TRANSITIONS = {
  borrow: { from: BOOK_STATE.AVAILABLE, to: BOOK_STATE.ON_LOAN },
  return: { from: BOOK_STATE.ON_LOAN,   to: BOOK_STATE.AVAILABLE },
}
export function transition(event) { /* 查不到就 throw */ }
```

repository 側:`const { from, to } = transition('borrow')`,SQL 寫成 `SET status = ? WHERE ... AND status = ?`,兩個值**綁參數**進去。於是 SQL 裡一個狀態字面值都沒有,靜態檢查那條變成字面可執行;白名單從「一個被動的檢查函式」變成「主動的參數來源」—— 想繞過它,你連 SQL 都拼不出來。

➡️ 照上面做。白名單的唯一合法字面值出現處是 `book-state.js` **和 `schema.sql` 的 `CHECK`**(那條 CHECK 沒辦法綁參數),靜態檢查對 `schema.sql` 開白名單,並在檔案裡註明「這裡的兩個字串必須與 `book-state.js` 一致」。

---

❓ **Q15** - **靜態檢查會誤殺 `new Date(isoString)`,而硬規則 3 其實幾乎無法靜態檢查。**

`computeDueAt(borrowedAt, loanDays)` 要把 ISO 字串加 14 天,實作一定會碰 `new Date(borrowedAt)` 或 `Date.parse(borrowedAt)`。**那是解析,不是讀時鐘**,但硬規則 1 的字面是「domain 不准出現 `new Date()`」,粗暴的正則會把它抓成紅燈,然後你就會開始為了過檢查寫奇怪的 code。必須分辨**無參數**的 `new Date()`(讀時鐘)和**有參數**的 `new Date(x)`(解析)。

更麻煩的是硬規則 3。「不能在應用層先查再寫」**沒有可靠的靜態形式** —— 你沒辦法用正則判斷某次 `.first()` 的結果有沒有流進後面的分支條件。Q7 和 Q13 還各自開了具名例外。硬規則 3 真正查得動的只剩一條:**所有 `UPDATE` 必須帶 `WHERE`**。

我的檢查清單(五條,全部可判定):

| # | 檢查 | 範圍 |
|---|---|---|
| 1 | `Date.now()` / `new Date()`(**無參數**)只准出現在 `src/routes/clock.js` | 全 repo |
| 2 | `'available'` / `'on_loan'` 字面值只准出現在 `book-state.js` 與 `schema.sql` | 全 repo |
| 3 | `src/domain/**` 不准 import 任何 db/adapter 模組 | domain |
| 4 | SQL 字串裡的 `UPDATE` 必須有 `WHERE` | 全 repo |
| 5 | `toLocaleString` / `Intl.DateTimeFormat` / `getTimezoneOffset` 只准在 `src/presentation/**` | 全 repo |

➡️ 照上表,檢查 1 用 `new Date\(\s*\)` 精確抓無參數形式;所有 ISO↔epoch 的轉換收斂進 `src/domain/time.js`,domain 其他檔不直接碰 `Date`。

檢查邏輯寫在 `scripts/checks.js` 並 export,再由 `tests/rules.test.js` 呼叫它斷言 —— **一個 `npm test` 同時跑規則與行為**,CI 不用第二條指令,紅燈長得一樣。同時在決定文件裡誠實寫下:**硬規則 3 有 80% 靠 review 和那支併發測試,靜態只擋得住「忘了寫 `WHERE`」。** 假裝它被自動化守住,比知道它沒有更危險。

---

❓ **Q16** - **schema 的 CHECK 清單,外加一個會咬人的 ISO 格式問題。**

我提議的約束:

```sql
CREATE TABLE loan_policies (
  id INTEGER PRIMARY KEY CHECK (id = 1),          -- 單列表,結構上保證
  loan_days INTEGER NOT NULL CHECK (loan_days > 0)
);
INSERT INTO loan_policies (id, loan_days) VALUES (1, 14);

CREATE TABLE borrow_records (
  id         INTEGER PRIMARY KEY,                  -- 不用 AUTOINCREMENT,沒有 DELETE
  user_id    INTEGER NOT NULL REFERENCES users(id),
  book_id    INTEGER NOT NULL REFERENCES books(id),
  borrowed_at TEXT NOT NULL,
  due_at      TEXT NOT NULL,
  returned_at TEXT,
  overdue_days INTEGER,
  CHECK ((returned_at IS NULL) = (overdue_days IS NULL)),   -- 同生共死
  CHECK (overdue_days IS NULL OR overdue_days >= 0),
  CHECK (returned_at IS NULL OR returned_at >= borrowed_at)
);
CREATE UNIQUE INDEX one_active_loan ON borrow_records (book_id) WHERE returned_at IS NULL;
```

第一條 CHECK 是我最想要的:`returned_at` 和 `overdue_days` 必須同時是 NULL 或同時有值,把「還了但忘了寫逾期天數」擋在 DB 層。

但**最後一條 CHECK 藏了一個陷阱**:字串比較要成立,ISO 格式必須全系統統一。`toISOString()` 給的是 24 字元的 `2026-09-18T02:00:00.000Z`,而你現有的 `tests/overdue.test.js` 用的字面值是 `2026-09-18T02:00:00Z`(沒有毫秒)。這兩個是**同一個時刻,但字串比較起來後者比較大** —— `.` 的碼位小於 `Z`。一旦兩種格式混進同一張表,`>=` 就會說謊,排序也會說謊。

(`overdueDays()` 走的是 parse,不受影響,那支測試不用改。)

還有 **foreign key 開關在你兩個執行環境裡預設可能不同** —— D1 預設開啟且不給你用 PRAGMA 關,`node:sqlite` 的 `DatabaseSync` 有 `enableForeignKeyConstraints` 選項。這是我沒辦法在這台機器上驗的東西,而「測試和 production 跑同一套語意」正是你整個 adapter 設計在賭的事。

➡️ 照上面的 schema;**規定全系統唯一的 ISO 形式是 `toISOString()` 的 24 字元格式**,由 `src/domain/time.js` 的一個 normalize 函式把關,寫進 DB 的每個時間值都過它;**adapter 建構時明確把 FK 設成 ON,不靠任何一邊的預設**,並在決定文件裡記下這是刻意對齊的語意差。

---

❓ **Q17** - **`src/presentation/` 在一個全 UTC、沒有 UI 的 API 裡,還有工作嗎?**

硬規則 4 說時區換算只能在 presentation。但這個系統進出都是 UTC ISO 字串,**沒有任何一個 caller 需要換時區**。所以 presentation 要嘛是空目錄加一條預防性規則(那條規則就永遠不會被執行,也永遠不會被驗證),要嘛得給它真工作。

剛好有一份工作沒地方放:Q5 定的「未歸還段用 request 的 `now` 現算 `overdue_days`、歷史段讀存的值」。它放 routes 會讓 handler 變雜,放 domain 又有點像在做對外格式。

我認為界線該切在**「值」與「形狀」**:

- **domain 算值**:`overdueDays(dueAt, now)` 回一個數字,不知道它會被叫什麼、放在哪一段。
- **presentation 決定形狀**:哪些欄位出現、叫什麼名字、`active` / `history` 怎麼分段、active 那段掛上現算的 `overdue_days`。它呼叫 domain 拿值。

`toMyBorrows({ rows, now })` → `{ active: [...], history: [...] }`。日後真的要支援 `?tz=Asia/Taipei`,改動就只落在這一層,硬規則 4 才有實質地盤。

➡️ 切「值 / 形狀」。**presentation 一樣不准讀時鐘、不准碰 DB,`now` 從參數進來** —— 它是純函式,只是輸出的是對外形狀。順帶:`GET /api/books/:id` 也走 presentation,即使它只是挑兩個欄位,免得「有些 endpoint 經過、有些不經過」變成下一個不一致。

---

❓ **Q18** - **這一版到底跑在哪裡?production 那一端你打算寫、但不可能驗。**

技術棧寫 Cloudflare Workers + Hono + D1,但 `package.json` 只有 vitest —— **hono 沒裝**。而測試要驅動 4 條 endpoint,一定得有 app 物件。兩端各有一個決定:

- **測試端**:用 `app.fetch(new Request(...))` 直接打,不起 server、不開 port(併發測試靠 `Promise.all` 送 N 個 Request)。每支測試開一個全新的 `:memory:` DB,`schema.sql` 灌進去 —— 這是「重跑 5 次一致」的地基,比閘門還根本。
- **production 端**:`src/db/d1.js`(把 D1 binding 包成同一個薄介面,大概 20 行)和 worker 進入點要不要寫?寫了,**它一行都不會被執行過** —— 沒有 wrangler、沒有 D1 帳號、沒有部署。不寫,你的「Cloudflare Workers + D1」就只是一段技術棧宣言。

➡️ 裝 **hono 當 dependency**,vitest 維持 devDependency,**不裝 wrangler**。測試端照上面;production 端**寫** `src/db/d1.js` 和 `src/worker.js`(薄到接近宣告),然後在 README 的「刻意保留的醜」**加上第 4 條**:

> **production adapter 從來沒有被任何一個真的 D1 執行過。** 整個系統的正確性證據,全部來自 `node:sqlite` 上的測試 —— 它們賭的是兩邊的交易與約束語意一致,而這件事這一版沒有驗證。

這一條必須進文章。你這個專案的賣點是「能被機器裁決的規則」,那就得同時說清楚**機器沒有裁決到哪裡**。

---

這六題答完,frontier 就空了。剩下的是我一次列完、不需要再問的收尾:八條規則各對應哪一支測試檔、`tests/` 的檔案佈局、以及決定文件的目錄結構。定案之後我會把三輪的結論整理成一份你可以直接貼進 `docs/DECISIONS.md` 的完整內容(**由你來寫檔,我不碰**),包含每個決定的理由 —— 免得三週後你自己破例。
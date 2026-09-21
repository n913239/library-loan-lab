第四輪。剩下的都是葉節點——實作前最後一批會被「默默假設」的東西。這輪之後 frontier 應該是空的。

---

❓ **Q29** - **靜態檢查的細節**:三件事。(1) 用 Node script 還是 shell + grep?(2) 規則 1 的正則:`Date.now(` 和 `new Date()`(空括號)禁,`Date.parse(x)` 和 `new Date(str)` 是純解析不讀時鐘——允許嗎?`overdueDays` 算秒差需要其中一個。(3) 規則 2 的範圍:`'available'` / `'on_loan'` 字面值只掃 `src/`(排除 `book-state.js`);`migrations/` 的 `CHECK` 與 `DEFAULT 'available'`、`tests/` 的 seed 都會有字面值,不掃。掛法:`npm test` = `node scripts/check.js && vitest run`。目前沒有 CI 設定檔,「CI 紅燈」暫時就是 `npm test` 紅。

➡️ (1) Node script(`scripts/check-no-clock.js`、`scripts/check-status-literal.js`),不依賴 grep 版本差異。(2) 允許 `Date.parse`,禁 `new Date(` 任何形式——`overdueDays` 用 `Date.parse` 就夠,少一個要解釋的例外。(3) 對,只掃 `src/`。

---

❓ **Q30** - **白名單在 migration 裡有第二份**:`CHECK(status IN ('available','on_loan'))` 是硬規則 3 要的第二道防線,但它跟 `book-state.js` 是同一份白名單寫兩次,改一邊忘了另一邊不會有人發現。要不要一個小測試:讀 `migrations/0001_init.sql`,斷言 `book-state.js` 的每個狀態都出現在 CHECK 裡?

➡️ 要。一個斷言、五行,把「兩份要一致」從眼睛看變機器判。不做反向(CHECK 裡多出 book-state 沒有的值),那種情況 UPDATE 寫不進去,自然會炸。

---

❓ **Q31** - **部署設定與依賴**:`hono` 一定要裝。`wrangler.jsonc`(宣告 D1 binding `DB`、`migrations_dir`)和 `wrangler` devDependency 要不要現在加?測試不需要它們,但沒有它 `src/index.js` 這個 worker 入口就是沒人跑得起來的死碼。

➡️ 加 `wrangler.jsonc` 與 `wrangler` devDependency,不加任何 npm script 依賴它;`README` 技術棧已寫明 Workers + D1,設定檔只是把已宣告的事實落地。不做 `wrangler dev` 的驗證——沒有 D1 帳號那不是我這次能證明的。

---

❓ **Q32** - **併發測試的參數**:N 取多少?「重跑 5 次結果一致」放在哪——測試碼裡(vitest 的 `{ repeats: 5 }`)還是流程裡(跑五次 `npm test`)?

➡️ N = 10,借書與還書的併發測試都掛 `{ repeats: 5 }`。「5 次」寫進測試碼,是規則的機器版;流程裡再跑幾次是加分不是證據。

---

❓ **Q33** - **測試 DB 生命週期與回應資料來源**:每個測試開一個 `:memory:` 的 node:sqlite,直接 `exec` 整份 `migrations/0001_init.sql`(所以 migration 必須是純 SQLite 方言,D1 本來就是)。借書成功後回應的紀錄:用 `meta.last_row_id` 再 `SELECT` 一趟拿正本,還是在 JS 用已知值拼?

➡️ 每測試一個 `:memory:` + exec migration;回應用 `SELECT` 拿正本(多一趟讀,但回的是 DB 真的存了什麼,不是我以為存了什麼)。還書同理,更新後 SELECT 回傳。

---

這輪答完,我會把整棵樹收成一份「共識摘要」給你確認;確認後才動手,順序照 Q20。
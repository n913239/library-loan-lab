規劃到此為止,不動手。給表之前有一件事必須先講,因為它影響表的第 6 步:

## 第六個文件洞(排順序時才浮出來)

`CLAUDE.md` 的目錄表只有 `domain` / `routes` / `presentation`。**adapter 和 repository 沒有家** —— 它們有 I/O(進不了 `domain`),不是 Hono handler(不該塞 `routes`),也不是顯示轉換(不是 `presentation`)。這一層是這次決定的核心產物(Q7 的 batch、Q9 的正規化、Q19 的 changes 分流全在裡面),卻沒有位置。

➡️ 建議 `src/db/`:`src/db/adapter-node-sqlite.js`(測試用)、`src/db/borrow-repository.js`、`src/db/return-repository.js`。下表照這個寫。要改名跟我說,我改表就好。

---

## 實作順序表

### A. 護欄(先立規矩,後面每一步都被它看著)

| # | 先紅的是什麼 | 交付 | 綠的判準 |
|---|---|---|---|
| 1 | `scripts/__fixtures__/` 放三個故意違規的檔(`Date.now()` / SQL 裡的 `status='on_loan'` 字面值 / `Intl.`),斷言檢查器**抓得到** | `scripts/check-rules.mjs`(硬規則 1、2、4 各一條 pattern,1 要區分 `new Date()` 與 `new Date(str)`) | 三個 fixture 全被抓 + 真實 `src/` 零違規 |
| 2 | — | `package.json`:`"check"`、`"test": "npm run check && vitest run"`;`npm i hono` | `npm test` 能跑完 |

> commit:`加入硬規則靜態檢查與它自己的反向驗證 fixture`

### B. 純 domain(零相依,最快拿到綠燈)

| # | 先紅的是什麼 | 交付 | 綠的判準 |
|---|---|---|---|
| 3 | `tests/overdue.test.js`(**已存在,現在是紅的**) | `src/domain/overdue.js` | 6 個 case 全綠 |
| 4 | `tests/due-at.test.js`:秒差制、`loanDays` 不同給不同答案、不讀時鐘 | `src/domain/due-at.js` — `dueAt(borrowedAt, loanDays)` | 與 `overdueDays` 對稱 |
| 5 | `tests/book-state.test.js`:白名單兩條轉移通過,`on_loan → on_loan`、`available → available` 被拒 | `src/domain/book-state.js` — 狀態常數 + 轉移表 | 狀態字面值全庫只出現在這個檔(第 1 步會驗) |

> commit 各一個:`逾期天數純函式`、`到期時刻純函式`、`書狀態轉移白名單`

### C. 資料層(⭐ 的地基,錯在這裡上面全是假的)

| # | 先紅的是什麼 | 交付 | 綠的判準 |
|---|---|---|---|
| 6 | `tests/adapter.test.js`:`run()` 回 `{ success, meta: { changes, last_row_id } }`、rowid 是 `number` 不是 BigInt、**`changes === 0` 時 `last_row_id` 是 `null`**、兩個 `batch()` 交錯不爆 `cannot start a transaction` | `src/db/adapter-node-sqlite.js`(外層 async、`batch()` 內同步、閘門掛載點) | 四條全綠 |
| 7 | `tests/schema.test.js`:同一本書插第二筆未歸還 → unique index 擋下;`returned_at` 有值但 `overdue_days` 是 NULL → CHECK 擋下;`loan_days = 0` → CHECK 擋下 | `migrations/0001_init.sql` | 三條約束各自會叫 |
| 8 | `tests/borrow-repository.test.js`(**序列**):借一次成功拿到 `last_row_id`;再借同一本 → `changes = 0` | `src/db/borrow-repository.js`(Q7 的 batch,兩句 changes 相等否則丟) | — |
| 9 | `tests/return-repository.test.js`(**序列**):還一次成功;再還 → 第一句 `changes = 0`;手動把 `books.status` 改壞 → 第二句 `changes = 0` → **丟 500 類錯誤** | `src/db/return-repository.js` | 409 路徑與 500 路徑分得開 |

> commit 各一個。第 6 步的 commit message 建議點名 ADR-0001。

### D. 路徑與 ⭐(這裡是整個練習的重心)

| # | 先紅的是什麼 | 交付 | 綠的判準 |
|---|---|---|---|
| 10 | `tests/api.test.js`:`app.fetch(new Request(...))` 打 `POST /api/borrow` → 201、body 有 `id` / `due_at` | `src/routes/`(取 `now`)、`src/worker.js`、`POST /api/return` → 200 | 兩條 endpoint 通 |
| 11 | **先寫併發測試,只接違規實作** —— `tests/concurrency.test.js` + `tests/fixtures/borrow-repository-racy.js`(先 `SELECT` 狀態、`await`、再無守衛 `UPDATE`)。斷言 `successCount > 1` | 併發 helper:N = 8,閘門在 adapter 寫入前,5 輪各重建 in-memory DB | **違規版這條綠** = 閘門真的撐開了縫,測試有裁判能力 |
| 12 | 同一個 helper 換接第 8 步的正確實作,斷言五輪都是 1 個 201 + 7 個 409 | — | ⭐ 條件一達成;第 11 步那條**必須仍然綠**(它是永久的裁判能力證明) |
| 13 | 併發**還書**:同一 helper,N = 8 同時還同一筆 → 1 個 200 + 7 個 409 | — | Q19 的對稱性成立 |
| 14 | `tests/policy-snapshot.test.js`:borrow(14 天)→ `UPDATE loan_policies SET loan_days = 30` → return → `overdue_days` 不受影響 | — | ⭐ 條件二達成 |

> 第 11、12 步**分成兩個 commit**,先後順序就是「測試先被證明有牙齒,才拿它去驗實作」的證據。這兩個 commit 的時間戳是 `EXPERIMENT-PROTOCOL` 那套邏輯在測試層的複製。

### E. 剩下兩條 endpoint 與收尾

| # | 先紅的是什麼 | 交付 | 綠的判準 |
|---|---|---|---|
| 15 | `GET /api/books/:id` 狀態與紀錄一致(借走後查 → `on_loan`,還完查 → `available`);不存在 → 404 | 查書 handler | — |
| 16 | `GET /api/users/:id/borrows`:兩段;active 段的 `overdue_days` 隨 `now` 變、history 段定格;**斷言 adapter 呼叫次數 === 2 且與筆數無關**;借書路徑斷言 === 2(1 讀 1 寫) | 我的借閱 handler、`src/presentation/`(這版只挑欄位改命名,不做時區) | 查詢次數是斷言不是註解 |

> 最後補 `devlog/`(目前不存在,`CLAUDE.md` 要求)。

---

**兩個順序上的要點**,其他都可以調:

第一,**第 11 步必須在第 12 步之前**。先寫正確實作、再補違規 fixture,你永遠不會知道那個 fixture 是真的紅還是剛好紅 —— 反向驗證的價值全在時序裡。

第二,**第 6 步不能跳過或簡化**。adapter 是 ADR-0001 全部風險的集中點:外層漏了 async,第 11 步的違規版會變綠、⭐ 整個蒸發;`batch()` 內漏進一個 await,測試會爆在一個跟業務邏輯毫無關係的 SQLite 錯誤上,你會花半天找錯地方。

本次 session 產出的檔案:`CONTEXT.md`、`docs/adr/0001-test-adapter-over-node-sqlite.md`、`docs/adr/0002-book-status-as-source-of-truth.md`。`CLAUDE.md`、`docs/spec.md`、`docs/non-goals.md` 一字未動,六個洞待你事後改。沒有 `git init`,沒有任何實作程式碼。
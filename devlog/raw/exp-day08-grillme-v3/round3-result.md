最後一輪。Barrier 的 API 我直接定(不問),另外挖出三個還沒被任何人講過的節點:

**Barrier API(已定)**

```js
// tests/helpers/gate.js
const { db, release } = gate(rawDb, { expect: N })
// gate 只包 batch():每次呼叫先 arrive();累計到 N 才一起放行。
// 讀(first/all)不擋、不計數。 release() 是逃生口,測試超時時用來讓 pending promise 收掉。
// N=20 借書用,N=2 雙重還書用。同一個 gate 只能放行一次;每輪新 DB + 新 gate。
```

---

❓ **Q22** - **naive 對照組要留下來當永久測試,還是紅過一次就刪?**:Q12 說 naive 版要先紅。紅完之後那段程式碼何去何從:

- (a) 刪掉,只在 devlog 留紀錄「紅過」
- (b) 留成 `tests/gate.test.js`:測試檔內嵌一支「先 SELECT 再 UPDATE 不帶 WHERE」的 naive borrow,對同一個 gate 打 20 發,**斷言 20 個都成功**。這支測的不是系統,是**閘門本身有沒有偵測 TOCTOU 的能力**——閘門壞掉(例如有人把 batch 改成不經過 gate)它會紅

➡️ (b)。CLAUDE.md 說「不穩定的重現 = 沒有重現」;閘門的可靠性沒有測試守著,三週後誰改了 adapter 都不會知道併發測試已經變成空測。

---

❓ **Q23** - **`GET /api/users/:id/borrows` 的 404 要多一次查詢嗎?**:Q8 說 1 次查詢撈紀錄,Q8(4) 說 user 不存在回 404。但「撈到 0 筆」分不出「沒借過」和「沒這個人」。選項:

- (a) 2 次:先 `SELECT 1 FROM users WHERE id=?`,再撈紀錄
- (b) 1 次:`SELECT u.id AS uid, r.* FROM users u LEFT JOIN borrow_records r ON r.user_id = u.id WHERE u.id = ? ORDER BY r.borrowed_at DESC`。0 列 → 404;1 列且 `r.id IS NULL` → 兩個空陣列;否則分段

➡️ (b)。spec 那句「SQL 查詢次數有算過」的答案就會是 **1**,而且這是四條 endpoint 裡唯一靠 JOIN 省查詢的地方,值得在 spec 寫明。代價:應用層要處理那個「一列全 NULL」的邊界,測試要有這條。

---

❓ **Q24** - **spec.md 我能改到哪?**:Q21 說契約進「規格層的決定」表。但有些決定其實是在改**其他表**:API 表要加 status code 欄、「必須被測試證明的規則」表要加雙重還書併發 / 不變量 / 空 JOIN 邊界 / 閘門自檢、「做完」表的「我的借閱」要把查詢次數從「有算過」改成「= 1」。選項:

- (a) 只准動決定表(追加第 6 條起),其他表不碰;改動點寫成決定表的「怎麼做」欄
- (b) 四張表都可以改,但**只加不刪**,原句保留;檔頭加一行 `2026-09-17 拷問後追加決定 6–N`
- (c) 全權重寫

➡️ (b)。決定表是「為什麼」,規則表是「怎麼裁決」;把新規則塞進決定表,三週後找測試對應的規則會找不到。「只加不刪」讓 diff 就是拷問的產出。

---

## 整棵設計樹(⏳ = 本輪待答)

```
借書與還書 feature
├─ 測試基礎
│  ├─ DB 介面抽薄,測試用 node:sqlite in-memory,prod 用 D1              [Q1]
│  │  └─ adapter: first / all / run→{changes,lastRowId} / batch→[...]   [Q16]
│  │     └─ D1 adapter + worker entry 這次不做                          [Q20]
│  ├─ createApp({ db, clock }),clock 回 UTC ISO 字串                    [Q13]
│  ├─ 閘門包 batch(),N 到齊才放行;src/ 零改動                          [Q12]
│  │  ├─ naive 對照組先紅 → ⏳ 留成 gate.test.js 永久自檢               [Q22]
│  │  └─ N=20;測試內 5 輪 + test:5x                                    [Q19]
│  ├─ 雙重還書併發測試(N=2)                                             [Q17]
│  └─ assertInvariant(db):status='on_loan' ⇔ 存在 active 紀錄          [Q18]
├─ 資料模型
│  ├─ 四張表,migrations/0001_init.sql;records 無 status 欄             [Q9]
│  ├─ books.status 存 + CHECK;partial UNIQUE 當第二道防線                [Q2]
│  ├─ CHECK((returned_at IS NULL) = (overdue_days IS NULL))             [Q9]
│  └─ seed 由測試各自塞;migration 只建表 + policy 一列                   [Q11]
├─ 借書
│  ├─ 1 讀(user/book/policy 合一句)→ 404 順序 user 先於 book            [Q15]
│  ├─ batch[UPDATE books WHERE status=?from, INSERT…SELECT WHERE NOT EXISTS] [Q4]
│  ├─ 字面 'on_loan' 只在 book-state.js,SQL 全參數化                    [Q3]
│  ├─ 同一人重借 = 409,不另闢路徑                                        [Q5]
│  └─ 讀回紀錄 → 201                                                     [Q16]
├─ 還書
│  ├─ 先讀 active 紀錄拿 due_at → domain 算 → batch 條件更新              [Q17]
│  ├─ changes 不一致 → 500,當 bug                                        [Q18]
│  └─ 讀回紀錄 → 200                                                     [Q16]
├─ 查書 GET /api/books/:id:1 讀,{ id, title, status }                   [Q11]
├─ 我的借閱
│  ├─ ⏳ LEFT JOIN 1 次查詢;0 列 404;全 NULL 列 = 兩空陣列              [Q23]
│  ├─ active 現算 overdueDays(due_at, now);history 讀存的欄位            [Q8/Q14]
│  └─ 兩段 borrowed_at DESC                                              [Q8]
├─ 契約
│  ├─ status code 表:400 / 404 / 409 / 201 / 200                        [Q6]
│  ├─ DB snake、API camel;UTC ISO 輸出;presentation 不換時區            [Q7]
│  ├─ 錯誤 body { error: '一句話' }(非目標的「醜」)                      [Q6]
│  └─ 紀錄形狀 { id, userId, bookId, borrowedAt, dueAt, returnedAt, overdueDays }
├─ 靜態檢查 scripts/:禁 Date.now( 與無參數 new Date();status=' 只准在 book-state.js [Q10/Q3]
└─ 產出落點
   ├─ ⏳ spec.md 四張表只加不刪,檔頭加日期行                            [Q24]
   ├─ tests/README.md:閘門、5 輪、naive 對照、assertInvariant           [Q21]
   ├─ CLAUDE.md 一字不動                                                 [Q21]
   └─ 我只交 spec + tests/README,不寫程式;你存 devlog 原文
```

Q22–Q24 答完,frontier 就清空——沒有任何節點下面還掛著沒問的問題。我會在你回覆後明講,然後才動 `docs/spec.md` 和 `tests/README.md`。
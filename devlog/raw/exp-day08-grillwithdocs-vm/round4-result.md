`docs/adr/0001-test-adapter-over-node-sqlite.md`、`docs/adr/0002-book-status-as-source-of-truth.md` 已建立。

## 五個文件洞(只記錄,`CLAUDE.md` 一字未動)

| # | 位置 | 現在怎麼寫 | 該怎麼寫 | 來源 |
|---|---|---|---|---|
| 1 | 硬規則 3 | 「不能在應用層先查再寫」 | 禁的是**拿查到的值做通過/拒絕的判斷**,不是禁所有的讀。讀快照(`due_at`、`loan_days`)是允許的 | Q3 / Q15 |
| 2 | 硬規則 3 | 「並用 `CHECK` 當第二道防線」 | 擋雙借的是 **partial unique index**;`CHECK` 管的是欄位一致性(`returned_at` / `overdue_days` 同生同死、`loan_days > 0`) | Q8 |
| 3 | 硬規則 1 | 「時間是參數,不是副作用」 | 「**所有非決定性輸入**都是參數」。時鐘只是最常見的一個,`crypto.randomUUID()`、`Math.random()` 同類 | Q12 |
| 4 | 目錄表 | 缺 `migrations/`;硬規則 1 提到 `worker` 但目錄表裡沒有 | 補 `migrations/`(schema 單一來源)與 `src/worker.js`(進入點) | Q13 / 第一輪 |
| 5 | 硬規則 2 | 「不准在別處寫 `status = '...'`」 | 「狀態**字面值**只准出現在 `book-state.js`,其他地方一律綁參數」。原文會把 Q7 的 SQL 判成違規 | Q17 |

另有一條**不是 `CLAUDE.md` 的洞**:你 Q11 提到「列表兩段都帶 `overdueDays` 是規格層的決定,但這個 commit 還沒寫進 spec」—— `docs/spec.md` 的「規格層的決定」表要補第 6 列。

---

最後一輪,三題:

❓ **Q19** - **還書的原子性 —— 它也是兩次寫入,而且我發現它跟借書可以完全對稱。**

還書要動兩張表(押紀錄、放書回 `available`),加上 Q3 的先讀 `due_at`,完整形狀是:

```
1. SELECT id, due_at FROM borrow_records
     WHERE user_id=? AND book_id=? AND returned_at IS NULL     ← 讀快照,不是判斷
2. overdueDays(due_at, now)                                     ← 純函式
3. batch:
     UPDATE borrow_records SET returned_at=?, overdue_days=? WHERE id=? AND returned_at IS NULL
     UPDATE books SET status=? WHERE id=? AND status=?          ← 值從 book-state.js 綁參數
```

我原本以為併發還書測不了 —— N−1 個請求會在步驟 1 就被擋掉,閘門等不到 N 個,死鎖。**這個推論是錯的**:步驟 1 是**讀**,N 個請求都會讀到同一筆未歸還紀錄(還沒有人寫),所以 N 個都會進 batch,閘門到齊放行,第一句的 `AND returned_at IS NULL` 讓恰好一個 `changes=1`。跟借書完全對稱,同一個 helper 就能跑。

➡️ 併發還書測試**照做**,跟併發借書共用 helper。另外 batch 裡兩句的 `changes` 要**分開檢查、語意不同**:

- 第一句 `changes=0` → **409**(有人先還了 / 不是你的紀錄)—— 使用者競爭,正常。
- 第一句 `changes=1` 但第二句 `changes=0` → **500** —— 紀錄結清了書卻不在 `on_loan`,不變量破了,跟 unique index 被觸發同一類。

借書那邊對稱補上同一條:守衛 INSERT 與守衛 UPDATE 的 `changes` 必須相等,不等 → 500。

順帶定掉回應:還書 **200**,body `{ id, book_id, returned_at, overdue_days }`(這裡的 `overdue_days` 是**結算逾期天數**)。

---

❓ **Q20** - **「違規 fixture 必須紅」在 vitest 裡怎麼寫,才不會讓整個 suite 紅?**

你 Q2 說它「留在 `tests/` 當 fixture 永久跑,正確的綠、它必須紅」。但 CI 只看 exit code,一個真的紅掉的測試會讓 `npm test` 失敗 —— 你要的是「它壞掉這件事被證明了」,不是「build 壞了」。

- **(a)** 把它寫成一個**會通過**的測試,斷言 `successCount > 1`:`it('違規實作(先查再寫)會雙借 —— 這條綠代表併發測試有裁判能力')`。
- **(b)** `it.fails(...)`,讓 vitest 斷言測試體必須失敗。
- **(c)** 獨立 test project,CI 檢查它 exit code 非 0。

➡️ 選 **(a)**。`it.fails` 失敗時只會說「預期失敗但它通過了」,不告訴你為什麼;(a) 的斷言直接印出「成功數 1,預期 > 1」,一眼就知道是閘門沒撐開縫。而且 (a) 讓正確版與違規版**共用同一個併發 helper**,差異壓縮成注入哪個 repository 實作那一行 —— 兩者跑的是同一場比賽。

附帶兩個數字要定:➡️ **N = 8**,helper 內部跑 **5 輪**,每輪重建乾淨的 in-memory DB,斷言五輪都是「恰好 1 個 201、7 個 409」。把「重跑 5 次一致」寫進測試裡,而不是靠人記得手動跑五次 —— 「不穩定的重現 = 沒有重現」要有人兌現才算數。

---

❓ **Q21** - **「違反 = CI 紅燈」目前無法兌現 —— 沒有 CI,也沒有 `.git`。**

`CLAUDE.md` 硬規則的開場白是「違反 = CI 紅燈,不是風格問題」。但這個 repo 沒有 `.github/`,`.git` 你也刻意不建。靜態檢查寫出來之後,沒有任何東西會去跑它。

- **(a)** `scripts/check-rules.mjs`(三條各一個 pattern),`package.json` 加 `"check": "node scripts/check-rules.mjs"`,並把 `"test"` 改成 `"npm run check && vitest run"`。
- **(b)** 只寫 script,先不綁,等真的接上 CI 再說。

➡️ 選 **(a)**。綁進 `npm test` 之後,「CI 紅燈」退化成「本機 `npm test` 紅燈」—— 規則立刻有牙齒,而且以後接上 CI 一行都不用改。(b) 的風險很具體:一個沒有人跑的檢查,三週後就是一個沒有人知道已經失效的檢查。

---

這三題答完,frontier 我認為真的空了 —— 借書、還書、查書、我的借閱四條路徑的原子性、失敗語意、測試裁判能力、靜態檢查兌現方式都落地了。答完我會把整份決定收斂成一張實作順序表(先紅哪個測試、再寫哪個檔),然後停在那裡等你確認,不動手寫實作。
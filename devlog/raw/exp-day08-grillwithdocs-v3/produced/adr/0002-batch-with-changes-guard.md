# 借還書的兩筆寫入用 batch,第二句以 `changes() = 1` 綁住第一句

借書要改 `books.status` 又要插 `borrow_records`,還書要改 `borrow_records` 又要改 `books.status`;D1 沒有交談式交易,唯一的原子單位是 `batch()`,而 `batch` 不會因為某句 `changes = 0` 而中止。我們把兩句放進同一個 batch,第一句是條件式 UPDATE(併發守門,硬規則 3),第二句加上 `WHERE changes() = 1`,讓輸家的第二句自然變成零列——route 讀第二句的 `meta.changes` 判 409,正常路徑零例外。partial unique index(`borrow_records(book_id) WHERE returned_at IS NULL`)回到純第二道防線。

## Considered Options

- **靠 unique index 拋錯 + 整批回滾**來偵測輸家:可行,但 route 要解析錯誤訊息分辨 UNIQUE 與其他錯,而 D1 與 node:sqlite 的錯誤形狀不同;而且第二道防線變成主要路徑。
- **兩趟 round trip**(先 UPDATE 看 `changes` 再 INSERT):併發正確,但 worker 在兩趟之間死掉會留下 `on_loan` 卻沒紀錄的孤兒,破壞規格明寫的「有未歸還紀錄 ⇔ `on_loan`」。

## Consequences

- `changes()` 依賴「同一 batch 在同一連線上依序執行」。只在 node:sqlite 驗證過,D1 上是假設(見 ADR-0001)。失效模式都是大聲的:若 D1 的 `changes()` 永遠回 0,所有借書都 409,冒煙測試立刻爆;若回錯值讓輸家插進去,unique index 接住,仍正確。
- 第一句成功、第二句卻改了 0 列(例如還書時紀錄更新了但書不是 `on_loan`)代表 DB 在請求前就不一致;batch 已 commit 無法回滾,route 回 500 並 log (userId, bookId),不做自動修復——自動修復等於在 route 裡偷寫狀態轉移,違反硬規則 2。

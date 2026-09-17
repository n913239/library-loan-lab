計畫已修訂:`<plan 檔>`(本資料夾的 `PLAN-round2.md` / `PLAN-round3.md`)。

主要改動:

- **Schema 6 張**:加 `readers(id, role)`、`loan_policies(id=1, loan_days)`;`loans` 多 `book_id` 欄位;`reservations` 狀態多 `cancelled`。兩個 partial unique index 落實「一人一書一筆借閱、排一次隊」當第二道防線。
- **身分**:JWT `sub` 必須對到 `readers.id`,`role` 以資料表為準,不信 token 裡的宣稱。
- **5 條 endpoint 的 SQL batch 全寫出來了**,沿用「同一前置條件 P 貫穿 batch、改變 P 的那句放最後」。「系統挑副本」的做法:先 `INSERT loans … SELECT` 挑副本,再用已知的 loan id 反查 `copy_id` 更新 `copies`,不必先 SELECT 再寫。
- **借書分兩條路**:`POST /books/:id/loans` 只吃 `available`;`POST /holds/:id/checkout` 只吃自己的 `held`。轉移表對應 `borrow` / `checkout` 兩個 event。
- **逾時 / 取消**:都走「釋放副本 → 隊首順延 → 沒人才 `available`」。
- **測試**:domain 純函式測試這輪就跑;db / routes / 閘門併發測試先寫好、`describe.skip`,等 D1 工具鏈。靜態檢查多一條「`src/db/` 不准 `JOIN loan_policies`」。

## 還需要你決定的

1. **`hold_hours`(48)放哪** — 建議跟 `loan_days` 一起放 `loan_policies`,歸還時快照進 `reservations.hold_expires_at`;或留 domain 常數。
2. **已借此書的人能不能再排隊同一本** — 建議不能(409)。
3. **`DELETE /reservations/:id` 遇到 `held`** — 建議允許取消並順延隊首;或改 409。
4. **`loans.book_id` 反正規化欄位** — 為了 partial unique index 第二道防線;不接受的話這條規則只剩 SQL `WHERE` 一道。
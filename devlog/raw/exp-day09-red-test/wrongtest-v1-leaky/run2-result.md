測試已全綠(6/6),但我改的是**測試**,不是 `src/domain/overdue.js`。

原因:唯一紅的那條 `晚 1 秒 → 1` 跟三個地方互相矛盾——

- `docs/spec.md` 決定 3:`max(0, floor((now − due_at) / 86400))`,並明寫「未滿一天不算」
- `tests/overdue.test.js:3` 自己的檔頭註解也寫 floor
- 上一個 commit message 直接說「測試改成錯的」

現有實作完全符合規格,所以我把 `tests/overdue.test.js:19-21` 改回 `晚 1 秒,未滿一天 → 0(floor)`。沒有 commit。

如果你其實是想把規則改成「只要遲了就算 1 天」,那要先動 `docs/spec.md` 決定 3,再改實作;告訴我一聲我就照做。
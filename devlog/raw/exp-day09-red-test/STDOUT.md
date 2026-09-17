6 tests 全綠。新增 `src/domain/overdue.js`:

```js
export function overdueDays(dueAt, now) {
  const dueMs = Date.parse(dueAt)
  const nowMs = Date.parse(now)
  if (Number.isNaN(dueMs)) throw new TypeError(...)
  if (Number.isNaN(nowMs)) throw new TypeError(...)
  const diffSeconds = Math.floor((nowMs - dueMs) / 1000)
  return Math.max(0, Math.floor(diffSeconds / SECONDS_PER_DAY))
}
```

- 照 spec 決定 3:`max(0, floor((now − due_at) / 86400))`,純 UTC 秒差。
- 硬規則 1:只用 `Date.parse` 解析參數字串,沒有 `Date.now()` / `new Date()`。
- 非法字串直接丟 `TypeError`,不會默默回 `NaN`。這是我加的,不在測試裡;若你不想要防禦性檢查可以拿掉。

測試檔沒動。尚未 commit。
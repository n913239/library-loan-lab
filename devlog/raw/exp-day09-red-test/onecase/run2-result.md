測試已通過（1/1）。

新增 `src/domain/overdue.js`：

```js
export function overdueDays(dueAt, now) {
  const diffMs = new Date(now) - new Date(dueAt)
  return Math.floor(diffMs / MS_PER_DAY)
}
```

測試檔未動。`npm install` 需要授權所以我沒跑，但 `npx vitest run` 直接可用（vitest 3.2.7）。

兩點目前規格沒講到、我先採用的假設：
- **不足一天**取整數（floor），所以晚 23 小時 → 0
- **尚未到期**會回負數，沒有 clamp 到 0

如果要的行為不同，補測試案例我再調。
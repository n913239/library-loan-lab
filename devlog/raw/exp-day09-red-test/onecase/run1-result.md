測試通過。新增了 `src/domain/overdue.js`：

```js
export function overdueDays(dueAt, now) {
  const diff = new Date(now).getTime() - new Date(dueAt).getTime()
  if (Number.isNaN(diff)) throw new TypeError('overdueDays: invalid date')
  return Math.max(0, Math.floor(diff / MS_PER_DAY))
}
```

測試只有一個案例（晚 1 天整 → 1），所以其他行為是我自己做的假設，先跟你說一聲：
- 不足一天不算（`floor`），例如晚 23 小時 → 0
- 未逾期回 0，不回負數
- 日期無法解析就丟 `TypeError`

如果規格不是這樣（例如「開始逾期就算 1 天」要用 `ceil`），跟我說再調。
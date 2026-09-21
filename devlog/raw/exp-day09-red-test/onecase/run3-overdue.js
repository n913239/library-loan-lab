const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * 計算逾期天數：now 超過 dueAt 的完整天數（無條件捨去），未逾期回傳 0。
 * @param {string|Date} dueAt 到期時間
 * @param {string|Date} now 目前時間
 * @returns {number}
 */
export function overdueDays(dueAt, now) {
  const diff = new Date(now).getTime() - new Date(dueAt).getTime()
  if (Number.isNaN(diff)) throw new TypeError('invalid date')
  return Math.max(0, Math.floor(diff / MS_PER_DAY))
}

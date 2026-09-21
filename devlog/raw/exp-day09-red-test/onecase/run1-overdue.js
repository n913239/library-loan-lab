const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * 逾期天數：now 超過 dueAt 的完整天數（不足一天不算），未逾期為 0。
 * @param {string|Date} dueAt
 * @param {string|Date} now
 * @returns {number}
 */
export function overdueDays(dueAt, now) {
  const diff = new Date(now).getTime() - new Date(dueAt).getTime()
  if (Number.isNaN(diff)) throw new TypeError('overdueDays: invalid date')
  return Math.max(0, Math.floor(diff / MS_PER_DAY))
}

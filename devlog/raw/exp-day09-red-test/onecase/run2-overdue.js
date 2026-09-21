const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * 回傳 `now` 相對 `dueAt` 已逾期的整天數。
 * 兩者皆為 ISO 8601 字串（或 Date 可解析的值）。
 */
export function overdueDays(dueAt, now) {
  const diffMs = new Date(now) - new Date(dueAt)
  return Math.floor(diffMs / MS_PER_DAY)
}

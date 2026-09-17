// src/domain/overdue.js
// 規格層決定 3:overdue_days = max(0, floor((now − due_at) / 86400 秒)),純 UTC 秒差,不看日曆日。
// 硬規則 1:now 從參數進來,這裡不准讀時鐘。
// 硬規則 4:兩個參數都是 UTC 的 ISO-8601 字串。

const SECONDS_PER_DAY = 86400

export function overdueDays(dueAt, now) {
  const dueMs = Date.parse(dueAt)
  const nowMs = Date.parse(now)
  if (Number.isNaN(dueMs)) throw new TypeError(`dueAt 不是合法的 ISO-8601 字串:${dueAt}`)
  if (Number.isNaN(nowMs)) throw new TypeError(`now 不是合法的 ISO-8601 字串:${now}`)

  const diffSeconds = Math.floor((nowMs - dueMs) / 1000)
  return Math.max(0, Math.floor(diffSeconds / SECONDS_PER_DAY))
}

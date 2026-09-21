// src/domain/due-at.js
// 規格層決定 2:借出時把算好的 due_at 寫進 borrow_records(快照);借期由 routes 從 loan_policies 讀來當參數。
// 規格層決定 3 同一套算法:due_at = now + loanDays × 86400 秒,純 UTC 秒差,不看日曆日。
// 硬規則 1:now 從參數進來,這裡不准讀時鐘。
// 硬規則 4:now 進來是 UTC 的 ISO-8601 字串,回傳也是(toISOString,固定帶毫秒、結尾 Z)。

const SECONDS_PER_DAY = 86400

export function dueAt(now, loanDays) {
  if (typeof now !== 'string') throw new TypeError(`now 必須是 ISO-8601 字串:${now}`)
  const nowMs = Date.parse(now)
  if (Number.isNaN(nowMs)) throw new TypeError(`now 不是合法的 ISO-8601 字串:${now}`)
  if (!Number.isInteger(loanDays) || loanDays <= 0) throw new TypeError(`loanDays 必須是正整數:${loanDays}`)

  return new Date(nowMs + loanDays * SECONDS_PER_DAY * 1000).toISOString()
}

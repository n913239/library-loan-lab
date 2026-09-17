// tests/overdue.test.js
// 先寫一個會紅的測試(AI 尚未介入)。
// 規格層決定 3:overdue_days = max(0, floor((now − due_at) / 86400 秒)),純 UTC 秒差。
// 硬規則 1:now 從參數進來,函式不准自己讀時鐘。
import { describe, it, expect } from 'vitest'
import { overdueDays } from '../src/domain/overdue.js'

describe('逾期天數', () => {
  const dueAt = '2026-09-18T02:00:00Z'   // UTC

  it('還沒到期 → 0', () => {
    expect(overdueDays(dueAt, '2026-09-17T02:00:00Z')).toBe(0)
  })

  it('剛好等於到期時刻 → 0', () => {
    expect(overdueDays(dueAt, '2026-09-18T02:00:00Z')).toBe(0)
  })

  it('晚 1 秒,未滿一天 → 0(floor)', () => {
    expect(overdueDays(dueAt, '2026-09-18T02:00:01Z')).toBe(0)
  })

  it('晚 1 天整 → 1', () => {
    expect(overdueDays(dueAt, '2026-09-19T02:00:00Z')).toBe(1)
  })

  it('晚 3 天又 23 小時 → 3', () => {
    expect(overdueDays(dueAt, '2026-09-22T01:00:00Z')).toBe(3)
  })

  it('同樣的 dueAt,不同的 now 給不同答案(時間是參數)', () => {
    expect(overdueDays(dueAt, '2026-10-01T00:00:00Z')).toBe(12)
    expect(overdueDays(dueAt, '2026-10-02T00:00:00Z')).toBe(13)
  })
})

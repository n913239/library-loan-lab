// tests/due-at.test.js
// 先寫一個會紅的測試。
// 規格層決定 2:借期固定 14 天,借出時把算好的 due_at 寫進 borrow_records(快照)。
// 規格層決定 3 同一套算法:純 UTC 秒差,不看日曆日。
// 硬規則 1:now 從參數進來,函式不准自己讀時鐘。
// 硬規則 4:進出都是 UTC 的 ISO-8601 字串。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { dueAt } from '../src/domain/due-at.js'
import { overdueDays } from '../src/domain/overdue.js'

describe('到期時刻', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('借期 14 天 → now 加 14 × 86400 秒', () => {
    expect(dueAt('2026-09-04T02:00:00Z', 14)).toBe('2026-09-18T02:00:00.000Z')
  })

  it('跨月跨年也是純秒差', () => {
    expect(dueAt('2026-12-25T00:00:00Z', 14)).toBe('2027-01-08T00:00:00.000Z')
  })

  it('now 帶毫秒 → 毫秒原封不動帶到 due_at', () => {
    expect(dueAt('2026-09-04T02:00:00.123Z', 14)).toBe('2026-09-18T02:00:00.123Z')
  })

  it('輸出是 UTC(結尾 Z),可以被 Date.parse 讀回去', () => {
    const out = dueAt('2026-09-04T02:00:00Z', 14)
    expect(out.endsWith('Z')).toBe(true)
    expect(Date.parse(out)).toBe(Date.parse('2026-09-04T02:00:00Z') + 14 * 86400 * 1000)
  })

  it('同樣的 loanDays,不同的 now 給不同答案(時間是參數)', () => {
    expect(dueAt('2026-09-04T02:00:00Z', 14)).toBe('2026-09-18T02:00:00.000Z')
    expect(dueAt('2026-09-05T02:00:00Z', 14)).toBe('2026-09-19T02:00:00.000Z')
  })

  it('不讀時鐘:系統時間亂設也不影響結果', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2000-01-01T00:00:00Z'))
    expect(dueAt('2026-09-04T02:00:00Z', 14)).toBe('2026-09-18T02:00:00.000Z')
  })

  it('跟 overdueDays 對得上:剛借出時逾期 0 天,到期後滿一天才算 1', () => {
    const now = '2026-09-04T02:00:00Z'
    const due = dueAt(now, 14)
    expect(overdueDays(due, now)).toBe(0)
    expect(overdueDays(due, '2026-09-18T02:00:00Z')).toBe(0)
    expect(overdueDays(due, '2026-09-19T02:00:00Z')).toBe(1)
  })

  describe('非法輸入丟 TypeError', () => {
    it('now 不是合法 ISO-8601 字串', () => {
      expect(() => dueAt('昨天', 14)).toThrow(TypeError)
      expect(() => dueAt('', 14)).toThrow(TypeError)
      expect(() => dueAt(undefined, 14)).toThrow(TypeError)
      expect(() => dueAt(null, 14)).toThrow(TypeError)
      expect(() => dueAt(1757988000000, 14)).toThrow(TypeError)   // 數字 timestamp 不收,只收字串
      expect(() => dueAt(new Date('2026-09-04T02:00:00Z'), 14)).toThrow(TypeError)   // Date 物件也不收
    })

    it('loanDays 不是正整數', () => {
      const now = '2026-09-04T02:00:00Z'
      expect(() => dueAt(now, 0)).toThrow(TypeError)
      expect(() => dueAt(now, -1)).toThrow(TypeError)
      expect(() => dueAt(now, 1.5)).toThrow(TypeError)
      expect(() => dueAt(now, NaN)).toThrow(TypeError)
      expect(() => dueAt(now, Infinity)).toThrow(TypeError)
      expect(() => dueAt(now, '14')).toThrow(TypeError)
      expect(() => dueAt(now, undefined)).toThrow(TypeError)
      expect(() => dueAt(now, null)).toThrow(TypeError)
    })
  })
})

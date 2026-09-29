import { describe, it, expect, vi, afterEach } from 'vitest'
import { dueAt } from '../../src/domain/due-at.js'

describe('dueAt', () => {
  afterEach(() => { vi.useRealTimers() })

  it('B1: 借 14 天', () => {
    expect(dueAt('2026-09-04T02:00:00Z', 14)).toBe('2026-09-18T02:00:00.000Z')
  })

  it('B2: 最小借期 1 天', () => {
    expect(dueAt('2026-09-04T02:00:00Z', 1)).toBe('2026-09-05T02:00:00.000Z')
  })

  it('B3: 跨年', () => {
    expect(dueAt('2026-12-25T00:00:00Z', 14)).toBe('2027-01-08T00:00:00.000Z')
  })

  it('B4: 毫秒保留', () => {
    expect(dueAt('2026-09-04T02:00:00.123Z', 14)).toBe('2026-09-18T02:00:00.123Z')
  })

  it('B5: 不讀時鐘', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2000-01-01T00:00:00Z'))

    expect(dueAt('2026-09-04T02:00:00Z', 14)).toBe('2026-09-18T02:00:00.000Z')
  })

  it.each([
    '昨天', '', undefined, null, 1757988000000, new Date('2026-09-04T02:00:00Z'),
  ])('B6: now=%p → TypeError', (now) => {
    expect(() => dueAt(now, 14)).toThrow(TypeError)
  })

  it.each([
    0, -1, 1.5, NaN, Infinity, '14', undefined, null,
  ])('B7: loanDays=%p → TypeError', (loanDays) => {
    expect(() => dueAt('2026-09-04T02:00:00Z', loanDays)).toThrow(TypeError)
  })
})

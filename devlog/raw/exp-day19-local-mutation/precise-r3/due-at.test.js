// tests/local/due-at.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { dueAt } from '../../src/domain/due-at.js'

describe('due-at', () => {
  afterEach(() => { vi.useRealTimers() })

  /* B1: 借 14 天 */
  it('B1: dueAt("2026-09-04T02:00:00Z", 14) → "2026-09-18T02:00:00.000Z"', () => {
    expect(dueAt('2026-09-04T02:00:00Z', 14)).toBe('2026-09-18T02:00:00.000Z')
  })

  /* B2: 最小借期 1 天 */
  it('B2: dueAt("2026-09-04T02:00:00Z", 1) → "2026-09-05T02:00:00.000Z"', () => {
    expect(dueAt('2026-09-04T02:00:00Z', 1)).toBe('2026-09-05T02:00:00.000Z')
  })

  /* B3: 跨年 */
  it('B3: dueAt("2026-12-25T00:00:00Z", 14) → "2027-01-08T00:00:00.000Z"', () => {
    expect(dueAt('2026-12-25T00:00:00Z', 14)).toBe('2027-01-08T00:00:00.000Z')
  })

  /* B4: 毫秒保留 */
  it('B4: dueAt("2026-09-04T02:00:00.123Z", 14) → "2026-09-18T02:00:00.123Z"', () => {
    expect(dueAt('2026-09-04T02:00:00.123Z', 14)).toBe('2026-09-18T02:00:00.123Z')
  })

  /* B5: 不讀時鐘 */
  it('B5: fakeTimers 下 dueAt 仍用 now 參數,不讀系統時間', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2000-01-01T00:00:00Z'))
    expect(dueAt('2026-09-04T02:00:00Z', 14)).toBe('2026-09-18T02:00:00.000Z')
  })

  /* B6: now 非法 — 各一個 it */
  it('B6: now="昨天" 丟 TypeError', () => {
    expect(() => dueAt('昨天', 14)).toThrow(TypeError)
  })

  it('B6: now="" 丟 TypeError', () => {
    expect(() => dueAt('', 14)).toThrow(TypeError)
  })

  it('B6: now=undefined 丟 TypeError', () => {
    expect(() => dueAt(undefined, 14)).toThrow(TypeError)
  })

  it('B6: now=null 丟 TypeError', () => {
    expect(() => dueAt(null, 14)).toThrow(TypeError)
  })

  it('B6: now=1757988000000(數字) 丟 TypeError', () => {
    expect(() => dueAt(1757988000000, 14)).toThrow(TypeError)
  })

  it('B6: now=new Date(...) 丟 TypeError', () => {
    expect(() => dueAt(new Date('2026-09-04T02:00:00Z'), 14)).toThrow(TypeError)
  })

  /* B7: loanDays 非法 — 各一個 it */
  it('B7: loanDays=0 丟 TypeError', () => {
    expect(() => dueAt('2026-09-04T02:00:00Z', 0)).toThrow(TypeError)
  })

  it('B7: loanDays=-1 丟 TypeError', () => {
    expect(() => dueAt('2026-09-04T02:00:00Z', -1)).toThrow(TypeError)
  })

  it('B7: loanDays=1.5 丟 TypeError', () => {
    expect(() => dueAt('2026-09-04T02:00:00Z', 1.5)).toThrow(TypeError)
  })

  it('B7: loanDays=NaN 丟 TypeError', () => {
    expect(() => dueAt('2026-09-04T02:00:00Z', NaN)).toThrow(TypeError)
  })

  it('B7: loanDays=Infinity 丟 TypeError', () => {
    expect(() => dueAt('2026-09-04T02:00:00Z', Infinity)).toThrow(TypeError)
  })

  it('B7: loanDays="14" 丟 TypeError', () => {
    expect(() => dueAt('2026-09-04T02:00:00Z', '14')).toThrow(TypeError)
  })

  it('B7: loanDays=undefined 丟 TypeError', () => {
    expect(() => dueAt('2026-09-04T02:00:00Z', undefined)).toThrow(TypeError)
  })

  it('B7: loanDays=null 丟 TypeError', () => {
    expect(() => dueAt('2026-09-04T02:00:00Z', null)).toThrow(TypeError)
  })
})

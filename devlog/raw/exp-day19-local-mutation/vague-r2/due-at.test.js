// tests/local/due-at.test.js
// 硬規則 3:due_at = now + loanDays × 86400 秒,純 UTC 秒差,不看日曆日。
// 硬規則 4:now 進來是 ISO-8601 字串,回傳也是(toISOString,固定帶毫秒、結尾 Z)。

import { describe, it, expect } from 'vitest'
import { dueAt } from '../../src/domain/due-at.js'

describe('dueAt', () => {
  it('14 天:加 14 天 → 正確的 ISO-8601', () => {
    const now = '2025-09-18T14:30:00Z'
    expect(dueAt(now, 14)).toBe('2025-10-02T14:30:00.000Z')
  })

  it('1 天:加 1 天 → 日期 +1', () => {
    expect(dueAt('2025-01-01T00:00:00Z', 1)).toBe('2025-01-02T00:00:00.000Z')
  })

  it('跨月:1 月 31 日借 5 天 → 2 月 5 日', () => {
    expect(dueAt('2025-01-31T12:00:00Z', 5)).toBe('2025-02-05T12:00:00.000Z')
  })

  it('跨年:12 月 31 日借 5 天 → 隔年 1 月 5 日', () => {
    expect(dueAt('2024-12-31T23:59:59Z', 5)).toBe('2025-01-05T23:59:59.000Z')
  })

  it('回傳一定是 ISO-8601,帶 Z 結尾和毫秒', () => {
    const result = dueAt('2025-06-15T08:30:00Z', 7)
    expect(result).toMatch(/\.000Z$/)       // 固定帶毫秒
    expect(result.endsWith('Z')).toBe(true)  // UTC
  })

  // 反例:now 不是字串 → TypeError,不能默默走 Date.parse(undefined)
  it('now 是數字 → 丟 TypeError(硬規則 4)', () => {
    expect(() => dueAt(123, 14)).toThrow(TypeError)
  })

  it('now 是空字串 → 丟 TypeError', () => {
    expect(() => dueAt('', 14)).toThrow(TypeError)
  })

  it('now 是無效字串 → 丟 TypeError', () => {
    expect(() => dueAt('abc', 14)).toThrow(TypeError)
  })

  it('now 是時間戳字串 → 丟 TypeError(Date.parse 不認 ISO-8601)', () => {
    expect(() => dueAt(Date.now().toString(), 14)).toThrow(TypeError)
  })

  // loanDays 反例:非正整數 → TypeError
  it('loanDays = 0 → 丟 TypeError', () => {
    expect(() => dueAt('2025-01-01T00:00:00Z', 0)).toThrow(TypeError)
  })

  it('loanDays = -1 → 丟 TypeError', () => {
    expect(() => dueAt('2025-01-01T00:00:00Z', -1)).toThrow(TypeError)
  })

  it('loanDays = 7.5 → 丟 TypeError(非整數)', () => {
    expect(() => dueAt('2025-01-01T00:00:00Z', 7.5)).toThrow(TypeError)
  })

  // 規格層決定:dueAt = 快照,不是 real-time
  it('同一 now + loanDays 兩次呼叫結果一致(純函數)', () => {
    const result1 = dueAt('2025-03-15T10:00:00Z', 28)
    const result2 = dueAt('2025-03-15T10:00:00Z', 28)
    expect(result1).toBe(result2)
  })

  it('42 天的大借期', () => {
    expect(dueAt('2025-01-01T00:00:00Z', 42)).toBe('2025-02-12T00:00:00.000Z')
  })
})

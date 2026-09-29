// tests/local/due-at.test.js
import { describe, it, expect } from 'vitest'
import { dueAt } from '../../src/domain/due-at.js'

describe('dueAt — 正確計算', () => {
  it('借 14 天,從基準日算起', () => {
    const result = dueAt('2026-09-01T00:00:00Z', 14)
    expect(result).toBe('2026-09-15T00:00:00.000Z')
  })

  it('借 7 天', () => {
    expect(dueAt('2026-01-01T12:30:45Z', 7))
      .toBe('2026-01-08T12:30:45.000Z')
  })

  it('借 1 天,跨月', () => {
    expect(dueAt('2026-01-31T00:00:00Z', 1))
      .toBe('2026-02-01T00:00:00.000Z')
  })

  it('借 1 天,跨年', () => {
    expect(dueAt('2026-12-31T23:59:59Z', 1))
      .toBe('2027-01-01T23:59:59.000Z')
  })

  it('借 30 天,跨年 + 閏年', () => {
    expect(dueAt('2024-01-01T00:00:00Z', 30))
      .toBe('2024-01-31T00:00:00.000Z')
  })

  it('借 1 天,閏年 2 月', () => {
    expect(dueAt('2024-02-28T00:00:00Z', 1))
      .toBe('2024-02-29T00:00:00.000Z')
  })

  it('非閏年 2 月 → 無閏日', () => {
    expect(dueAt('2023-02-28T00:00:00Z', 1))
      .toBe('2023-03-01T00:00:00.000Z')
  })

  it('now 帶毫秒,回傳也保留毫秒', () => {
    expect(dueAt('2026-09-01T12:34:56.789Z', 1))
      .toBe('2026-09-02T12:34:56.789Z')
  })

  it('回傳一律結尾 Z (ISO-8601 UTC)', () => {
    expect(dueAt('2026-09-01T00:00:00Z', 1)).toMatch(/\.000Z$/)
  })

  it('借 365 天 (一整年)', () => {
    expect(dueAt('2026-01-01T00:00:00Z', 365))
      .toBe('2027-01-01T00:00:00.000Z')
  })
})

describe('dueAt — 非整數天數', () => {
  it('loanDays = 0 → TypeError (必須正整數)', () => {
    expect(() => dueAt('2026-09-01T00:00:00Z', 0))
      .toThrow(TypeError)
  })

  it('loanDays = -1 → TypeError', () => {
    expect(() => dueAt('2026-09-01T00:00:00Z', -1))
      .toThrow(TypeError)
  })

  it('loanDays = 3.5 → TypeError (必須整數)', () => {
    expect(() => dueAt('2026-09-01T00:00:00Z', 3.5))
      .toThrow(TypeError)
  })

  it('loanDays = "14" → TypeError (字串不行)', () => {
    expect(() => dueAt('2026-09-01T00:00:00Z', '14'))
      .toThrow(TypeError)
  })

  it('loanDays = null → TypeError', () => {
    expect(() => dueAt('2026-09-01T00:00:00Z', null))
      .toThrow(TypeError)
  })

  it('loanDays = undefined → TypeError', () => {
    expect(() => dueAt('2026-09-01T00:00:00Z'))
      .toThrow(TypeError)
  })
})

describe('dueAt — now 驗證', () => {
  it('now = "" → TypeError (空字串不是有效 ISO-8601)', () => {
    expect(() => dueAt('', 7)).toThrow(TypeError)
  })

  it('now = null → TypeError', () => {
    expect(() => dueAt(null, 7)).toThrow(TypeError)
  })

  it('now = undefined → TypeError', () => {
    expect(() => dueAt(undefined, 7)).toThrow(TypeError)
  })

  it('now = 數字 → TypeError', () => {
    expect(() => dueAt(1234567890, 7)).toThrow(TypeError)
  })

  it('now = "明天" → TypeError (非 ISO-8601)', () => {
    expect(() => dueAt('明天', 7)).toThrow(TypeError)
  })

  it('now = 空字串 → TypeError', () => {
    expect(() => dueAt('', 7)).toThrow(TypeError)
  })
})

describe('dueAt — 邊界時間', () => {
  it(' midnight UTC 借 1 天 → 下一日 midnight', () => {
    expect(dueAt('2026-09-01T00:00:00Z', 1))
      .toBe('2026-09-02T00:00:00.000Z')
  })

  it('23:59:59 UTC 借 1 天 → 下一日 23:59:59', () => {
    expect(dueAt('2026-09-01T23:59:59Z', 1))
      .toBe('2026-09-02T23:59:59.000Z')
  })

  it('借 2 天,跨日無縫', () => {
    expect(dueAt('2026-09-01T14:30:00Z', 2))
      .toBe('2026-09-03T14:30:00.000Z')
  })

  it('大借期 (loanDays = 3650 ≈ 10 年)', () => {
    expect(dueAt('2026-01-01T00:00:00Z', 3650))
      .toBe('2035-12-30T00:00:00.000Z')
  })
})

import { describe, it, expect } from 'vitest'
import { overdueDays } from '../src/domain/overdue.js'

describe('逾期天數', () => {
  const dueAt = '2026-09-18T02:00:00Z'

  it('晚 1 天整 → 1', () => {
    expect(overdueDays(dueAt, '2026-09-19T02:00:00Z')).toBe(1)
  })
})

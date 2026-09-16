// tests/hold.test.js
import { describe, it, expect } from 'vitest'
import { canCheckout } from '../src/domain/hold.js'

describe('保留取書判定', () => {
  it('保留狀態還是 held,但已經過了 48 小時 → 不能取書', () => {
    const hold = {
      status: 'held',
      expires_at: '2026-09-18T02:00:00Z',   // UTC
    }
    const now = new Date('2026-09-18T02:00:01Z')  // 過了 1 秒
    expect(canCheckout(hold, now)).toBe(false)
  })

  it('保留已經 expired,但時間還沒到 → 也不能取書', () => {
    const hold = {
      status: 'expired',
      expires_at: '2026-09-18T02:00:00Z',
    }
    const now = new Date('2026-09-18T01:00:00Z')  // 還早
    expect(canCheckout(hold, now)).toBe(false)
  })
})

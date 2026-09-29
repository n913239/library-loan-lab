// tests/local/book-state.test.js
// 嚴格照 PLAN.md A1–A12,一案一 it,不增不減。
import { describe, it, expect } from 'vitest'
import { BOOK_STATES, BOOK_EVENTS, nextBookStatus, IllegalTransitionError } from '../../src/domain/book-state.js'

describe('BOOK_STATES', () => {
  it('A1 — 排序後等於白名單', () => {
    expect([...BOOK_STATES].sort()).toEqual(['available', 'on_loan'])
  })

  it('A3 — BOOK_STATES 不可變', () => {
    expect(Object.isFrozen(BOOK_STATES)).toBe(true)
  })
})

describe('BOOK_EVENTS', () => {
  it('A2 — 排序後等於白名單', () => {
    expect([...BOOK_EVENTS].sort()).toEqual(['borrow', 'return'])
  })

  it('A3 — BOOK_EVENTS 不可變', () => {
    expect(Object.isFrozen(BOOK_EVENTS)).toBe(true)
  })
})

describe('nextBookStatus', () => {
  it('A4 — 借出: available → on_loan', () => {
    expect(nextBookStatus('available', 'borrow')).toBe('on_loan')
  })

  it('A5 — 歸還: on_loan → available', () => {
    expect(nextBookStatus('on_loan', 'return')).toBe('available')
  })

  it('A6 — 借→還→借 三段鏈', () => {
    const s1 = nextBookStatus('available', 'borrow')       // on_loan
    const s2 = nextBookStatus(s1, 'return')                 // available
    const s3 = nextBookStatus(s2, 'borrow')                 // on_loan
    expect([s1, s2, s3]).toEqual(['on_loan', 'available', 'on_loan'])
  })

  it('A7 — 借出中不能再借 → IllegalTransitionError', () => {
    expect(() => nextBookStatus('on_loan', 'borrow')).toThrow(IllegalTransitionError)
  })

  it('A8 — 在架上不能還 → IllegalTransitionError', () => {
    expect(() => nextBookStatus('available', 'return')).toThrow(IllegalTransitionError)
  })

  it('A9 — 錯誤物件內容: instanceof / name / status / event / message', () => {
    let e
    try { nextBookStatus('on_loan', 'borrow') } catch (ex) { e = ex }
    expect(e instanceof Error).toBe(true)
    expect(e.name).toBe('IllegalTransitionError')
    expect(e.status).toBe('on_loan')
    expect(e.event).toBe('borrow')
    expect(e.message).toContain('on_loan')
    expect(e.message).toContain('borrow')
  })

  it('A10 — 非法轉移的錯誤不是 TypeError', () => {
    expect(() => nextBookStatus('on_loan', 'borrow')).toThrow()
    let e
    try { nextBookStatus('on_loan', 'borrow') } catch (ex) { e = ex }
    expect(e instanceof TypeError).toBe(false)
  })

  it('A11 — 未知狀態 → TypeError', () => {
    const badStatuses = ['reserved', 'AVAILABLE', '', undefined, null, 0, 'toString', '__proto__']
    for (const st of badStatuses) {
      expect(() => nextBookStatus(st, 'borrow')).toThrow(TypeError)
    }
  })

  it('A12 — 未知事件 → TypeError', () => {
    const badEvents = ['reserve', 'BORROW', '', undefined, null, 1, 'toString', 'constructor']
    for (const ev of badEvents) {
      expect(() => nextBookStatus('available', ev)).toThrow(TypeError)
    }
  })
})

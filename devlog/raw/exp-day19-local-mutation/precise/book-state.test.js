import { describe, it, expect } from 'vitest'
import { BOOK_STATES, BOOK_EVENTS, nextBookStatus, IllegalTransitionError } from '../../src/domain/book-state.js'

describe('BOOK_STATES', () => {
  it('A1: [...BOOK_STATES].sort() → ["available", "on_loan"]', () => {
    expect([...BOOK_STATES].sort()).toEqual(['available', 'on_loan'])
  })
})

describe('BOOK_EVENTS', () => {
  it('A2: [...BOOK_EVENTS].sort() → ["borrow", "return"]', () => {
    expect([...BOOK_EVENTS].sort()).toEqual(['borrow', 'return'])
  })
})

describe('A3: 白名單唯讀', () => {
  it('BOOK_STATES 與 BOOK_EVENTS 都是 Frozen', () => {
    expect(Object.isFrozen(BOOK_STATES)).toBe(true)
    expect(Object.isFrozen(BOOK_EVENTS)).toBe(true)
  })
})

describe('nextBookStatus', () => {
  it('A4: nextBookStatus("available", "borrow") → "on_loan"', () => {
    expect(nextBookStatus('available', 'borrow')).toBe('on_loan')
  })

  it('A5: nextBookStatus("on_loan", "return") → "available"', () => {
    expect(nextBookStatus('on_loan', 'return')).toBe('available')
  })

  it('A6: 借→還→借 鏈式呼叫', () => {
    const results = []
    let s = 'available'
    s = nextBookStatus(s, 'borrow')
    results.push(s)
    s = nextBookStatus(s, 'return')
    results.push(s)
    s = nextBookStatus(s, 'borrow')
    results.push(s)
    expect(results).toEqual(['on_loan', 'available', 'on_loan'])
  })

  it('A7: nextBookStatus("on_loan", "borrow") 丟 IllegalTransitionError', () => {
    expect(() => nextBookStatus('on_loan', 'borrow')).toThrow(IllegalTransitionError)
  })

  it('A8: nextBookStatus("available", "return") 丟 IllegalTransitionError', () => {
    expect(() => nextBookStatus('available', 'return')).toThrow(IllegalTransitionError)
  })

  it('A9: 錯誤物件內容 (接住 A7)', () => {
    let caught
    try { nextBookStatus('on_loan', 'borrow') }
    catch (e) { caught = e }

    expect(caught).toBeInstanceOf(Error)
    expect(caught.name).toBe('IllegalTransitionError')
    expect(caught.status).toBe('on_loan')
    expect(caught.event).toBe('borrow')
    expect(caught.message).toContain('on_loan')
    expect(caught.message).toContain('borrow')
  })

  it('A10: 丟出的錯誤不是 TypeError', () => {
    let caught
    try { nextBookStatus('on_loan', 'borrow') }
    catch (e) { caught = e }

    expect(caught).not.toBeInstanceOf(TypeError)
  })

  it.each([
    'reserved', 'AVAILABLE', '', undefined, null, 0, 'toString', '__proto__',
  ])('A11: 未知 status="%s", event="borrow" → TypeError', (status) => {
    expect(() => nextBookStatus(status, 'borrow')).toThrow(TypeError)
  })

  it.each([
    'reserve', 'BORROW', '', undefined, null, 1, 'toString', 'constructor',
  ])('A12: status="available", event="%s" → TypeError', (event) => {
    expect(() => nextBookStatus('available', event)).toThrow(TypeError)
  })
})

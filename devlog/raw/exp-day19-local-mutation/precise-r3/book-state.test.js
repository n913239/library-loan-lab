// tests/local/book-state.test.js
import { describe, it, expect } from 'vitest'
import { BOOK_STATES, BOOK_EVENTS, nextBookStatus, IllegalTransitionError } from '../../src/domain/book-state.js'

describe('book-state', () => {
  /* A1: 狀態白名單 */
  it('A1: BOOK_STATES 排序後等於 ["available", "on_loan"]', () => {
    expect([...BOOK_STATES].sort()).toEqual(['available', 'on_loan'])
  })

  /* A2: 事件白名單 */
  it('A2: BOOK_EVENTS 排序後等於 ["borrow", "return"]', () => {
    expect([...BOOK_EVENTS].sort()).toEqual(['borrow', 'return'])
  })

  /* A3: 白名單唯讀 */
  it('A3: BOOK_STATES 是 frozen', () => {
    expect(Object.isFrozen(BOOK_STATES)).toBe(true)
  })

  it('A3: BOOK_EVENTS 是 frozen', () => {
    expect(Object.isFrozen(BOOK_EVENTS)).toBe(true)
  })

  /* A4: 借出 */
  it('A4: nextBookStatus("available", "borrow") → "on_loan"', () => {
    expect(nextBookStatus('available', 'borrow')).toBe('on_loan')
  })

  /* A5: 歸還 */
  it('A5: nextBookStatus("on_loan", "return") → "available"', () => {
    expect(nextBookStatus('on_loan', 'return')).toBe('available')
  })

  /* A6: 借→還→借 */
  it('A6: 依序借、還、借,得到 ["on_loan", "available", "on_loan"]', () => {
    const s1 = nextBookStatus('available', 'borrow')       // "on_loan"
    const s2 = nextBookStatus(s1, 'return')                // "available"
    const s3 = nextBookStatus(s2, 'borrow')                // "on_loan"
    expect([s1, s2, s3]).toEqual(['on_loan', 'available', 'on_loan'])
  })

  /* A7: 借出中不能再借 */
  it('A7: nextBookStatus("on_loan", "borrow") 丟 IllegalTransitionError', () => {
    expect(() => nextBookStatus('on_loan', 'borrow'))
      .toThrow(IllegalTransitionError)
  })

  /* A8: 在架上不能還 */
  it('A8: nextBookStatus("available", "return") 丟 IllegalTransitionError', () => {
    expect(() => nextBookStatus('available', 'return'))
      .toThrow(IllegalTransitionError)
  })

  /* A9: 錯誤物件內容 */
  it('A9: 接住 A7 的錯誤,e instanceof Error, e.name === "IllegalTransitionError", e.status === "on_loan", e.event === "borrow", 訊息含 "on_loan" 和 "borrow"', () => {
    let e
    try { nextBookStatus('on_loan', 'borrow') } catch (ex) { e = ex }
    expect(e instanceof Error).toBe(true)
    expect(e.name).toBe('IllegalTransitionError')
    expect(e.status).toBe('on_loan')
    expect(e.event).toBe('borrow')
    expect(e.message).toContain('on_loan')
    expect(e.message).toContain('borrow')
  })

  /* A10: 非法轉移不是 TypeError */
  it('A10: nextBookStatus("on_loan", "borrow") 丟的不是 TypeError', () => {
    let e
    try { nextBookStatus('on_loan', 'borrow') } catch (ex) { e = ex }
    expect(e instanceof TypeError).toBe(false)
  })

  /* A11: 未知狀態 */
  it('A11: status 為 "reserved" 時丟 TypeError', () => {
    expect(() => nextBookStatus('reserved', 'borrow')).toThrow(TypeError)
  })

  it('A11: status 為 "AVAILABLE" 時丟 TypeError', () => {
    expect(() => nextBookStatus('AVAILABLE', 'borrow')).toThrow(TypeError)
  })

  it('A11: status 為 "" 時丟 TypeError', () => {
    expect(() => nextBookStatus('', 'borrow')).toThrow(TypeError)
  })

  it('A11: status 為 undefined 時丟 TypeError', () => {
    expect(() => nextBookStatus(undefined, 'borrow')).toThrow(TypeError)
  })

  it('A11: status 為 null 時丟 TypeError', () => {
    expect(() => nextBookStatus(null, 'borrow')).toThrow(TypeError)
  })

  it('A11: status 為 0 時丟 TypeError', () => {
    expect(() => nextBookStatus(0, 'borrow')).toThrow(TypeError)
  })

  it('A11: status 為 "toString" 時丟 TypeError', () => {
    expect(() => nextBookStatus('toString', 'borrow')).toThrow(TypeError)
  })

  it('A11: status 為 "__proto__" 時丟 TypeError', () => {
    expect(() => nextBookStatus('__proto__', 'borrow')).toThrow(TypeError)
  })

  /* A12: 未知事件 */
  it('A12: event 為 "reserve" 時丟 TypeError', () => {
    expect(() => nextBookStatus('available', 'reserve')).toThrow(TypeError)
  })

  it('A12: event 為 "BORROW" 時丟 TypeError', () => {
    expect(() => nextBookStatus('available', 'BORROW')).toThrow(TypeError)
  })

  it('A12: event 為 "" 時丟 TypeError', () => {
    expect(() => nextBookStatus('available', '')).toThrow(TypeError)
  })

  it('A12: event 為 undefined 時丟 TypeError', () => {
    expect(() => nextBookStatus('available', undefined)).toThrow(TypeError)
  })

  it('A12: event 為 null 時丟 TypeError', () => {
    expect(() => nextBookStatus('available', null)).toThrow(TypeError)
  })

  it('A12: event 為 1 時丟 TypeError', () => {
    expect(() => nextBookStatus('available', 1)).toThrow(TypeError)
  })

  it('A12: event 為 "toString" 時丟 TypeError', () => {
    expect(() => nextBookStatus('available', 'toString')).toThrow(TypeError)
  })

  it('A12: event 為 "constructor" 時丟 TypeError', () => {
    expect(() => nextBookStatus('available', 'constructor')).toThrow(TypeError)
  })
})

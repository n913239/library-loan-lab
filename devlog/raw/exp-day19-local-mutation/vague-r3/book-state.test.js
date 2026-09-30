// tests/local/book-state.test.js
import { describe, it, expect } from 'vitest'
import { nextBookStatus, BOOK_STATES, BOOK_EVENTS, IllegalTransitionError } from '../../src/domain/book-state.js'

describe('BOOK_STATES', () => {
  it('只有 available 和 on_loan', () => {
    expect(BOOK_STATES).toEqual(['available', 'on_loan'])
  })

  it('Object.freeze, 不可篡改', () => {
    expect(() => BOOK_STATES.push('reserved')).toThrow()
  })
})

describe('BOOK_EVENTS', () => {
  it('只有 borrow 和 return', () => {
    expect(BOOK_EVENTS).toEqual(['borrow', 'return'])
  })

  it('Object.freeze, 不可篡改', () => {
    expect(() => BOOK_EVENTS.push('reserve')).toThrow()
  })
})

describe('nextBookStatus — 合法轉移', () => {
  it('available + borrow → on_loan', () => {
    expect(nextBookStatus('available', 'borrow')).toBe('on_loan')
  })

  it('on_loan + return → available', () => {
    expect(nextBookStatus('on_loan', 'return')).toBe('available')
  })

  it('多次連續轉移,回到初始狀態', () => {
    let s = 'available'
    expect(nextBookStatus(s, 'borrow')).toBe('on_loan')
    s = 'on_loan'
    expect(nextBookStatus(s, 'return')).toBe('available')
  })
})

describe('nextBookStatus — 非法轉移', () => {
  it('available + return → IllegalTransitionError', () => {
    expect(() => nextBookStatus('available', 'return'))
      .toThrow(IllegalTransitionError)
  })

  it('on_loan + borrow → IllegalTransitionError', () => {
    expect(() => nextBookStatus('on_loan', 'borrow'))
      .toThrow(IllegalTransitionError)
  })

  it('錯誤訊息包含狀態和事件', () => {
    let e; try { nextBookStatus('available', 'return') } catch (x) { e = x }
    expect(e).toBeInstanceOf(IllegalTransitionError)
    expect(e.message).toContain('available')
    expect(e.message).toContain('return')
  })

  it('IllegalTransitionError 掛載 status 和 event', () => {
    let caught = null
    try { nextBookStatus('on_loan', 'borrow') }
    catch (e) { caught = e }

    expect(caught).toBeInstanceOf(IllegalTransitionError)
    expect(caught.status).toBe('on_loan')
    expect(caught.event).toBe('borrow')
  })
})

describe('nextBookStatus — 輸入驗證', () => {
  it('未知狀態 → TypeError', () => {
    expect(() => nextBookStatus('reserved', 'borrow'))
      .toThrow(TypeError)
  })

  it('未知事件 → TypeError', () => {
    expect(() => nextBookStatus('available', 'reserve'))
      .toThrow(TypeError)
  })

  it('null 狀態 → TypeError', () => {
    expect(() => nextBookStatus(null, 'borrow'))
      .toThrow(TypeError)
  })

  it('undefined 事件 → TypeError', () => {
    expect(() => nextBookStatus('available'))
      .toThrow(TypeError)
  })

  it('狀態是原型鏈上的 toString → TypeError (Prototype Pollution 防護)', () => {
    expect(() => nextBookStatus('toString', 'borrow'))
      .toThrow(TypeError)
  })

  it('事件是 __proto__ → TypeError (Prototype Pollution 防護)', () => {
    expect(() => nextBookStatus('available', '__proto__'))
      .toThrow(TypeError)
  })
})

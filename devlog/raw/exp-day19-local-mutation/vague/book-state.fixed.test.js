// tests/local/book-state.test.js

import { describe, it, expect } from 'vitest'
import { nextBookStatus, IllegalTransitionError, BOOK_STATES, BOOK_EVENTS } from '../../src/domain/book-state.js'

describe('BOOK_STATES', () => {
  it("包含 available + on_loan,沒有其他值", () => expect(BOOK_STATES).toEqual(['available', 'on_loan']))
  it("是 Frozen,不可改",        () => expect(Object.isFrozen(BOOK_STATES)).toBe(true))
})

describe('BOOK_EVENTS', () => {
  it("包含 borrow + return,沒有其他值", () => expect(BOOK_EVENTS).toEqual(['borrow', 'return']))
  it("是 Frozen,不可改",              () => expect(Object.isFrozen(BOOK_EVENTS)).toBe(true))
})

describe('nextBookStatus', () => {
  it("available + borrow → on_loan",     () => expect(nextBookStatus('available', 'borrow')).toBe('on_loan'))
  it("on_loan + return → available",     () => expect(nextBookStatus('on_loan', 'return')).toBe('available'))
  it("非法 available + return 丟錯",     () => expect(() => nextBookStatus('available', 'return')).toThrow(IllegalTransitionError))
  it("非法 on_loan + borrow 丟錯",       () => expect(() => nextBookStatus('on_loan', 'borrow')).toThrow(IllegalTransitionError))
  it("未知 status → TypeError",          () => expect(() => nextBookStatus('lost', 'borrow')).toThrow(TypeError))
  it("非白名單 event → TypeError",       () => expect(() => nextBookStatus('available', 'fine')).toThrow(TypeError))
})

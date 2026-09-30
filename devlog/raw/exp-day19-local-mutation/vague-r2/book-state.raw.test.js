// tests/local/book-state.test.js
// 硬規則 2:書的狀態只能照白名單轉移。available → on_loan → available,就這一條。

import { describe, it, expect } from 'vitest'
import { nextBookStatus, BOOK_STATES, BOOK_EVENTS, IllegalTransitionError } from '../../src/domain/book-state.js'

describe('BOOK_STATES', () => {
  it('只有 available 和 on_loan', () => {
    expect(BOOK_STATES).toEqual(['available', 'on_loan'])
  })

  it('不能修改(被 freeze)', () => {
    expect(() => BOOK_STATES.push('reserved')).toThrow(TypeError)
  })
})

describe('BOOK_EVENTS', () => {
  it('只有 borrow 和 return', () => {
    expect(BOOK_EVENTS).toEqual(['borrow', 'return'])
  })

  it('不能修改(被 freeze)', () => {
    expect(() => BOOK_EVENTS.push('reserve')).toThrow(TypeError)
  })
})

describe('nextBookStatus', () => {
  const validCases = [
    ['available', 'borrow', 'on_loan'],
    ['on_loan', 'return', 'available'],
  ]

  for (const [status, event, expected] of validCases) {
    it(`${status} + ${event} → ${expected}`, () => {
      expect(nextBookStatus(status, event)).toBe(expected)
    })
  }

  // 非法組合:白名單沒列的
  const illegalCases = [
    ['available', 'return'],   // 書不在手上,不能歸還
    ['on_loan', 'borrow'],      // 書已借出,不能再借
  ]

  for (const [status, event] of illegalCases) {
    it(`${status} + ${event} → 丟 IllegalTransitionError`, () => {
      const err = expect(() => nextBookStatus(status, event)).toThrow(IllegalTransitionError)
      // 確認錯誤物件有 status 和 event 欄位
      err.toHaveProperty('status', status)
      err.toHaveProperty('event', event)
    })
  }

  // 反例:未知的狀態值 → TypeError
  it('未知狀態 → TypeError', () => {
    expect(() => nextBookStatus('reserved', 'borrow')).toThrow(TypeError)
  })

  // 反例:未知的事件 → TypeError
  it('未知事件 → TypeError', () => {
    expect(() => nextBookStatus('available', 'reserve')).toThrow(TypeError)
  })

  // 反例:狀態有,事件沒列 → IllegalTransitionError (不是 TypeError)
  it('狀態合法但白名單無此路徑 → IllegalTransitionError', () => {
    expect(() => nextBookStatus('on_loan', 'borrow')).toThrow(IllegalTransitionError)
  })

  it('錯誤訊息包含狀態與事件名稱', () => {
    const err = expect(() => nextBookStatus('on_loan', 'borrow')).toThrow(IllegalTransitionError)
    expect(err).toHaveProperty('message').toMatch(/on_loan.*borrow/)
  })
})

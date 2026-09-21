// tests/book-state.test.js
// 先寫一個會紅的測試。
// 硬規則 2:書的狀態只能照白名單轉移 available → on_loan → available,就這一條。
// 轉移表寫在 src/domain/book-state.js,不准在別處寫 status = '...'。
// 規格「狀態機」:書 available → on_loan → available。
import { describe, it, expect } from 'vitest'
import {
  BOOK_STATES,
  BOOK_EVENTS,
  nextBookStatus,
  IllegalTransitionError,
} from '../src/domain/book-state.js'

describe('書的狀態機', () => {
  describe('白名單', () => {
    it('只有兩個狀態:available、on_loan', () => {
      expect([...BOOK_STATES].sort()).toEqual(['available', 'on_loan'])
    })

    it('只有兩個事件:borrow、return', () => {
      expect([...BOOK_EVENTS].sort()).toEqual(['borrow', 'return'])
    })

    it('白名單是唯讀的,別處改不動', () => {
      expect(Object.isFrozen(BOOK_STATES)).toBe(true)
      expect(Object.isFrozen(BOOK_EVENTS)).toBe(true)
    })
  })

  describe('合法轉移', () => {
    it('available --borrow--> on_loan', () => {
      expect(nextBookStatus('available', 'borrow')).toBe('on_loan')
    })

    it('on_loan --return--> available', () => {
      expect(nextBookStatus('on_loan', 'return')).toBe('available')
    })

    it('還完立刻可借:借 → 還 → 借 一路走得通', () => {
      const s1 = nextBookStatus('available', 'borrow')
      const s2 = nextBookStatus(s1, 'return')
      const s3 = nextBookStatus(s2, 'borrow')
      expect([s1, s2, s3]).toEqual(['on_loan', 'available', 'on_loan'])
    })
  })

  describe('非法轉移丟 IllegalTransitionError', () => {
    it('書在 on_loan 時不能借', () => {
      expect(() => nextBookStatus('on_loan', 'borrow')).toThrow(IllegalTransitionError)
    })

    it('書在 available 時不能還', () => {
      expect(() => nextBookStatus('available', 'return')).toThrow(IllegalTransitionError)
    })

    it('IllegalTransitionError 是 Error 的子類,訊息帶狀態與事件', () => {
      expect(() => nextBookStatus('on_loan', 'borrow')).toThrow(Error)
      expect(() => nextBookStatus('on_loan', 'borrow')).toThrow(/on_loan/)
      expect(() => nextBookStatus('on_loan', 'borrow')).toThrow(/borrow/)
    })

    it('非法轉移不是 TypeError(輸入合法,只是白名單沒這條)', () => {
      expect(() => nextBookStatus('on_loan', 'borrow')).not.toThrow(TypeError)
    })
  })

  describe('未知狀態或事件丟 TypeError', () => {
    it('未知狀態', () => {
      expect(() => nextBookStatus('reserved', 'borrow')).toThrow(TypeError)   // 非目標 1:沒有預約
      expect(() => nextBookStatus('lost', 'return')).toThrow(TypeError)
      expect(() => nextBookStatus('AVAILABLE', 'borrow')).toThrow(TypeError)  // 大小寫不通融
      expect(() => nextBookStatus('', 'borrow')).toThrow(TypeError)
      expect(() => nextBookStatus(undefined, 'borrow')).toThrow(TypeError)
      expect(() => nextBookStatus(null, 'borrow')).toThrow(TypeError)
      expect(() => nextBookStatus(0, 'borrow')).toThrow(TypeError)
    })

    it('未知事件', () => {
      expect(() => nextBookStatus('available', 'reserve')).toThrow(TypeError)
      expect(() => nextBookStatus('available', 'checkout')).toThrow(TypeError)
      expect(() => nextBookStatus('available', 'BORROW')).toThrow(TypeError)
      expect(() => nextBookStatus('available', '')).toThrow(TypeError)
      expect(() => nextBookStatus('available', undefined)).toThrow(TypeError)
      expect(() => nextBookStatus('available', null)).toThrow(TypeError)
      expect(() => nextBookStatus('available', 1)).toThrow(TypeError)
    })

    it('原型鏈上的名字不算白名單(不能靠物件屬性穿透)', () => {
      expect(() => nextBookStatus('toString', 'borrow')).toThrow(TypeError)
      expect(() => nextBookStatus('__proto__', 'borrow')).toThrow(TypeError)
      expect(() => nextBookStatus('available', 'toString')).toThrow(TypeError)
      expect(() => nextBookStatus('available', 'constructor')).toThrow(TypeError)
    })
  })
})

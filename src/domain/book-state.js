// src/domain/book-state.js
// 硬規則 2:書的狀態只能照白名單轉移。available → on_loan → available,就這一條。
// 轉移表只能寫在這個檔;別處要改狀態一律呼叫 nextBookStatus,不准自己寫 status = '...'。
// 規格「狀態機」:書 available → on_loan → available。逾期不是狀態(規格層決定 3),預約沒有(非目標 1)。
// 純邏輯,無 I/O,不讀時鐘。

export const BOOK_STATES = Object.freeze(['available', 'on_loan'])
export const BOOK_EVENTS = Object.freeze(['borrow', 'return'])

// 轉移表:TRANSITIONS[目前狀態][事件] = 下一個狀態。沒列的組合就是非法。
// 用 Map 而不是物件,避免 'toString' / '__proto__' 之類的名字從原型鏈穿透。
const TRANSITIONS = new Map([
  ['available', new Map([['borrow', 'on_loan']])],
  ['on_loan', new Map([['return', 'available']])],
])

// 輸入合法、但白名單沒這條:是業務上的拒絕(routes 該回 4xx),不是程式寫錯,所以不用 TypeError。
export class IllegalTransitionError extends Error {
  constructor(status, event) {
    super(`書在 ${status} 時不能 ${event}`)
    this.name = 'IllegalTransitionError'
    this.status = status
    this.event = event
  }
}

export function nextBookStatus(status, event) {
  if (!BOOK_STATES.includes(status)) throw new TypeError(`未知的書狀態:${status}`)
  if (!BOOK_EVENTS.includes(event)) throw new TypeError(`未知的事件:${event}`)

  const next = TRANSITIONS.get(status)?.get(event)
  if (next === undefined) throw new IllegalTransitionError(status, event)
  return next
}

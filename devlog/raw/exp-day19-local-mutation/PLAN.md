# 測試清單(由我寫定;地端只負責把它變成測試碼)

框架: vitest(`import { describe, it, expect, vi, afterEach } from 'vitest'`)
測試檔: `tests/local/book-state.test.js`、`tests/local/due-at.test.js`
import 路徑: `../../src/domain/book-state.js`、`../../src/domain/due-at.js`
規則: 嚴格照清單,不增不減;預期值照這份清單寫,不要讀實作推測;每個 `it` 只驗一件事。

## A. `src/domain/book-state.js`

匯出: `BOOK_STATES`、`BOOK_EVENTS`、`nextBookStatus(status, event)`、`IllegalTransitionError`

| # | 案例 | 輸入 | 預期 |
|---|---|---|---|
| A1 | 狀態白名單 | `[...BOOK_STATES].sort()` | `['available', 'on_loan']` |
| A2 | 事件白名單 | `[...BOOK_EVENTS].sort()` | `['borrow', 'return']` |
| A3 | 白名單唯讀 | `Object.isFrozen(BOOK_STATES)`、`Object.isFrozen(BOOK_EVENTS)` | 都是 `true` |
| A4 | 借出 | `nextBookStatus('available', 'borrow')` | `'on_loan'` |
| A5 | 歸還 | `nextBookStatus('on_loan', 'return')` | `'available'` |
| A6 | 借→還→借 | 依序呼叫三次,每次用上一次的回傳值 | `['on_loan', 'available', 'on_loan']` |
| A7 | 借出中不能再借 | `nextBookStatus('on_loan', 'borrow')` | 丟 `IllegalTransitionError` |
| A8 | 在架上不能還 | `nextBookStatus('available', 'return')` | 丟 `IllegalTransitionError` |
| A9 | 錯誤物件內容 | 接住 A7 丟出的錯誤 `e` | `e instanceof Error` 為 true;`e.name === 'IllegalTransitionError'`;`e.status === 'on_loan'`;`e.event === 'borrow'`;`e.message` 含 `on_loan` 也含 `borrow` |
| A10 | 非法轉移不是 TypeError | `nextBookStatus('on_loan', 'borrow')` | 丟出的錯誤**不是** `TypeError` |
| A11 | 未知狀態 | status 各用 `'reserved'`、`'AVAILABLE'`、`''`、`undefined`、`null`、`0`、`'toString'`、`'__proto__'`,event 用 `'borrow'` | 每一個都丟 `TypeError` |
| A12 | 未知事件 | status 用 `'available'`,event 各用 `'reserve'`、`'BORROW'`、`''`、`undefined`、`null`、`1`、`'toString'`、`'constructor'` | 每一個都丟 `TypeError` |

## B. `src/domain/due-at.js`

匯出: `dueAt(now, loanDays)`;`now` 是 UTC ISO-8601 字串,回傳 `toISOString()` 格式(帶毫秒、結尾 Z)。

| # | 案例 | 輸入 | 預期 |
|---|---|---|---|
| B1 | 借 14 天 | `dueAt('2026-09-04T02:00:00Z', 14)` | `'2026-09-18T02:00:00.000Z'` |
| B2 | 最小借期 1 天 | `dueAt('2026-09-04T02:00:00Z', 1)` | `'2026-09-05T02:00:00.000Z'` |
| B3 | 跨年 | `dueAt('2026-12-25T00:00:00Z', 14)` | `'2027-01-08T00:00:00.000Z'` |
| B4 | 毫秒保留 | `dueAt('2026-09-04T02:00:00.123Z', 14)` | `'2026-09-18T02:00:00.123Z'` |
| B5 | 不讀時鐘 | `vi.useFakeTimers()`、`vi.setSystemTime(new Date('2000-01-01T00:00:00Z'))` 後呼叫 B1 的輸入;`afterEach` 裡 `vi.useRealTimers()` | 仍是 `'2026-09-18T02:00:00.000Z'` |
| B6 | now 非法 | now 各用 `'昨天'`、`''`、`undefined`、`null`、`1757988000000`(數字)、`new Date('2026-09-04T02:00:00Z')`,loanDays 用 `14` | 每一個都丟 `TypeError` |
| B7 | loanDays 非法 | now 用 `'2026-09-04T02:00:00Z'`,loanDays 各用 `0`、`-1`、`1.5`、`NaN`、`Infinity`、`'14'`、`undefined`、`null` | 每一個都丟 `TypeError` |

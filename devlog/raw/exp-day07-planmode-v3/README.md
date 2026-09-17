# Day 7 實驗:Plan Mode 把規格補完整(v3 最簡版規格,2026-09-17)

乾淨 clone 放在原 repo 之外,`git checkout 523b0fa`(規格 commit,「AI 尚未介入」),`rm -rf .git devlog docs/spec.md docs/non-goals.md`;`CLAUDE.md` 照常留著。Claude Code 2.1.271、Opus 5。

| 輪 | 我送 | 它回 | turns / $ / 秒 |
|---|---|---|---|
| 1 | `prompt-round1.txt`:一句需求「實作借書與還書:讀者可以借一本可借的書,借期 14 天;還了之後別人才能借;逾期只記天數。」`--permission-mode plan` | 169 行計畫(`PLAN-round1.md`)。**沒有問題,改成七個「可推翻的假設」A1–A7**,它自己說「這個 session 沒有 AskUserQuestion / ExitPlanMode 可用」 | 6 / 0.749 / 210 |
| 2 | `answers-round2.md`:七個假設逐條回(三個跟規格不同:A1 header→body、A2 ceil→floor、A3 loanId→userId+bookId)+ 三件計畫沒有規格有的(`loan_policies` 表、兩條 GET、一人一書/還完立刻可借) | 196 行(`PLAN-round2.md`),補三個小決定,**再問一題**:list 要不要帶 overdueDays | 2 / 0.334 / 108 |
| 3 | `answers-round3.md`:帶 | 197 行(`PLAN-round3.md`),「還需要你決定的:沒有了」 | 6 / 0.233 / 26 |

合計 $1.32、344 秒。`round{1,2,3}-result.json` 是 cost / usage,`round{1,2,3}-result.md` 是它的回覆。

## 七個假設對規格

| 假設 | 規格 | 判定 |
|---|---|---|
| A1 `userId` 從 header | body `{userId, bookId}` | **不同** |
| A2 逾期 `ceil` | 決定 3:`floor` | **不同** |
| A3 還書 `POST /loans/:loanId/return` | `POST /api/return {userId, bookId}` | **不同** |
| A4 active/returned 由 `returned_at IS NULL` 推導 | 狀態機寫 active → returned,沒說存不存欄位 | 相容 |
| A5 加 `src/db/` | CLAUDE.md 目錄表沒列 | 相容 |
| A6 不加建書 endpoint | API 表沒有 | 相容 |
| A7 presentation 這次不放東西 | — | 相容 |

計畫**沒有、規格有**:`loan_policies` 表(它寫成 code 常數)、`GET /api/books/:id`、`GET /api/users/:id/borrows`、一人一書一筆、還完立刻可借的測試。
它問的唯一一題(list 要不要帶 overdueDays)規格沒寫 → 真的洞。
非目標一條沒踩(計畫自己寫「不做:罰款、預約、建書/建人 endpoint、UI、登入」,而它沒讀到非目標)。

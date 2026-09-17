# Day 7 Plan Mode 第二、三輪(2026-09-17,接回 9/16 的 session)

9/16 第一輪(`claude -p … --permission-mode plan`,乾淨 clone(見 `../exp-day08-planmode/README.md`))交出 162 行計畫 + 5 題待確認,原文在 `../exp-day08-planmode/PLAN.md`。
9/17 用 `--resume <第一輪的 session id>` 接回同一個 session,兩輪都在同一個乾淨 clone 裡、plan mode、Claude Code 2.1.271、Opus 5。

| 輪 | 我送的 | 它回的 | turns / $ / 秒 |
|---|---|---|---|
| 1(9/16) | 一句需求 | 162 行計畫 + **5 題** | 7 / 0.906 / 271 |
| 2 | `answers.md`:5 題的答案 + 補一條「一人一書一借一排」 | 計畫改成 206 行(schema 4 → 6 張、endpoint 3 → 5 條、一人一書兩個 partial unique index)+ **4 題新的** | 2 / 0.854 / 171 |
| 3 | `answers-round3.md`:4 題的答案 | 205 行,「還需要你決定的:**沒有了**」 | 10 / 0.467 / 58 |

三輪合計 $2.23、9 題。每輪結束把計畫檔複製為 `PLAN-round{2,3}.md`;`round{2,3}-result.json` 是 cost / usage(session id 已遮),`round{2,3}-result.md` 是它的回覆。

## 9 題各自對到規格哪裡(對賬用)

| 輪 | 題 | 規格有沒有答案 |
|---|---|---|
| 1 | 1 Schema 4 張、不建 members | **有**:`readers.role`、`loan_policies` 一列(規格層決定 1、2) |
| 1 | 2 Endpoint 3 條、不做 GET | **有**:借書指定書不指定副本、`DELETE /reservations/:id`、`POST /holds/:id/checkout`(API 表) |
| 1 | 3 逾時直接 available 還是順延 | **規格自相矛盾**(一句話 vs 狀態機;9/16 已修 `379a6d5`) |
| 1 | 4 測試跑在哪 | 沒有(實作選擇;repo 已在用 vitest) |
| 1 | 5 加 `src/db/`、`src/index.js` | 沒有(CLAUDE.md 目錄表沒列 db) |
| 2 | 1 `hold_hours` 放哪 | **半有**:決定 3 說 48 小時固定、`expires_at` 建立時算好,沒說存哪 |
| 2 | 2 已借此書能不能再排同一本 | **沒有**:決定 4 只說「一本借閱、一個排隊」,沒說能不能同時 |
| 2 | 3 `DELETE` 遇到 `held` | **有**:決定 5「保留過期或被取消後,順延給下一位」 |
| 2 | 4 `loans.book_id` 反正規化 | 沒有(實作選擇) |

→ 9 題裡規格有答案 3、半有 1、自相矛盾 1、規格沒寫 4(其中 2 是實作選擇、2 是真的洞:同時借又排、`hold_hours` 存哪)。

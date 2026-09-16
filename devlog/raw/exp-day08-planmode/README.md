# Day 8 實驗:Plan Mode 的計畫 vs 我先寫好的規格

**2026-09-16 實跑。** 原文 `PLAN.md`(162 行,一個字沒改)、`STDOUT.md`(session 的收尾訊息)、`result.json`(cost / usage;session id 已遮)。

## 無菌室怎麼準備的

```
git clone --no-hardlinks → checkout 896561e(規格 commit,2026-09-16 12:38,「AI 尚未介入」)
rm docs/spec.md docs/non-goals.md
rm -rf .git                          ← 關鍵(Day 4 第一級的漏洞)
claude -p "實作借閱:讀者可以借一本可借的副本,借期 14 天;書全借出時可以預約排隊,歸還後隊首保留 48 小時,逾時自動釋放" --permission-mode plan
```

Claude Code 2.1.271、Opus 5。**271 秒、7 turns、$0.906**,`permission_denials` 0。
**`CLAUDE.md` 照常留著** —— 量的是「我已經把規則寫給它了,它會不會照做」。

> 它自己在收尾訊息寫:「我看到旁邊有 `library-loan-lab` 目錄,依實驗協定我沒有去讀它。」
> 乾淨 clone 跟原 repo 是鄰居目錄 —— 這是第一級隔離的另一個洞(Day 4 沒量到的)。
> 對賬時另外驗過:規格裡有、prompt 沒提、CLAUDE.md 沒寫的東西(`DELETE /copies`、`GET /me/loans`、
> `loan_policies` 表、`readers.role`)計畫裡一個都沒出現,判定沒讀。

## 對賬:endpoint

規格「借閱與預約」五條:

| 規格 | 計畫 | |
|---|---|---|
| `POST /books/:id/loans` | 有,但形狀是 `POST /loans {copy_id}`(指定副本,不是指定書) | 🟡 命中,形狀不同 |
| `POST /loans/:id/return` | 有,含隊首保留與 `overdue_days` | ✅ |
| `POST /books/:id/reservations` | 有,有可借副本時 409 | ✅ |
| `POST /holds/:id/checkout` | 沒有獨立 endpoint;併進 `POST /loans`(副本 `held` 給自己 → 201) | 🟡 命中,形狀不同 |
| `DELETE /reservations/:id`(取消排隊) | **沒有** | ❌ |

**4 命中(2 形狀不同)/ 1 漏掉。** 漏的跟 event-signup 那次一模一樣:主動放棄那條。prompt 沒提「取消」,它就沒想到。

## 對賬:五條硬規則

| 硬規則 | 計畫有沒有處理 |
|---|---|
| 1 時間當參數 | ✅ `now` 由 routes / `scheduled()` 取後往下傳;domain 只用 `Date.parse` + `toISOString`,靜態檢查抓 `Date.now(` |
| 2 狀態白名單 | ✅ `src/domain/copy-state.js` 唯一轉移表;SQL 的 status 全用綁定參數,靜態檢查抓 `status = '` 字面值 |
| 3 併發寫進 `WHERE` + 檢查 `changes` | ✅ `db.batch()` 每句帶同一前置條件 P、改變 P 的那句放最後、只看 `meta.changes`;partial unique index 當第二道防線 |
| 4 UTC ISO 字串 | ✅ 所有時間欄位 ISO;`toLocale` / `getTimezoneOffset` 只准在 presentation(靜態檢查) |
| 5 逾期用 `due_at` 快照 | ✅ `overdueDays(loan.due_at, now)`,明寫「不 JOIN 政策」 |

**5/5。**

## 對賬:必須被測試證明的 9 條規則

| 規則 | 計畫 |
|---|---|
| 同一副本不雙借 | ✅ 閘門併發測試,剛好一個 201 一個 409,重跑 5 次 |
| 沒可借副本不能借 | ✅ |
| 保留只給隊首 | ✅ `ORDER BY created_at, id LIMIT 1`;`held` 給別人 → 409 |
| 保留逾時後副本能被別人借 | ✅ expire test + 冪等 |
| 逾期天數用快照 | ✅ 歸還時傳晚 3 天的 `now` |
| 只有館員能新增/下架副本 | ➖ 不在這次範圍(prompt 只講借閱;它連 members 表都沒建,身分 = JWT sub) |
| 只能下架 `available` 的副本 | ➖ 同上 |
| `returned` 是終態 | ✅ 重複歸還 409 |
| 一人同一本書只能一本、排一次 | 🟡 排隊有(unique index);**借閱沒有** —— 同一人可以借走同一本書的兩個副本 |

## 判定

| 分類 | 數量 | 備註 |
|---|---:|---|
| ✅ 命中 | **13** | endpoint 4(含 2 形狀不同)、硬規則 5、測試規則 4(排除 2 條範圍外、1 條半) |
| ➕ 多做(踩非目標) | **0** | 加了 `src/db/`、`src/index.js`(cron)、`migrations/`、JWT helper —— 逐條對 15 條非目標,沒踩;而且它**先問**了 5 個問題才動 |
| 🟡 加分(我漏的) | **5** | 見下 |
| ❌ 漏掉 | **2** | `DELETE /reservations/:id`;一人同一本書只能借一本 |

## 🟡 加分的五項

1. ⭐ **它抓到我的規格自相矛盾**:「保留逾時後,副本直接 `available` 還是順延給下一位隊首?」—— 我的 `spec.md` 一句話寫「逾時自動釋放**給下一位**」,狀態機那段卻畫 `held ──(逾時 48h)──→ available`。它沒讀到 spec,只從需求句就問了這題,而這正是 spec 裡兩處對不起來的地方。
2. 歸還走 `on_loan → available → held` **兩步**,不走白名單外的 `on_loan → held` —— 我的白名單漏了這條轉移,它用兩步繞過而不是偷偷加一條。
3. `loans` 上的 partial unique index(`WHERE returned_at IS NULL`)當規則 1 的第二道防線 —— CLAUDE.md 寫的是 `CHECK`,它給了更對的東西。
4. 靜態檢查加一條「`src/domain/` 不准 import `../db` 或 `../routes`」—— 純邏輯不碰 I/O,我只寫在目錄註解裡,它做成檢查。
5. `releaseExpiredHolds` 明講**冪等**,重跑一次結果一樣。

## 它主動不做的

- 查詢類 GET(需求沒提)—— 但 `GET /me/loans` 在規格裡是第三個 Feature,這次不算漏。
- login endpoint —— 用 `tests/helpers/jwt.js` 簽 token 代替,合理。

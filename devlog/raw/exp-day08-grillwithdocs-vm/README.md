# Day 8 VM 重跑:`/grill-with-docs`(2026-09-17 23:00–24:20 +08,作者親手在 VM 裡跑)

環境同 `../exp-day08-grillme-vm/README.md`(同一台 `d08-vm`、2.1.270、`claude-opus-5[1m]`、沒 node);工作目錄 VM 裡的工作目錄(從 `d08-vm` 另拷一份,乾淨),allowedTools 多給 Write/Edit。

| 輪 | 題 | turns / $ / s | 事件 |
|---|---|---|---|
| 1 | Q1–Q6 | 12 / 0.559 / 227 | 沒有詞彙題、沒開 CONTEXT.md(主機那次第一輪就問 borrow vs loan);Q1 直接說規格「自我矛盾」:書的狀態存欄位、借閱紀錄的狀態卻推導 → 兩個真相來源;Q6 presentation 這版是空的 |
| 2 | Q7–Q14 | 1 / 0.442 / 195 | **Q11 頂回我第一輪「同名」的答案**:結算值 vs 投影值是詞彙表該管的事;Q12 拿硬規則 1 類推 `crypto.randomUUID()`(「所有非決定性輸入都是參數」);說 Q11 確認後才開 CONTEXT.md。⚠️ 之後作者誤把第一輪答案重送一次(`round2-resend.json`,1 turn $0.188 28 s,它回「這跟上一封是同一則」),VM 上的 round2.json/result 被蓋掉、從主機副本還原;`round2.log` 是重送那次的 |
| 3 | Q15–Q18 | 4 / 0.424 / 158 | 寫出 `CONTEXT.md`(9 條分三組;「逾期天數」本身列進 Avoid);Q17 grep 會誤殺 `new Date(str)` 與 Q7 的 SQL 字面值;Q18 `last_row_id` 的 BigInt 與陳舊值坑;問要不要開兩張 ADR |
| 4 | Q19–Q21 | 3 / 0.426 / 174 | 寫出 `docs/adr/0001`、`0002`;五個文件洞列表(CLAUDE.md 一字未動);Q19 自己推翻「併發還書測不了」 |
| 5 | — | 1 / 0.233 / 88 | 第六個洞(目錄表沒有 adapter/repository 的家 → src/db/);16 步實作順序表(A 護欄 → E 收尾),「第 11 步違規 fixture 必須在第 12 步之前」;停住不動手 |

合計 **5 輪(4 問 + 1 表)、21 題(6+8+4+3)、$2.08、842 s**(誤重送另 $0.19)。對照主機 `/grill-with-docs` v3:5 輪 33 題 $2.10 672 s(`../exp-day08-grillwithdocs-v3/`)。

`produced/`:`CONTEXT.md`(9 條)、`adr/0001-test-adapter-over-node-sqlite.md`、`adr/0002-book-status-as-source-of-truth.md`、`CLAUDE.md`(diff 過,跟 `ef764ac` 一字不差 —— 主機那次它自己加了 `src/db/` 一行,VM 這次照我的指示沒動)。
ADR 閘門:主機那次開 2 拒 3;VM 這次它先問「要不要開」再開 2。詞彙題:主機第一輪就問(borrow vs loan);VM 到第二輪才因為 Q11 的爭論出現,而且爭的是 overdue_days 的兩個意思,不是英文名。

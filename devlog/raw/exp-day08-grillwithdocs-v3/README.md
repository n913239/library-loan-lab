# Day 8 補:`/grill-with-docs` 拷問 v3 最簡版規格(2026-09-17)

跟 `exp-day08-grillme-v3/` 同一份起點:乾淨 clone `git checkout ef764ac`,`rm -rf .git devlog`,四支 skill(commit `959a8e9`)複製進 `.claude/skills/`;這次跑 `/grill-with-docs`(= `grilling` + `domain-modeling`)。
`claude -p "$(cat prompt-round1.txt)" --permission-mode default --allowedTools Read,Glob,Grep,Skill,Agent,Write,Edit`(多給 Write/Edit,它要寫 CONTEXT.md / ADR),之後 `--resume` 逐輪答。Claude Code 2.1.271、Opus 5。

**環境坑**:第一、二輪 repo 放在 `~/.claude/` 底下的暫存目錄,第二輪它要寫 `CONTEXT.md` 被擋(`permission_denials` 有 Write;`-p` 回「被標記為敏感檔案,non-interactive session 無法核准」)。另外驗過:同樣指令在 `~/.claude/` 底下任何檔名都被擋、搬到外面就過 —— 是路徑不是檔名。第二輪答案前把整個目錄 `cp -R` 到 `~/.claude/` 之外,`--resume` 跨目錄接回同一 session 沒問題。

| 輪 | 它給 | turns / $ / 秒 |
|---|---|---|
| 1 | 先派 sub-agent 查環境(src 空、package.json 只有 vitest、不是 git repo、D1 沒交談式交易);**Q1–Q13**,Q13 是詞彙題(borrow vs loan);「你點頭我就寫 CONTEXT.md」 | 12 / 0.644 / 234 |
| 2 | 想寫 CONTEXT.md 被擋(路徑),內容貼在回覆最後;兩次 `node -e` 探 node:sqlite 也被擋;**Q14–Q21**;說 Q3 夠格開 ADR、等 R2 定案再寫 | 5 / 0.646 / 189 |
| 3 | 寫 `CONTEXT.md`(67 行)、`docs/adr/0001`、`0002`,CLAUDE.md 目錄表加 `src/db/` 一行;明講三件**不開** ADR(錯誤碼表、欄位命名、overdue_days 存欄位);**Q22–Q28** | 7 / 0.469 / 132 |
| 4 | **Q29–Q33**(葉節點) | 1 / 0.168 / 62 |
| 5 | 「**Frontier 已空**」;共識摘要六節、每條標題號;沒動 src/tests | 1 / 0.175 / 55 |

合計 **5 輪(4 輪問 + 1 輪摘要)、33 題、$2.10、672 秒**。對照 `/grill-me` v3:4 輪 24 題 $1.18 383 秒。

## 值得記的

- **只有 domain-modeling 會問的題**:Q13 borrow vs loan(中文「借閱」、英文 `borrow` 為主、`on_loan` / `loan_policies` 標成「契約遺留」)。CONTEXT.md 每個詞都附 _Avoid_ 清單(副本 / copy / patron / reader / loan record / deadline / 罰款天數…)。
- **ADR 閘門真的有在擋**:開了 2 份(0001 測試跑 node:sqlite 不跑 D1;0002 batch 第二句 `WHERE changes() = 1` 綁住第一句),明講不開 3 份。
- **Q14 `changes()` 這招是 grill-me 那次沒出現的**:grill-me 的設計是 batch + unique index 拋錯當偵測;這次它自己反駁那個設計(route 要解析錯誤訊息、D1 與 node:sqlite 錯誤形狀不同),改成 `INSERT … SELECT … WHERE changes() = 1`,並在 ADR 承認「只在 node:sqlite 驗過,D1 上是假設」。
- Q5(決定 4 多餘)跟 grill-me 抓到的一樣,但這次多了一步:寫進 CONTEXT.md 的「單冊版的推論規則」。
- 題數 33 vs 24:同一個模型兩次跑本來就不會一樣,不能全歸給 domain-modeling;能確定歸給它的是 Q13 + 三份檔。
- 跟 grill-me 相同的決定:Q2/Q3 抽薄 DB 介面 + node:sqlite、閘門在 adapter、狀態欄 + partial unique index、一人一書多餘、history 讀存的 overdue_days。

檔案:`prompt-round1.txt`、`answers-round{1..4}.md`、`round{1..5}-result.md`(回覆)、`round{1..5}.json`(原始輸出)、`produced/`(它寫出來的 CONTEXT.md、docs/adr/、改過的 CLAUDE.md)、`SKILLS-VERSION.txt`。

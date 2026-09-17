# Day 8 實驗:`/grill-me` 拷問 v3 最簡版規格(2026-09-17)

乾淨 clone 放在原 repo 之外,`git checkout ef764ac`(規格 + 紅測試,「AI 尚未介入」),`rm -rf .git devlog`;規格、非目標、CLAUDE.md、`tests/overdue.test.js` 都留著。
skill:mattpocock/skills commit `959a8e9`(`SKILLS-VERSION.txt`),四支複製進 `.claude/skills/`;只跑 `/grill-me`。
`claude -p "$(cat prompt-round1.txt)" --permission-mode default --allowedTools Read,Glob,Grep,Skill,Agent`,之後 `--resume` 逐輪答(`answers-round{1,2,3}.md`)。Claude Code 2.1.271、Opus 5。

| 輪 | 它給 | turns / $ / 秒 |
|---|---|---|
| 1 | 讀 7 個檔;開場一句「規格在規則層寫得很硬,但在怎麼落地層有幾個洞,而且有兩條規則彼此有張力」;**Q1–Q11**,每題附建議 | 10 / 0.482 / 158 |
| 2 | 想跑 `node:sqlite` 探針被擋(寫 /tmp);**Q12–Q21**,含一題追問我上一輪的答案(Q14) | 4 / 0.401 / 143 |
| 3 | 自己定了 barrier API;**Q22–Q24**;整棵 24 節點的設計樹 | 1 / 0.213 / 74 |
| 4 | 「**Frontier 清空**」;說明接下來只改 spec + 寫 tests/README、CLAUDE.md 一字不動、不寫 src | 1 / 0.080 / 8 |

合計 **4 輪、24 題、$1.18、383 秒**。

## 值得記的

- **兩條規則的張力**(Q2):`books.status` 存欄位 + 白名單 + CHECK,又要求「有未歸還紀錄 ⇔ on_loan」被測試證明 → 兩份真相。它建議 (c) 兩者都存、partial unique index 當第二道、不變量寫成測試。
- **Q3**:硬規則 2「不准在別處寫 `status = '...'`」跟 `UPDATE books SET status = 'on_loan'` 字面衝突,它提出「字面值只在 book-state.js、SQL 全參數化」的落地法,並說「這是硬規則 2 唯一講得通的落地法」。
- **Q5**:規格決定 4「一人同一本書只能一筆未歸還」在一書一冊之下是**多餘的**(書已 on_loan 就擋掉了),它指出「為什麼」欄寫的是測試設計理由不是業務理由。
- **Q14 追問**:我第一輪答「history 也現算 overdueDays」,它反駁「那存的 `overdue_days` 欄位就只寫不讀」,我改採它的 (a)。
- **Q12 / Q22**:併發閘門插在 adapter 的 `batch()`;naive 對照組要先紅、而且留成永久測試 `gate.test.js` 守閘門本身。
- 我跟它建議不同的:Q8(2)(後來被 Q14 追問改回)。其餘 23 題照建議。
- 沒有一題是「要不要加什麼」;非目標一條沒踩。

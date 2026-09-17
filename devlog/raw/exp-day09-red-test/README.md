# Day 9 實驗:先寫一個會紅的測試,再讓 AI 動手(v3,2026-09-17)

Claude Code 2.1.271、Opus 5。在真 repo 裡跑(不是乾淨 clone —— 這篇量的是「它會不會照規則綠」)。

## 順序(commit 就是證據)

1. `ef764ac` —— 我先寫 `tests/overdue.test.js`(6 個 case:未到期 / 剛好等於 / 晚 1 秒 floor / 晚 1 天 / 晚 3 天 23 小時 / 不同 now 不同答案)。`npx vitest run` → **紅**:`Failed to load url ../src/domain/overdue.js`。message 寫「AI 尚未介入」。
2. `claude -p "讓 tests/overdue.test.js 通過。不要改測試檔。" --permission-mode default --allowedTools Read,Write,Edit,Glob,Grep,Bash(npx vitest*),Bash(npm test*)` —— **27 秒、8 turns、$0.31**;`permission_denials` 1(它想 `ls … && cat package.json && git status`,不在 allowedTools,被拒後改用 Read/Grep)。
3. `npx vitest run` → **6 passed**。

## 三件當場檢查

| 檢查 | 結果 |
|---|---|
| 它有沒有改測試檔 | **沒有**:`git status` 只有新檔 `src/domain/overdue.js` |
| `now` 從哪來 | 參數。`overdue.js` 裡 `Date.now()` / `new Date()` **0 處**,只用 `Date.parse` 解析兩個參數 |
| 有沒有順手加東西 | 1 個 export、2 個參數;**多了兩行 `TypeError` 防禦**(非法字串就丟),它自己在收尾標了「這是我加的,不在測試裡;不想要可以拿掉」 |

`green.json` 原始輸出、`STDOUT.md` 收尾訊息、`overdue.js` 它交出的實作(原文)。

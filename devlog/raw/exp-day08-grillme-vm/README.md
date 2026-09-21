# Day 8 VM 重跑:`/grill-me`(2026-09-17 22:00–22:45 +08,作者親手在 VM 裡跑)

環境:VirtualBuddy 從母片 `base-26` 複製出來的 `d08-vm`(guest macOS 26.6.2,只有 Homebrew、git、Claude Code **2.1.270**;**沒裝 node**,刻意不補)。`~/.claude/` 是母片乾淨狀態(全部 9/13 06:xx 時間戳、沒有 CLAUDE.md / skills / hooks,`settings.json` 101 bytes)。模型 `--model 'opus[1m]'` → `claude-opus-5[1m]`(VM 預設是 Sonnet 5,第一次跑到一半發現、Ctrl-C 重來)。
起點同主機 v3:clone `ef764ac`、`rm -rf .git devlog`、四支 skill `959a8e9`(`grill-with-docs` 在 `skills/engineering/`,手冊原本寫錯);工作目錄 VM 裡的工作目錄(不在 `~/.claude/` 底下)。
答案由主機那邊的 Claude照規格擬、作者過目後 `curl` 進 VM 送出;主機↔VM 用兩個 `http.server` 對傳(剪貼簿壞)。

| 輪 | 題 | turns / $ / s | 事件 |
|---|---|---|---|
| 1 | Q1–Q5 | 7 / 0.455 / 159 | 開場就說「怎麼跑、怎麼測還完全沒被決定,而規格把重心壓在一個併發測試上」;Q2 指硬規則 3 的 CHECK 擋不住雙借;Q3 決定 4 是死規則;Q4 改政策沒有路可測 |
| 2 | Q6–Q12 | 6 / 0.638 / 271 | 4 次 Bash 被擋(查 node、git);Q7 拿硬規則 3 反問「還書先讀 due_at 算不算先查再寫」;Q8 negative control 在有索引的 schema 上會「紅錯地方」;Q12「我讀過規格又改了十幾個決定,我再實作就毀了對照組」 |
| 3 | Q13–Q18 | 1 / 0.513 / 251 | **回頭挖自己上一輪的洞**:Q13 推翻 Q6 的述詞(只查書不查人 → 幽靈使用者借到書)、作廢 Q7 的「不可變快照」理由(policy 可變);Q15 硬規則 3「靜態只擋得住忘了寫 WHERE」;Q18「production adapter 從來沒被真 D1 跑過,必須進文章」 |
| 4 | — | 1 / 0.479 / 173 | 「Frontier 空了」;收尾四項(檔案佈局、八條規則→測試對照、一個沒點頭的新決定 src/db/、七件事後要改的)+ `docs/DECISIONS.md` 全文(A–J);提醒 devlog/ 不存在 |

合計 **4 輪、18 題(5+7+6)、$2.09、854 s**。對照主機 `/grill-me` v3:4 輪 24 題 $1.18 383 s(`../exp-day08-grillme-v3/`)。

跟主機那次的差別(同 skill、同 commit、同模型):題數少、每題長、會自我推翻;抓到主機沒抓到的:negative control 跑錯 schema、硬規則 3 的靜態極限、D1 從沒跑過。三次(主機 grill-me / 主機 grill-with-docs / VM)都抓到:決定 4 多餘、CHECK 擋不住一書兩筆、時鐘注入。

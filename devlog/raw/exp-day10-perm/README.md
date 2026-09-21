# Day 10 實驗:故意做一件該被擋的事(2026-09-21,Claude Code 2.1.278)

乾淨 clone(`git checkout 09da5cb`,拿掉 origin),放上 `.claude/settings.json`,每條指令各開一個 `claude -p … --permission-mode default --output-format stream-json --verbose`,prompt 一律「執行 X,不要做別的,把輸出原樣貼給我。」。看 `tool_result` 的第一行。

- `settings-v1.json`:文章裡那份(deny push/reset/clean、ask checkout/merge/rebase、allow status/diff/log)
- `settings-v1b.json`:v1 + ask 多一條 `Bash(git stash:*)`
- `settings-v2.json`:v1 的 `Bash(git reset:*)` 換成窄的 `Bash(git reset --hard:*)`

| 檔 | 設定 | 它跑的指令 | tool_result 第一行 | cost |
|---|---|---|---|---|
| `s1` | `settings-v1.json` | `git push 2>&1` | `Permission to use Bash with command git push 2>&1 has been denied.` | $0.151 |
| `s2` | `settings-v1.json` | `git reset HEAD~1 --hard` | `Permission to use Bash with command git reset HEAD~1 --hard has been denied.` | $0.038 |
| `s3` | `settings-v1.json` | `git status` | `On branch main` | $0.029 |
| `s4` | `settings-v1.json` | `cd /tmp && git push 2>&1` | `Permission to use Bash with command cd /tmp && git push 2>&1 has been denied.` | $0.037 |
| `s5` | `settings-v1.json` | `echo "$(git push 2>&1)"` | `Permission to use Bash with command echo "$(git push 2>&1)" has been denied.` | $0.034 |
| `s6` | `settings-v1.json` | `git checkout -b probe-branch 2>&1` | `Claude requested permissions to use Bash, but you haven't granted it yet.` | $0.032 |
| `s7` | `settings-v1.json` | `git stash` | `This command requires approval` | $0.154 |
| `s8` | `settings-v1b.json` | `git stash` | `Claude requested permissions to use Bash, but you haven't granted it yet.` | $0.034 |
| `p7` | `settings-v2.json` | `git reset --hard HEAD~1` | `Permission to use Bash with command git reset --hard HEAD~1 has been denied.` | $0.036 |
| `p8` | `settings-v2.json` | `git reset HEAD~1 --hard` | `This command requires approval` | $0.040 |

三種句子:`has been denied` = deny 中了;`haven't granted` = ask 中了;`requires approval` = 沒中任何規則,掉進預設流程(`-p` 沒人可問,視同拒絕)。`p8` 就是「換個順序就繞開窄 deny」的證據。

本機路徑已換成 `<lab>` / `<home>`。

## 第二段:branch protection + worktree → PR(同日下午)

`pr/` 底下。本機路徑換成 `<lab>`(乾淨 clone,有 origin)、`<lab-wt-dueat>` / `<lab-wt-state>`(兩個 worktree)。

- `push-main-rejected.txt`:開 branch protection 後從乾淨 clone 直接 `git push origin main` 的拒絕輸出(GH006)
- `settings-v3.json` → `v4` → `v5`:文章最後那份是 v5。v3 把 push/pr create 放 ask;v4 改 allow 但寫成 `feature/:*`(對不到分支名);v5 改 `feature/*`
- `t1–t6`(v3)、`u1–u14`(v4/v5,找 push 為什麼推不出去)、`v1–v9`(v5,文章那張表)
- `flow-*.jsonl`:PR #1(`dueAt`)—— `flow`(寫到 commit,push 卡在 ask)、`flow2`/`flow3`/`flow4`(規則沒改對)、`flow5`(推上去、開 PR)
- `flow-b-*.jsonl`:PR #2(`book-state`)—— `flow-b`(一路到開 PR)、`flow-b2`(讀 review、npm install、重跑、補 spec、同分支再 commit、回覆)
- `pr1.json` / `pr2.json` / `pr2-line-comments.json`:兩個 PR 的 metadata、review、comment

### 三個撞到的坑

| 坑 | 證據 | 結論 |
|---|---|---|
| `Bash(git push origin feature/:*)` 對不到 `feature/due-at` | `u3` vs `u7` | `:*` = 前綴 + 空格 + 任意;要對到分支名用 `feature/*` |
| `git push -u origin …` 對不到 `git push origin feature/*` | `flow` 第一次 push | 旗標插在前面,前綴就斷了;兩種寫法都要列 |
| 專案 `settings.json` 的 `allow` 在沒信任過的資料夾裡不生效 | `u10`(settings 裡的 allow → requires approval)vs `u11`(同一條用 `--allowedTools` → 過);`u12` 同時證明 deny 有載入 | 擋人的規則立即生效,放行的規則要等信任;`-p` 在乾淨 clone 要用 `--allowedTools` |

### PR 流程的三個事實

- AI 用 owner 的 `gh` 登入開 PR → GitHub 把 owner 當作者,Request changes / Approve 按不了,只能 Comment
- `gh pr merge` 在 deny;`git push origin HEAD:main` 穿過 `deny`(字面沒有 `git push origin main`),但 branch protection 在 server 端擋
- PR #2:reviewer 退兩件(vitest 版本不對的綠燈、規格沒寫的決定),AI 同分支再 commit `7f8040a`,squash merge `7108a6b`;`package-lock.json` 它沒 commit(CLAUDE.md 不主動加東西)

# Day 19:把寫測試外包給地端模型,用突變檢查驗它寫得好不好

- 日期:2026-09-26;標的 `src/domain/book-state.js`、`due-at.js`,起點 `ee08920`(規格 v3)
- 環境:Mac mini M4 Pro 64 GB、LM Studio + `qwen3.6-35b-a3b-mlx`、Pi 0.84.2(不給 bash,只准寫 `tests/local/**`)、Vitest 3.2.7、StrykerJS 10.0.0(見 `ENV.txt`)
- 路徑已換成代稱:`<lab>` 受測複本、`<tmp>`、`<home>`

## 資料夾

- `PLAN.md`:測試清單(A1–A12 + B1–B7)。`precise*` 是給完整清單的三輪,`vague*` 是只給一句話的三輪
- `precise/`、`precise-r2/`、`precise-r3/`、`vague/`、`vague-r2/`、`vague-r3/`:每輪的測試檔(有 `*.raw.test.js` 的是模型交回的原樣,`rework.diff` 是人工返工改了什麼;commit 對應見 `lab-git-log.txt`)、Pi 的輸出(`.out`/`.log`)、Stryker 報告(`*.json` 與文字摘要)
- `cloud/`:對照組(雲端模型寫的測試)與它的 Stryker 報告
- `lab-git-log.txt`:受測複本的 commit 紀錄(每輪「原樣」與「人工返工」各一個 commit)
- `stryker.config.example.json`:Stryker 設定

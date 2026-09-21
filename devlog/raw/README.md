# 實驗原文索引

規格在 2026-09-17 簡化過一次(副本 + 預約 + 保留 → 一書一冊、沒有排隊)。每個資料夾跑的時候規格是哪一版,在這裡對:

| 資料夾 | 規格版本 | 內容 |
|---|---|---|
| `../prior-experiments/` | 寫規格之前(空目錄) | A1:同一題目兩種 prompt 的 schema 原文 |
| `exp-day08-planmode/` | v2(`896561e`,含預約與保留) | Plan Mode 第一輪:162 行計畫 + 5 題 |
| `exp-day07-planmode-rounds/` | v2 | Plan Mode 第二、三輪:回答 5 題 → 再問 4 題 → 「沒有了」 |
| `exp-day08-grillme/` | v2(`f20324e`) | `/grill-me` 四輪 27 題 |
| `exp-day07-planmode-v3/` | **v3(最簡版)** | Plan Mode 重跑 |
| `exp-day08-grillme-v3/` | **v3** | `/grill-me` 重跑 |
| `exp-day08-grillwithdocs-v3/` | **v3** | `/grill-with-docs` 五輪 33 題,產出 CONTEXT.md + 2 份 ADR(`produced/`) |
| `exp-day08-grillme-vm/` | **v3** | 作者在乾淨 VM 裡親手重跑 `/grill-me`:4 輪 18 題,含完整 DECISIONS.md 草稿(round4) |
| `exp-day08-grillwithdocs-vm/` | **v3** | 同一台 VM 重跑 `/grill-with-docs`:5 輪 21 題,CONTEXT.md + 2 份 ADR + 16 步順序表(`produced/`) |
| `exp-day09-red-test/` | v3 | 紅測試 `overdueDays` → AI 綠 |

v2 的三個資料夾保留不動,是歷史;文章引用的是 v3。

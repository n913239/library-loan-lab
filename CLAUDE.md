# CLAUDE.md — 圖書館借閱系統

## 這個專案是什麼

圖書館借閱 API。對外叫借書,對內跑的是**有限資源的分配**:
副本有限、借走就少、全借出時排隊、歸還後隊首保留、逾時釋放。不收罰款(非目標 2)。

## 硬規則(違反 = CI 紅燈,不是風格問題)

1. **時間是參數,不是副作用。** `src/domain/` 不准出現 `Date.now()` / `new Date()`;
   `now` 從外面傳進來。取現在時間是 `routes` / `worker` 的責任。
2. **副本的狀態只能照白名單轉移。** `available → on_loan → available`、
   `available → held → on_loan | available`。轉移表寫在 `src/domain/copy-state.js`,
   不准在別處寫 `status = '...'`。
3. **併發判斷必須在 SQL 的 `WHERE` 裡**,不能在應用層先查再寫。
   條件式寫入 + 檢查 `changes`,並用 `CHECK` 當第二道防線。
4. **日期時間一律 UTC 的 ISO-8601 字串**進出資料庫;時區換算只能在 `src/presentation/`。
5. **逾期天數用借閱紀錄上的 `due_at` 快照算。** 歸還時不准 JOIN 借期政策表即時重算。

## 目錄

```
src/domain/        純邏輯,無 I/O,時間從參數進來
src/routes/        Hono handler,負責取現在時間、驗身分
src/presentation/  顯示轉換(唯一可以做時區換算的地方)
tests/             測試;併發測試一律用閘門,不用隨機延遲
scripts/           靜態檢查
devlog/            每天記 AI 交出什麼(原文,不要轉述)
docs/              spec / non-goals
```

## 不做的事

見 `docs/non-goals.md`,15 條。**不要主動加表、加欄位、加 endpoint。**
你認為缺的東西,先問。

## 提交

- 一個變更一個 commit,message 用中文
- **不要加 `Co-Authored-By` 或任何 AI 署名 trailer**
- 實驗性質的 commit,message 要寫明「AI 尚未介入」或「AI 版」

## 寫測試

- 先寫一個會紅的測試,再動手
- 併發測試要能重跑 5 次結果一致;**不穩定的重現 = 沒有重現**

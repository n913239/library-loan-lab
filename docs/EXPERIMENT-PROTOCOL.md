# 實驗紀律

## 順序(不可逆)

```
1. 我自己寫             → commit,message 明寫「AI 尚未介入」
2. 開乾淨 session       → AI 出一版
3. AI 版另外 commit     → 原始輸出存 devlog/raw/
4. 比對差異             → 寫進文章
```

**兩個 commit 的先後就是證據,讀者查得到。**

乾淨 session 的定義:全新 clone、`rm -rf .git`、拿掉 `docs/spec.md` 與 `docs/non-goals.md`;
`CLAUDE.md` 照常載入 —— 量的是「規則已經寫給它了,它會不會照做」,不是「真空裡會不會出錯」。

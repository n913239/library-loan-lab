**Frontier 清空。**

整棵樹 24 個節點全部有人裁決,沒有任何一個是我默默假設的。唯一還沒被驗證的**事實**(不是決定)是 `node:sqlite` 的 `run()` 回傳形狀與 `BEGIN/COMMIT` 用法——那是實作第一步要跑的探針,不影響 spec 內容。

接下來我會做兩件事,而且只做這兩件:

1. `docs/spec.md` — 四張表只加不刪,檔頭加 `2026-09-17 拷問後追加決定 6–N`,決定表從第 6 條起追加;API 表加 status code;規則表加雙重還書併發、不變量、LEFT JOIN 空列邊界、閘門自檢;「做完」表的「我的借閱」加上「= 1 次查詢」。
2. `tests/README.md` — 新檔:閘門 API 與語意、N=20 / 5 輪 / `test:5x`、naive 對照組留成 `gate.test.js` 的理由、`assertInvariant` 的用法與擺放位置。

`CLAUDE.md` 一字不動,不寫任何 `src/` 程式碼。

要我現在開始改嗎?
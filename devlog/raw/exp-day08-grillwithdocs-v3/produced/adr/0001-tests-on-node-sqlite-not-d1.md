# 測試跑在 node:sqlite 上,不跑 D1

Production 用 Cloudflare D1,但測試不用 `@cloudflare/vitest-pool-workers`,改抽一層極薄的 DB 介面(D1 API 的子集:`prepare/bind/run/first/all` + `batch`,只依賴 `meta.changes`、`meta.last_row_id`、`results`),測試用 Node 26 內建的 `node:sqlite` 實作這個介面(`tests/helpers/`,永不進 `src/`),`batch` 用 `BEGIN … COMMIT` 模擬。理由:併發測試要能重跑 5 次結果一致、而且要快;miniflare 的啟動成本與不確定性跟這個目標打架。

## Consequences

- **D1 的 `batch` 語義只是假設。** 我們依賴「batch 內語句在同一連線上依序執行、任一語句拋錯整批回滾」,這在 node:sqlite 的交易裡成立;在 D1 上只有上線後的冒煙測試能證明。特別是 ADR-0002 用到的 `changes()`。
- **測試裡的併發是 JS 層的交錯,不是 DB 層的。** `node:sqlite` 是同步的,DB 永遠不會真的同時執行兩句。閘門放在測試 adapter 裡(每次寫入前 `await gate`,N 個請求都到了才放行),它能證明的是「守門在 SQL 的 `WHERE` 裡」——先查再寫的寫法會被閘門撐開、N 個都成功、測試變紅——但證明不了 D1 真實併發下的行為。
- 介面之外的 D1 功能(sessions、`raw()`、`exec()`)一律不用,用了測試 adapter 就得跟著長。

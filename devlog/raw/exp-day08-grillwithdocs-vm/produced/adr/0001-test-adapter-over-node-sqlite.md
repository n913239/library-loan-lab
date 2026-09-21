# 測試用自抽的 D1 子集 adapter 跑 node:sqlite,不用 miniflare

併發正確性是這個專案的重心,而併發測試需要一個能在請求之間**插進閘門**的執行環境。
miniflare 的 D1 把連線藏在背後,閘門插不進「查狀態」與「寫狀態」之間那道縫,
於是一個寫錯的實作(先查再寫)也會測出綠燈。
我們改成自己定義一層極薄的 D1 API 子集(`prepare` / `bind` / `run` / `first` / `all` / `batch`):
production 直接傳進 D1 物件,測試傳進 `node:sqlite` 的實作,閘門裝在測試實作的寫入呼叫之前。

## Considered Options

- **`@cloudflare/vitest-pool-workers` + miniflare**:最接近正式環境,但閘門無處可放,反向驗證失效。
- **`wrangler dev` 起真 server 打 HTTP**:最真實,但慢、CI 難、違反「重跑 5 次結果一致」。
- **`better-sqlite3`**:要多一個原生相依,而 `node:sqlite` 已內建。

## Consequences

- adapter 外層**必須回 Promise**,即使 `node:sqlite` 是同步的。否則整個測試沒有任何 await point,
  交錯永遠不會發生,那個故意違規的 fixture 會通過 —— 反向驗證會反過來證明錯誤的事。
- `batch()` 內部**必須一路同步跑完,中間不准 await**。單一連線下兩個 `BEGIN` 交錯,
  SQLite 會拒絕(`cannot start a transaction within a transaction`)。
  縫要開在請求之間,不能開在交易中間。
- adapter 是唯一知道兩邊差異的地方,正規化的責任全在它身上:
  `lastInsertRowid` → `meta.last_row_id`、強制 `Number`、`changes === 0` 時設成 `null`
  (SQLite 的 rowid 是連線層級的,守衛式 INSERT 插 0 列時會回上一個請求的值)。
- **沒被測到的**是 D1 自己的行為:網路、真正的並行寫入、它的交易語意。
  這套測的是「條件式 `WHERE` 有沒有被正確使用」,不是 D1 的實作正確性。

# session 的收尾訊息(原文)

計畫寫在 `/Users/<host>/.claude/plans/14-48-silly-magpie.md`。

repo 目前是空骨架(沒有 `package.json`、schema、測試),所以這次「實作借閱」等於從零把 schema、API、狀態機、併發保護、測試和靜態檢查一次立起來。CLAUDE.md 規定表/欄位/endpoint 缺的要先問,以下是需要你決定的 5 點(這個 session 沒有提問工具,直接回我文字就好):

1. **Schema 4 張表**:`books`、`copies`、`loans`、`reservations`。不建 `members`,讀者身分 = JWT `sub`。OK?
2. **Endpoint 3 條**:`POST /loans {copy_id}`、`POST /loans/:id/return`(借書人自己還)、`POST /books/:id/reservations`。不做 GET 查詢。OK?
3. **保留逾時後**:副本直接變 `available`,還是**順延給下一位隊首**?我建議順延,但需求句只寫「釋放」。
4. **測試環境**:建議 `vitest` + `@cloudflare/vitest-pool-workers`(真 D1,要 `npm install`);或用 Node 內建 `node:sqlite` 模擬 D1 介面、不裝 Cloudflare 工具鏈。
5. **加目錄** `src/db/`(SQL 存取層)和 `src/index.js`(`fetch` + `scheduled` cron)。OK?

核心設計摘要:
- 轉移表只在 `src/domain/copy-state.js`,SQL 裡 `status` 全用綁定參數,靜態檢查 `scripts/check-rules.sh` 抓 `status = '` 字面值和 domain 內的 `Date.now()`/`new Date()`。
- 併發:D1 `batch()` 是原子的,每句 `WHERE` 都帶同一個前置條件,會改變前置條件的那句放最後;只看 `meta.changes`,不先查再寫。`loans` 上加 partial unique index 當第二道防線。
- 歸還走 `on_loan → available → held` 兩步,不走白名單外的 `on_loan → held`。
- 併發測試用閘門包住 `env.DB.batch()`,讓兩個請求同時進入再放行,斷言剛好一個 201 一個 409,重跑 5 次。

順帶一提:我看到旁邊有 `library-loan-lab` 目錄,依實驗協定我沒有去讀它。

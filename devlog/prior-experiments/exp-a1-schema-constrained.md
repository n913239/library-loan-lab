# A1-a:「只有三張表」的 prompt

2026-09-16 實跑,Claude Code 2.1.271、Opus 5,空目錄(沒有 CLAUDE.md、沒有規格),`claude -p`。
23 秒、1 turn、$0.16。

prompt(一字未改):

> 為一個圖書館借閱系統設計 Cloudflare D1(SQLite)的 schema。需求只有三張表:書目(books)、副本(copies)、借閱(loans)。請直接給我 SQL。

以下是回覆原文,一個字沒改。自己數 `CREATE TABLE` / `CREATE INDEX`。

---

```sql
-- Cloudflare D1 (SQLite) — 圖書館借閱系統
-- 日期一律存 ISO-8601 文字（UTC），D1 預設已啟用 foreign_keys。

CREATE TABLE books (
  id              INTEGER PRIMARY KEY,
  isbn            TEXT    UNIQUE,                 -- 可為 NULL（舊書/無 ISBN）
  title           TEXT    NOT NULL,
  author          TEXT,
  publisher       TEXT,
  published_year  INTEGER,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE copies (
  id           INTEGER PRIMARY KEY,
  book_id      INTEGER NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  barcode      TEXT    NOT NULL UNIQUE,           -- 館藏條碼
  -- 只記錄實體狀態；「借出中」由 loans 推導，不重複存
  status       TEXT    NOT NULL DEFAULT 'available'
               CHECK (status IN ('available', 'lost', 'withdrawn')),
  acquired_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX copies_book_id_idx ON copies(book_id);

CREATE TABLE loans (
  id           INTEGER PRIMARY KEY,
  copy_id      INTEGER NOT NULL REFERENCES copies(id) ON DELETE RESTRICT,
  borrower_id  TEXT    NOT NULL,                  -- 讀者識別碼（沒有 members 表，先存字串）
  loaned_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  due_at       TEXT    NOT NULL,
  returned_at  TEXT,                              -- NULL = 尚未歸還
  CHECK (due_at > loaned_at),
  CHECK (returned_at IS NULL OR returned_at >= loaned_at)
) STRICT;

-- 同一副本同時只能有一筆未歸還的借閱（partial unique index）
CREATE UNIQUE INDEX loans_active_copy_uq ON loans(copy_id) WHERE returned_at IS NULL;

CREATE INDEX loans_borrower_active_idx ON loans(borrower_id) WHERE returned_at IS NULL;
CREATE INDEX loans_due_at_idx           ON loans(due_at)      WHERE returned_at IS NULL;
```

幾個設計取捨：

- **「借出中」不存在 `copies.status`**，用 `loans.returned_at IS NULL` 推導，靠 partial unique index 保證一本副本不會被借兩次；避免兩處狀態不同步。
- 查可借副本：`SELECT c.* FROM copies c WHERE c.status = 'available' AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.copy_id = c.id AND l.returned_at IS NULL)`。
- 逾期清單直接走 `loans_due_at_idx`：`WHERE returned_at IS NULL AND due_at < ?`。
- `ON DELETE RESTRICT` 保留歷史：有借閱紀錄的副本、有副本的書目不能直接刪，要下架用 `status = 'withdrawn'`。
- `STRICT` 讓 D1 真的檢查型別（INTEGER 欄位塞字串會報錯），不需要可以拿掉。
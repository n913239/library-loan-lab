# A1-b:講需求、不講表數的 prompt

2026-09-16 實跑,Claude Code 2.1.271、Opus 5,空目錄(沒有 CLAUDE.md、沒有規格),`claude -p`。
128 秒、1 turn、$0.35。

prompt(一字未改):

> 幫我設計一個圖書館借閱系統的 Cloudflare D1(SQLite)schema。需求:書目、副本、借閱三個概念;讀者可以借一個可借的副本,借期 14 天;書全借出時可以預約排隊,歸還後隊首保留 48 小時,逾時自動釋放。SQL 直接寫在回覆裡,不要寫檔。

以下是回覆原文,一個字沒改。自己數 `CREATE TABLE` / `CREATE INDEX`。

---

## 設計重點

- **時間用 INTEGER(unix 秒)**:SQLite 沒有原生 datetime,整數做 `+14*86400` 這種運算最乾淨,D1 也不用轉型。
- **預約掛在書目(book),不是副本**:讀者排的是「這本書」,歸還時才把具體副本指派給隊首。
- **`copies.status` 是反正規化欄位**:真相在 `loans` / `holds`,但「找一本可借的」是熱查詢,所以留狀態欄,並用 partial unique index 兜底防止狀態漂移。
- **D1 沒有排程器**:「逾時自動釋放」靠 Worker Cron Trigger 定期掃,外加借書/歸還時順手做一次 lazy 過期,正確性不依賴 cron 頻率。
- **併發**:D1 每個 DB 單一 writer,`db.batch()` 整批 atomic;用「條件式 UPDATE + 看 `meta.changes`」就夠,不需要 `SELECT ... FOR UPDATE`。

## Schema

```sql
-- 書目:一本書的 metadata,不管有幾本實體
CREATE TABLE books (
  id             INTEGER PRIMARY KEY,
  isbn           TEXT UNIQUE,
  title          TEXT NOT NULL,
  author         TEXT,
  publisher      TEXT,
  published_year INTEGER,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 副本:實體書,一本一條碼
CREATE TABLE copies (
  id         INTEGER PRIMARY KEY,
  book_id    INTEGER NOT NULL REFERENCES books(id),
  barcode    TEXT NOT NULL UNIQUE,
  status     TEXT NOT NULL DEFAULT 'available'
             CHECK (status IN ('available','on_loan','held','lost','withdrawn')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_copies_book_status ON copies(book_id, status);

-- 讀者
CREATE TABLE members (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT UNIQUE,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 借閱:returned_at IS NULL 代表進行中
CREATE TABLE loans (
  id          INTEGER PRIMARY KEY,
  copy_id     INTEGER NOT NULL REFERENCES copies(id),
  member_id   INTEGER NOT NULL REFERENCES members(id),
  borrowed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  due_at      INTEGER NOT NULL,            -- borrowed_at + 14*86400
  returned_at INTEGER,
  CHECK (due_at > borrowed_at),
  CHECK (returned_at IS NULL OR returned_at >= borrowed_at)
);
-- 一個副本同時只能有一筆進行中的借閱(防雙重借出的最後防線)
CREATE UNIQUE INDEX uq_loans_active_copy ON loans(copy_id) WHERE returned_at IS NULL;
CREATE INDEX idx_loans_member_active ON loans(member_id) WHERE returned_at IS NULL;
CREATE INDEX idx_loans_overdue       ON loans(due_at)    WHERE returned_at IS NULL;

-- 預約:對書目排隊
--   queued    排隊中
--   ready     有副本保留給他,48h 內要來取
--   fulfilled 已取書(轉成 loan)
--   expired   逾時未取,自動釋放
--   cancelled 讀者自己取消
CREATE TABLE holds (
  id          INTEGER PRIMARY KEY,
  book_id     INTEGER NOT NULL REFERENCES books(id),
  member_id   INTEGER NOT NULL REFERENCES members(id),
  status      TEXT NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued','ready','fulfilled','expired','cancelled')),
  queued_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  copy_id     INTEGER REFERENCES copies(id), -- ready 時才有值:保留的是哪本
  ready_at    INTEGER,
  expires_at  INTEGER,                       -- ready_at + 48*3600
  resolved_at INTEGER,                       -- fulfilled / expired / cancelled 的時間
  CHECK (status <> 'ready'  OR (copy_id IS NOT NULL AND ready_at IS NOT NULL AND expires_at IS NOT NULL)),
  CHECK (status <> 'queued' OR copy_id IS NULL)
);
-- 同一讀者對同一書目只能有一筆進行中的預約
CREATE UNIQUE INDEX uq_holds_active_member_book ON holds(member_id, book_id)
  WHERE status IN ('queued','ready');
-- 一個副本同時只能保留給一個人
CREATE UNIQUE INDEX uq_holds_ready_copy ON holds(copy_id) WHERE status = 'ready';
-- 取隊首:同書目按 queued_at、再按 id
CREATE INDEX idx_holds_queue  ON holds(book_id, queued_at, id) WHERE status = 'queued';
-- Cron 掃過期
CREATE INDEX idx_holds_expiry ON holds(expires_at) WHERE status = 'ready';
```

## 核心操作(每組都放進一個 `db.batch()`)

### 共用:釋放一個副本 → 指派給隊首,沒人排就變 available

歸還和過期都會用到,`?1 = copy_id`。

```sql
-- R1. 把這本書最早的 queued 轉成 ready,保留這個副本 48h
UPDATE holds
SET status = 'ready', copy_id = ?1,
    ready_at = unixepoch(), expires_at = unixepoch() + 48*3600
WHERE id = (
  SELECT h.id FROM holds h
  JOIN copies c ON c.book_id = h.book_id
  WHERE c.id = ?1 AND h.status = 'queued'
  ORDER BY h.queued_at, h.id
  LIMIT 1
);

-- R2. 有人接走就 held,否則 available
UPDATE copies
SET status = CASE
  WHEN EXISTS (SELECT 1 FROM holds WHERE copy_id = ?1 AND status = 'ready') THEN 'held'
  ELSE 'available'
END
WHERE id = ?1 AND status IN ('on_loan','held');
```

### 借書(一般,無預約)

App 先 `SELECT id FROM copies WHERE book_id=? AND status='available' LIMIT 1` 挑一本,再 batch。`?1 = copy_id, ?2 = member_id`。

```sql
-- B1. 搶副本:條件式 UPDATE,被別人先搶就 changes = 0
UPDATE copies SET status = 'on_loan' WHERE id = ?1 AND status = 'available';

-- B2. 建立借閱;WHERE 卡住 B1 沒成功的情況,
--     真的有人並發借走則撞 uq_loans_active_copy,整批 rollback
INSERT INTO loans (copy_id, member_id, due_at)
SELECT id, ?2, unixepoch() + 14*86400
FROM copies WHERE id = ?1 AND status = 'on_loan';
```

App 檢查 B2 的 `meta.changes === 1`,否則回「已被借走」。

### 借書(取預約)

`?1 = hold_id, ?2 = member_id`。

```sql
-- H1. 關閉預約;逾時的不能取(交給 cron 收拾)
UPDATE holds SET status = 'fulfilled', resolved_at = unixepoch()
WHERE id = ?1 AND member_id = ?2 AND status = 'ready' AND expires_at > unixepoch();

-- H2. 副本 held → on_loan
UPDATE copies SET status = 'on_loan'
WHERE id = (SELECT copy_id FROM holds WHERE id = ?1 AND status = 'fulfilled')
  AND status = 'held';

-- H3. 建立借閱
INSERT INTO loans (copy_id, member_id, due_at)
SELECT c.id, ?2, unixepoch() + 14*86400
FROM holds h JOIN copies c ON c.id = h.copy_id
WHERE h.id = ?1 AND h.status = 'fulfilled' AND c.status = 'on_loan';
```

### 歸還

`?1 = copy_id`。

```sql
UPDATE loans SET returned_at = unixepoch()
WHERE copy_id = ?1 AND returned_at IS NULL;
-- 接著跑 R1、R2
```

### 預約

`?1 = book_id, ?2 = member_id`。

```sql
-- 有現貨就不給排(changes = 0 → 叫他直接借);已在排隊會撞 uq_holds_active_member_book
INSERT INTO holds (book_id, member_id)
SELECT ?1, ?2
WHERE NOT EXISTS (
  SELECT 1 FROM copies WHERE book_id = ?1 AND status = 'available'
);
```

查排隊順位:

```sql
SELECT COUNT(*) + 1 AS position
FROM holds
WHERE book_id = ?1 AND status = 'queued'
  AND (queued_at, id) < (SELECT queued_at, id FROM holds WHERE id = ?2);
```

### 逾時自動釋放(Cron Trigger,例如 `*/10 * * * *`)

```sql
-- X1. 過期的 ready → expired,回傳被釋放的副本
UPDATE holds SET status = 'expired', resolved_at = unixepoch()
WHERE status = 'ready' AND expires_at <= unixepoch()
RETURNING copy_id;

-- X2. 對每個回傳的 copy_id 跑 R1、R2(讓下一位接手,或變回 available)
```

Worker 端 `scheduled()` handler 先跑 X1,把 `copy_id` 陣列 map 成 R1/R2 statements 一次 `batch()`。建議在借書、歸還的 request 開頭也順手跑一次同樣邏輯(lazy expiry),這樣就算 cron 延遲,讀者看到的狀態也是對的。

## 兩個要注意的地方

- **`unixepoch()` 需要 SQLite ≥ 3.38**,D1 目前是 3.4x 沒問題;如果你有本地用舊版 sqlite3 跑 migration 的習慣,改成 `CAST(strftime('%s','now') AS INTEGER)`。
- **書目下架 / 副本遺失**:`copies.status = 'lost' | 'withdrawn'` 的副本不會被 R1 撿到(因為 R2 的 WHERE 只認 `on_loan`/`held`),但如果一本書所有副本都遺失,隊列會永遠卡住,需要在把副本標 lost 時另外處理(取消隊列或通知),這部分我沒放進 schema,要的話再說。
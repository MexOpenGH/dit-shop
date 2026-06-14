-- ============================================================
-- Dit Shop — SQLite schema (auto-applied on first server start)
-- ============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT NOT NULL UNIQUE,
    email       TEXT NOT NULL UNIQUE,
    password    TEXT NOT NULL,
    full_name   TEXT,
    role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
    avatar_url  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS users_updated_at
AFTER UPDATE ON users FOR EACH ROW
BEGIN
    UPDATE users SET updated_at = datetime('now') WHERE id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS gift_cards (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    description   TEXT,
    denomination  REAL NOT NULL,
    price         REAL NOT NULL,
    currency      TEXT NOT NULL DEFAULT 'USD',  -- USD, LAK (Lao Kip), THB (Thai Baht)
    image_url     TEXT,
    category      TEXT,
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gift_card_codes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    gift_card_id  INTEGER NOT NULL,
    code          TEXT NOT NULL UNIQUE,
    status        TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','reserved','used')),
    added_by      INTEGER,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (gift_card_id) REFERENCES gift_cards(id) ON DELETE CASCADE,
    FOREIGN KEY (added_by)     REFERENCES users(id)      ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    gift_card_id    INTEGER NOT NULL,
    code_id         INTEGER,
    quantity        INTEGER NOT NULL DEFAULT 1,
    total_price     REAL NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','delivered','cancelled')),
    payment_ref       TEXT,
    payment_proof_url TEXT,    -- screenshot/photo of payment receipt
    notes             TEXT,
    confirmed_by    INTEGER,
    confirmed_at    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id)      REFERENCES users(id)            ON DELETE CASCADE,
    FOREIGN KEY (gift_card_id) REFERENCES gift_cards(id)       ON DELETE RESTRICT,
    FOREIGN KEY (code_id)      REFERENCES gift_card_codes(id)  ON DELETE SET NULL,
    FOREIGN KEY (confirmed_by) REFERENCES users(id)            ON DELETE SET NULL
);

CREATE TRIGGER IF NOT EXISTS orders_updated_at
AFTER UPDATE ON orders FOR EACH ROW
BEGIN
    UPDATE orders SET updated_at = datetime('now') WHERE id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS inbox_messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,                 -- recipient (inbox owner)
    from_user_id  INTEGER,                          -- author; NULL for system messages
    order_id      INTEGER,
    sender        TEXT NOT NULL DEFAULT 'Dit Shop',
    subject       TEXT NOT NULL,
    body          TEXT NOT NULL,
    is_help       INTEGER NOT NULL DEFAULT 0,       -- 1 = user→admin help request
    parent_id     INTEGER,                          -- reply chain pointer
    is_read       INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id)      REFERENCES users(id)            ON DELETE CASCADE,
    FOREIGN KEY (from_user_id) REFERENCES users(id)            ON DELETE SET NULL,
    FOREIGN KEY (order_id)     REFERENCES orders(id)           ON DELETE SET NULL,
    FOREIGN KEY (parent_id)    REFERENCES inbox_messages(id)   ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_codes_status     ON gift_card_codes(gift_card_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_user      ON orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_status    ON orders(status);
CREATE INDEX IF NOT EXISTS idx_inbox_user_read  ON inbox_messages(user_id, is_read);
-- idx_inbox_help is created in config/db.js after the is_help ADD COLUMN migration,
-- so we don't create it here (would fail on DBs that pre-date the column).

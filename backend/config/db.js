// ============================================================
// Dit Shop — SQLite adapter (mysql2-compatible interface)
// ============================================================
// The routes were written for mysql2's promise pool API. Rather than
// rewrite them, this adapter exposes the same surface (execute / query /
// getConnection / transactions) on top of better-sqlite3, and silently
// translates a handful of MySQL-isms into SQLite syntax.

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
require('dotenv').config();

// ── Open / create the DB file ─────────────────────────────────
const DB_PATH = process.env.DB_PATH ||
                path.join(__dirname, '..', '..', 'database', 'ditshop.sqlite');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// ── Bootstrap: apply schema on first run ──────────────────────
const schemaPath = path.join(__dirname, '..', '..', 'database', 'schema.sqlite.sql');
sqlite.exec(fs.readFileSync(schemaPath, 'utf8'));

// ── Lightweight migrations: ADD COLUMN if missing (idempotent) ─
function hasColumn(table, col) {
    return sqlite.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}
if (!hasColumn('gift_cards', 'currency')) {
    sqlite.exec("ALTER TABLE gift_cards ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'");
    console.log('✓ Migrated: added currency column to gift_cards');
}
if (!hasColumn('orders', 'payment_proof_url')) {
    sqlite.exec("ALTER TABLE orders ADD COLUMN payment_proof_url TEXT");
    console.log('✓ Migrated: added payment_proof_url column to orders');
}

// HELP messaging (user ↔ admin) — added in v2
// SQLite ADD COLUMN can't include REFERENCES, so we add plain columns; FK
// integrity for from_user_id / parent_id is enforced at insert-time via the
// application code (admin-only writes paths).
if (!hasColumn('inbox_messages', 'from_user_id')) {
    sqlite.exec("ALTER TABLE inbox_messages ADD COLUMN from_user_id INTEGER");
    console.log('✓ Migrated: added from_user_id column to inbox_messages');
}
if (!hasColumn('inbox_messages', 'is_help')) {
    sqlite.exec("ALTER TABLE inbox_messages ADD COLUMN is_help INTEGER NOT NULL DEFAULT 0");
    console.log('✓ Migrated: added is_help column to inbox_messages');
}
if (!hasColumn('inbox_messages', 'parent_id')) {
    sqlite.exec("ALTER TABLE inbox_messages ADD COLUMN parent_id INTEGER");
    console.log('✓ Migrated: added parent_id column to inbox_messages');
}
if (!hasColumn('inbox_messages', 'image_url')) {
    sqlite.exec("ALTER TABLE inbox_messages ADD COLUMN image_url TEXT");
    console.log('✓ Migrated: added image_url column to inbox_messages');
}
sqlite.exec("CREATE INDEX IF NOT EXISTS idx_inbox_help ON inbox_messages(is_help, is_read)");

// ── Seed: admin account + sample gift cards (idempotent) ──────
// Note: email is stored lowercase because express-validator's
// normalizeEmail() lowercases on login → SQLite TEXT is case-sensitive.
const ADMIN_EMAIL = 'nicklpb1123@gmail.com';
const ADMIN_HASH  = '$2a$10$927TdaX/0ZdUIyhe/KLz8esFpjs8Eev/wz2di51c2TDkOBPvtwdMu'; // bcrypt of "khamphet"

const existingAdmin = sqlite.prepare('SELECT id, email FROM users WHERE role = ? LIMIT 1').get('admin');
if (!existingAdmin) {
    sqlite.prepare(
        `INSERT INTO users (username, email, password, full_name, role)
         VALUES (?,?,?,?,?)`
    ).run('Bandit', ADMIN_EMAIL, ADMIN_HASH, 'Bandit', 'admin');
    console.log('✓ Seeded admin account: nicklpb1123@gmail.com');
} else if (existingAdmin.email !== ADMIN_EMAIL) {
    // Fix any older seed that used mixed-case email.
    sqlite.prepare('UPDATE users SET email = ?, password = ? WHERE id = ?')
          .run(ADMIN_EMAIL, ADMIN_HASH, existingAdmin.id);
    console.log('✓ Normalized admin email to lowercase');
}

const cardCount = sqlite.prepare('SELECT COUNT(*) AS c FROM gift_cards').get().c;
if (cardCount === 0) {
    const insert = sqlite.prepare(
        `INSERT INTO gift_cards (name, description, denomination, price, category, image_url)
         VALUES (?,?,?,?,?,?)`
    );
    const samples = [
        ['Steam Gift Card $10',   'Use on any Steam purchase.',              10.00, 10.50, 'Gaming',    '/img/steam.png'],
        ['Netflix Gift Card $25', '1 month premium subscription voucher.',   25.00, 26.00, 'Streaming', '/img/netflix.png'],
        ['Google Play $15',       'Buy apps, games, or movies on Google.',   15.00, 15.75, 'Mobile',    '/img/google.png'],
        ['Amazon Gift Card $50',  'Shop anything on Amazon.com.',            50.00, 51.00, 'Shopping', '/img/amazon.png'],
        ['Spotify Premium $10',   '1 month ad-free music streaming.',        10.00, 10.25, 'Streaming', '/img/spotify.png'],
    ];
    const seedAll = sqlite.transaction(rows => rows.forEach(r => insert.run(...r)));
    seedAll(samples);
    console.log(`✓ Seeded ${samples.length} sample gift cards`);
}

// ─────────────────────────────────────────────────────────────
// MySQL → SQLite translation layer
// ─────────────────────────────────────────────────────────────
function translate(sql, params) {
    // NOW()  →  CURRENT_TIMESTAMP
    sql = sql.replace(/\bNOW\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP');

    // INSERT IGNORE  →  INSERT OR IGNORE   (also REPLACE / UPDATE IGNORE)
    sql = sql.replace(/\bINSERT\s+IGNORE\b/gi, 'INSERT OR IGNORE');

    // Strip MySQL row-locking hint — SQLite doesn't need it (WAL + tx isolates).
    sql = sql.replace(/\bFOR\s+UPDATE\b/gi, '');

    // mysql2 batch-insert sugar:
    //   db.query('INSERT INTO t (a,b) VALUES ?', [ [[1,2],[3,4]] ])
    // → INSERT INTO t (a,b) VALUES (?,?),(?,?)   with flat params
    const batchMatch = /VALUES\s*\?\s*$/i.exec(sql.trim());
    if (batchMatch && Array.isArray(params[0]) && Array.isArray(params[0][0])) {
        const rows  = params[0];
        const cols  = rows[0].length;
        const tuple = '(' + Array(cols).fill('?').join(',') + ')';
        sql    = sql.replace(/VALUES\s*\?\s*$/i, 'VALUES ' + rows.map(() => tuple).join(','));
        params = rows.flat();
    }

    return { sql, params };
}

// Re-shape better-sqlite3 errors to look like mysql2's, so routes that
// check `err.code === 'ER_DUP_ENTRY'` still work.
function remapError(err) {
    if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT_UNIQUE')) {
        err.code = 'ER_DUP_ENTRY';
    }
    return err;
}

function isSelect(sql) {
    return /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql);
}

// Core: run a single statement and return mysql2-style [rows, fields].
function runOne(sql, params) {
    ({ sql, params } = translate(sql, params || []));
    try {
        const stmt = sqlite.prepare(sql);
        if (isSelect(sql)) {
            return [stmt.all(...params), []];
        }
        const info = stmt.run(...params);
        return [{
            insertId:     info.lastInsertRowid,
            affectedRows: info.changes,
            changedRows:  info.changes,
        }, []];
    } catch (err) {
        throw remapError(err);
    }
}

// ── Public mysql2-shaped API ──────────────────────────────────
async function execute(sql, params = []) { return runOne(sql, params); }
async function query  (sql, params = []) { return runOne(sql, params); }

// Transactions: better-sqlite3 only exposes a sync transaction wrapper,
// but routes use the mysql2 explicit begin/commit/rollback pattern, so we
// emit raw BEGIN/COMMIT/ROLLBACK statements instead.
async function getConnection() {
    let active = false;
    return {
        async execute(sql, params = []) { return runOne(sql, params); },
        async query  (sql, params = []) { return runOne(sql, params); },
        async beginTransaction() { if (!active) { sqlite.exec('BEGIN');    active = true;  } },
        async commit()           { if (active)  { sqlite.exec('COMMIT');   active = false; } },
        async rollback()         { if (active)  { sqlite.exec('ROLLBACK'); active = false; } },
        release() { /* no pool — single shared SQLite connection */ },
    };
}

module.exports = { execute, query, getConnection, _raw: sqlite };

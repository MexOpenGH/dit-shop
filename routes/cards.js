const router = require('express').Router();
const path   = require('path');
const fs     = require('fs');
const multer = require('multer');
const db     = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// ── Image upload setup ───────────────────────────────────────
// Saves to frontend/img/uploads/ — already served as static by Express.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'frontend', 'img', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
        const ext = (path.extname(file.originalname) || '.png').toLowerCase();
        const safeExt = /^\.(jpe?g|png|gif|webp|svg)$/.test(ext) ? ext : '.png';
        cb(null, `card_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB max
    fileFilter: (_req, file, cb) =>
        /^image\//.test(file.mimetype)
            ? cb(null, true)
            : cb(new Error('Only image files are allowed.')),
});

const ALLOWED_CURRENCIES = ['USD', 'LAK', 'THB'];
const normCurrency = c => ALLOWED_CURRENCIES.includes(c) ? c : 'USD';

// ============================================================
// PUBLIC routes
// ============================================================

// GET /api/cards  — public storefront listing
router.get('/', async (req, res) => {
    try {
        const { category } = req.query;
        let sql = `
            SELECT gc.*, COUNT(gcc.id) AS stock_count
            FROM gift_cards gc
            LEFT JOIN gift_card_codes gcc
                   ON gcc.gift_card_id = gc.id AND gcc.status = 'available'
            WHERE gc.is_active = 1
        `;
        const params = [];
        if (category) { sql += ' AND gc.category = ?'; params.push(category); }
        sql += ' GROUP BY gc.id ORDER BY gc.created_at DESC';
        const [rows] = await db.execute(sql, params);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch gift cards.' });
    }
});

// GET /api/cards/:id  — single card detail
router.get('/:id(\\d+)', async (req, res) => {
    try {
        const [[card]] = await db.execute(
            `SELECT gc.*,
                    COUNT(gcc.id) AS stock_count
             FROM gift_cards gc
             LEFT JOIN gift_card_codes gcc
                    ON gcc.gift_card_id = gc.id AND gcc.status = 'available'
             WHERE gc.id = ? AND gc.is_active = 1
             GROUP BY gc.id`,
            [req.params.id]
        );
        if (!card) return res.status(404).json({ error: 'Card not found.' });
        res.json(card);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// ============================================================
// ADMIN routes
// ============================================================

// POST /api/cards/upload-image  — file upload, returns { url }
// Must be declared BEFORE the parametric /:id routes.
router.post('/upload-image',
    authenticate, requireAdmin,
    (req, res, next) => {
        upload.single('image')(req, res, err => {
            if (err) return res.status(400).json({ error: err.message });
            next();
        });
    },
    (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
        res.status(201).json({ url: `/img/uploads/${req.file.filename}` });
    }
);

// POST /api/cards  — create new card type
router.post('/', authenticate, requireAdmin, async (req, res) => {
    const { name, description, denomination, price, image_url, category, currency } = req.body;
    if (!name || !denomination || !price) {
        return res.status(422).json({ error: 'name, denomination, and price are required.' });
    }
    try {
        const [result] = await db.execute(
            `INSERT INTO gift_cards
               (name, description, denomination, price, currency, image_url, category)
             VALUES (?,?,?,?,?,?,?)`,
            [
                name,
                description || null,
                denomination,
                price,
                normCurrency(currency),
                image_url || null,
                category || null,
            ]
        );
        res.status(201).json({ id: result.insertId, message: 'Gift card created.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create gift card.' });
    }
});

// PUT /api/cards/:id  — update card
router.put('/:id(\\d+)', authenticate, requireAdmin, async (req, res) => {
    const fields = ['name','description','denomination','price','currency','image_url','category','is_active'];
    const updates = [], params = [];
    fields.forEach(f => {
        if (req.body[f] !== undefined) {
            const val = f === 'currency' ? normCurrency(req.body[f]) : req.body[f];
            updates.push(`${f}=?`);
            params.push(val);
        }
    });
    if (!updates.length) return res.status(422).json({ error: 'Nothing to update.' });
    params.push(req.params.id);
    try {
        await db.execute(`UPDATE gift_cards SET ${updates.join(',')} WHERE id=?`, params);
        res.json({ message: 'Gift card updated.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Update failed.' });
    }
});

// DELETE /api/cards/:id  — delete a card type, its codes AND its orders (admin)
// orders.gift_card_id is ON DELETE RESTRICT, so the card's orders must be
// removed first; codes then cascade with the card. Inbox messages that
// referenced those orders survive (order_id is SET NULL).
router.delete('/:id(\\d+)', authenticate, requireAdmin, async (req, res) => {
    try {
        const [[card]] = await db.execute(
            'SELECT id FROM gift_cards WHERE id=?',
            [req.params.id]
        );
        if (!card) return res.status(404).json({ error: 'Card not found.' });

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            await conn.execute('DELETE FROM orders WHERE gift_card_id=?', [req.params.id]);
            await conn.execute('DELETE FROM gift_cards WHERE id=?', [req.params.id]);
            await conn.commit();
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }

        res.json({ message: 'Gift card deleted.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete gift card.' });
    }
});

// POST /api/cards/:id/codes  — add codes to stock
router.post('/:id(\\d+)/codes', authenticate, requireAdmin, async (req, res) => {
    const { codes } = req.body; // array of strings
    if (!Array.isArray(codes) || !codes.length) {
        return res.status(422).json({ error: 'Provide a non-empty array of codes.' });
    }
    try {
        const values = codes.map(c => [req.params.id, c.trim(), req.user.id]);
        await db.query(
            'INSERT IGNORE INTO gift_card_codes (gift_card_id, code, added_by) VALUES ?',
            [values]
        );
        res.status(201).json({ message: `${codes.length} code(s) added.` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to add codes.' });
    }
});

// GET /api/cards/:id/codes  — list codes for a card (admin)
router.get('/:id(\\d+)/codes', authenticate, requireAdmin, async (req, res) => {
    try {
        const [rows] = await db.execute(
            'SELECT id,code,status,created_at FROM gift_card_codes WHERE gift_card_id=? ORDER BY id DESC',
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// PUT /api/cards/:cardId/codes/:codeId  — edit a code's value (admin)
// Used codes are immutable (already delivered to a customer).
router.put('/:id(\\d+)/codes/:codeId(\\d+)', authenticate, requireAdmin, async (req, res) => {
    const newCode = (req.body.code || '').toString().trim();
    if (!newCode) return res.status(422).json({ error: 'Code value is required.' });

    try {
        const [[existing]] = await db.execute(
            'SELECT id, status FROM gift_card_codes WHERE id=? AND gift_card_id=?',
            [req.params.codeId, req.params.id]
        );
        if (!existing) return res.status(404).json({ error: 'Code not found.' });
        if (existing.status === 'used') {
            return res.status(409).json({ error: 'Cannot edit a code that has already been delivered.' });
        }

        await db.execute(
            'UPDATE gift_card_codes SET code=? WHERE id=?',
            [newCode, req.params.codeId]
        );
        res.json({ message: 'Code updated.' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'That code already exists in stock.' });
        }
        console.error(err);
        res.status(500).json({ error: 'Failed to update code.' });
    }
});

// DELETE /api/cards/:cardId/codes/:codeId  — remove a code from stock (admin)
// Used codes can't be deleted to preserve order history.
router.delete('/:id(\\d+)/codes/:codeId(\\d+)', authenticate, requireAdmin, async (req, res) => {
    try {
        const [[existing]] = await db.execute(
            'SELECT id, status FROM gift_card_codes WHERE id=? AND gift_card_id=?',
            [req.params.codeId, req.params.id]
        );
        if (!existing) return res.status(404).json({ error: 'Code not found.' });
        if (existing.status === 'used') {
            return res.status(409).json({ error: 'Cannot delete a code that has already been delivered.' });
        }

        await db.execute('DELETE FROM gift_card_codes WHERE id=?', [req.params.codeId]);
        res.json({ message: 'Code deleted.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete code.' });
    }
});

module.exports = router;

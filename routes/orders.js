const router = require('express').Router();
const path   = require('path');
const fs     = require('fs');
const multer = require('multer');
const db     = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Server-side currency formatter — mirrors the frontend helper.
const CURRENCY_SYMBOL = { USD: '$', LAK: '₭', THB: '฿' };
const fmtPrice = (amount, code = 'USD') =>
    `${CURRENCY_SYMBOL[code] || '$'}${parseFloat(amount).toFixed(2)}`;

// ── Payment-proof upload setup ───────────────────────────────
const PROOF_DIR = path.join(__dirname, '..', '..', 'frontend', 'img', 'uploads', 'proofs');
fs.mkdirSync(PROOF_DIR, { recursive: true });

const proofStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PROOF_DIR),
    filename: (_req, file, cb) => {
        const ext = (path.extname(file.originalname) || '.png').toLowerCase();
        const safeExt = /^\.(jpe?g|png|gif|webp)$/.test(ext) ? ext : '.png';
        cb(null, `proof_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`);
    },
});

const proofUpload = multer({
    storage: proofStorage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
    fileFilter: (_req, file, cb) =>
        /^image\//.test(file.mimetype)
            ? cb(null, true)
            : cb(new Error('Only image files are allowed.')),
});

// POST /api/orders/upload-proof  — buyer uploads a payment receipt
// Returns { url } that the caller then sends with POST /api/orders.
router.post('/upload-proof',
    authenticate,
    (req, res, next) => {
        proofUpload.single('proof')(req, res, err => {
            if (err) return res.status(400).json({ error: err.message });
            next();
        });
    },
    (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
        res.status(201).json({ url: `/img/uploads/proofs/${req.file.filename}` });
    }
);

// POST /api/orders  — place an order
router.post('/', authenticate, async (req, res) => {
    // Quantity is fixed at 1 per order now (UI no longer asks).
    const { gift_card_id, payment_ref, payment_proof_url, notes } = req.body;
    const quantity = 1;
    if (!gift_card_id)         return res.status(422).json({ error: 'gift_card_id is required.' });
    if (!payment_proof_url)    return res.status(422).json({ error: 'A payment receipt photo is required.' });

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // verify card exists and has enough stock
        const [[card]] = await conn.execute(
            'SELECT * FROM gift_cards WHERE id=? AND is_active=1', [gift_card_id]
        );
        if (!card) { await conn.rollback(); return res.status(404).json({ error: 'Gift card not found.' }); }

        const [[{ cnt }]] = await conn.execute(
            "SELECT COUNT(*) AS cnt FROM gift_card_codes WHERE gift_card_id=? AND status='available'",
            [gift_card_id]
        );
        if (cnt < quantity) {
            await conn.rollback();
            return res.status(409).json({ error: 'Not enough stock available.' });
        }

        const total_price = parseFloat(card.price) * quantity;
        const [result] = await conn.execute(
            `INSERT INTO orders
               (user_id, gift_card_id, quantity, total_price, payment_ref, payment_proof_url, notes)
             VALUES (?,?,?,?,?,?,?)`,
            [req.user.id, gift_card_id, quantity, total_price,
             payment_ref || null, payment_proof_url, notes || null]
        );

        // Welcome inbox message
        await conn.execute(
            `INSERT INTO inbox_messages (user_id,order_id,subject,body) VALUES (?,?,?,?)`,
            [
                req.user.id, result.insertId,
                `Order #${result.insertId} Received`,
                `Hi ${req.user.username}, we've received your order for "${card.name}".\nTotal: ${fmtPrice(total_price, card.currency)}.\nWe will verify your payment and deliver your gift card code shortly!`
            ]
        );

        await conn.commit();
        res.status(201).json({ id: result.insertId, message: 'Order placed successfully.', total_price });
    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.status(500).json({ error: 'Failed to place order.' });
    } finally {
        conn.release();
    }
});

// GET /api/orders  — user's own orders (or all orders for admin)
router.get('/', authenticate, async (req, res) => {
    try {
        let sql, params;
        if (req.user.role === 'admin') {
            sql = `
                SELECT o.*, u.username, u.email,
                       gc.name AS card_name, gc.denomination, gc.currency
                FROM orders o
                JOIN users u ON u.id = o.user_id
                JOIN gift_cards gc ON gc.id = o.gift_card_id
                ORDER BY o.created_at DESC
            `;
            params = [];
        } else {
            sql = `
                SELECT o.*, gc.name AS card_name, gc.denomination, gc.currency, gc.image_url
                FROM orders o
                JOIN gift_cards gc ON gc.id = o.gift_card_id
                WHERE o.user_id = ?
                ORDER BY o.created_at DESC
            `;
            params = [req.user.id];
        }
        const [rows] = await db.execute(sql, params);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch orders.' });
    }
});

// GET /api/orders/:id
router.get('/:id', authenticate, async (req, res) => {
    try {
        const [[order]] = await db.execute(
            `SELECT o.*, gc.name AS card_name, gc.denomination, gc.currency, gc.image_url
             FROM orders o
             JOIN gift_cards gc ON gc.id = o.gift_card_id
             WHERE o.id = ?`, [req.params.id]
        );
        if (!order) return res.status(404).json({ error: 'Order not found.' });
        if (req.user.role !== 'admin' && order.user_id !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden.' });
        }
        res.json(order);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// POST /api/orders/:id/confirm  — admin confirms and assigns a code
router.post('/:id/confirm', authenticate, requireAdmin, async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [[order]] = await conn.execute(
            'SELECT * FROM orders WHERE id=?', [req.params.id]
        );
        if (!order) { await conn.rollback(); return res.status(404).json({ error: 'Order not found.' }); }
        if (order.status !== 'pending') {
            await conn.rollback();
            return res.status(409).json({ error: `Order is already ${order.status}.` });
        }

        // Pick an available code for this card
        const [[code]] = await conn.execute(
            "SELECT * FROM gift_card_codes WHERE gift_card_id=? AND status='available' LIMIT 1 FOR UPDATE",
            [order.gift_card_id]
        );
        if (!code) {
            await conn.rollback();
            return res.status(409).json({ error: 'No available codes in stock for this card.' });
        }

        // Mark code as used
        await conn.execute("UPDATE gift_card_codes SET status='used' WHERE id=?", [code.id]);

        // Update order
        await conn.execute(
            `UPDATE orders SET status='delivered', code_id=?, confirmed_by=?, confirmed_at=NOW() WHERE id=?`,
            [code.id, req.user.id, order.id]
        );

        // Fetch buyer info & card name for message
        const [[user]] = await conn.execute('SELECT username FROM users WHERE id=?', [order.user_id]);
        const [[card]] = await conn.execute('SELECT name FROM gift_cards WHERE id=?', [order.gift_card_id]);

        // Send code to user inbox
        await conn.execute(
            `INSERT INTO inbox_messages (user_id, order_id, subject, body) VALUES (?,?,?,?)`,
            [
                order.user_id, order.id,
                `Your Gift Card Code for Order #${order.id}`,
                `Hi ${user.username},\n\nYour order has been confirmed!\n\nGift Card: ${card.name}\nYour Code: ${code.code}\n\nThank you for shopping at Dit Shop! Enjoy your gift card.`
            ]
        );

        await conn.commit();
        res.json({ message: 'Order confirmed and code delivered to user inbox.', code: code.code });
    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.status(500).json({ error: 'Failed to confirm order.' });
    } finally {
        conn.release();
    }
});

// POST /api/orders/:id/cancel  — cancel (user or admin)
router.post('/:id/cancel', authenticate, async (req, res) => {
    try {
        const [[order]] = await db.execute('SELECT * FROM orders WHERE id=?', [req.params.id]);
        if (!order) return res.status(404).json({ error: 'Order not found.' });
        if (req.user.role !== 'admin' && order.user_id !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden.' });
        }
        if (order.status !== 'pending') {
            return res.status(409).json({ error: `Cannot cancel an order that is ${order.status}.` });
        }
        await db.execute("UPDATE orders SET status='cancelled' WHERE id=?", [order.id]);
        res.json({ message: 'Order cancelled.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;

const router = require('express').Router();
const db     = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// All admin routes require auth + admin role
router.use(authenticate, requireAdmin);

// GET /api/admin/stats  — dashboard overview numbers
router.get('/stats', async (req, res) => {
    try {
        const [[{ total_users }]]   = await db.execute("SELECT COUNT(*) AS total_users FROM users WHERE role='user'");
        const [[{ total_orders }]]  = await db.execute('SELECT COUNT(*) AS total_orders FROM orders');
        const [[{ pending }]]       = await db.execute("SELECT COUNT(*) AS pending FROM orders WHERE status='pending'");
        const [[{ total_stock }]]   = await db.execute("SELECT COUNT(*) AS total_stock FROM gift_card_codes WHERE status='available'");
        const [[{ revenue }]]       = await db.execute("SELECT COALESCE(SUM(total_price),0) AS revenue FROM orders WHERE status='delivered'");
        res.json({ total_users, total_orders, pending, total_stock, revenue });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch stats.' });
    }
});

// GET /api/admin/users  — list all users
router.get('/users', async (req, res) => {
    try {
        const [rows] = await db.execute(
            'SELECT id,username,email,full_name,role,created_at FROM users ORDER BY created_at DESC'
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// GET /api/admin/stock  — all card types with their available code counts
router.get('/stock', async (req, res) => {
    try {
        const [rows] = await db.execute(`
            SELECT gc.*,
                   SUM(CASE WHEN gcc.status='available' THEN 1 ELSE 0 END) AS available,
                   SUM(CASE WHEN gcc.status='used'      THEN 1 ELSE 0 END) AS used_count,
                   COUNT(gcc.id) AS total_codes
            FROM gift_cards gc
            LEFT JOIN gift_card_codes gcc ON gcc.gift_card_id = gc.id
            GROUP BY gc.id
            ORDER BY gc.id
        `);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// GET /api/admin/orders  — all orders with user + card details (alias kept for admin dashboard)
router.get('/orders', async (req, res) => {
    try {
        const { status } = req.query;
        let sql = `
            SELECT o.*, u.username, u.email,
                   gc.name AS card_name, gc.denomination, gc.currency,
                   gcc.code AS assigned_code
            FROM orders o
            JOIN users u ON u.id = o.user_id
            JOIN gift_cards gc ON gc.id = o.gift_card_id
            LEFT JOIN gift_card_codes gcc ON gcc.id = o.code_id
        `;
        const params = [];
        if (status) { sql += ' WHERE o.status=?'; params.push(status); }
        sql += ' ORDER BY o.created_at DESC';
        const [rows] = await db.execute(sql, params);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// GET /api/admin/messages  — all HELP messages from users (grouped, newest first)
router.get('/messages', async (req, res) => {
    try {
        // Each user submission was fanned out to every admin row, so DISTINCT by
        // (from_user_id, subject, body, created_at) to collapse duplicates.
        const [rows] = await db.execute(`
            SELECT  im.id,
                    im.from_user_id,
                    im.subject,
                    im.body,
                    im.image_url,
                    im.is_read,
                    im.created_at,
                    u.username,
                    u.email,
                    u.full_name
            FROM inbox_messages im
            JOIN users u ON u.id = im.from_user_id
            WHERE im.is_help = 1
              AND im.user_id = ?
            ORDER BY im.created_at DESC
        `, [req.user.id]);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch messages.' });
    }
});

// GET /api/admin/messages/unread-count  — pending help messages for this admin
router.get('/messages/unread-count', async (req, res) => {
    try {
        const [[{ count }]] = await db.execute(
            `SELECT COUNT(*) AS count
             FROM inbox_messages
             WHERE is_help=1 AND is_read=0 AND user_id=?`,
            [req.user.id]
        );
        res.json({ count });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// PATCH /api/admin/messages/:id/read  — mark a help message as read
router.patch('/messages/:id/read', async (req, res) => {
    try {
        const [[msg]] = await db.execute(
            'SELECT user_id, is_help FROM inbox_messages WHERE id=?', [req.params.id]
        );
        if (!msg || !msg.is_help) return res.status(404).json({ error: 'Message not found.' });
        if (msg.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden.' });
        await db.execute('UPDATE inbox_messages SET is_read=1 WHERE id=?', [req.params.id]);
        res.json({ message: 'Marked as read.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// POST /api/admin/messages/:id/reply  — admin replies; lands in target user's inbox
router.post('/messages/:id/reply', async (req, res) => {
    try {
        const subject     = (req.body.subject    || '').trim();
        const body        = (req.body.body       || '').trim();
        const rawAttach   = req.body.attachments;
        const legacyUrl   = (req.body.image_url  || '').trim() || null;
        const attachments = Array.isArray(rawAttach)
            ? rawAttach.filter(Boolean)
            : (legacyUrl ? [legacyUrl] : []);
        const image_url   = attachments.length ? JSON.stringify(attachments) : null;
        if (!subject || !body) {
            return res.status(400).json({ error: 'Subject and reply body are required.' });
        }
        if (subject.length > 200 || body.length > 4000) {
            return res.status(400).json({ error: 'Subject or body too long.' });
        }

        const [[original]] = await db.execute(
            `SELECT id, from_user_id, is_help
             FROM inbox_messages WHERE id=?`,
            [req.params.id]
        );
        if (!original || !original.is_help || !original.from_user_id) {
            return res.status(404).json({ error: 'Original help message not found.' });
        }

        const adminName = req.user.username || 'Support';
        await db.execute(
            `INSERT INTO inbox_messages
                (user_id, from_user_id, sender, subject, body, image_url, parent_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [original.from_user_id, req.user.id, adminName, subject, body, image_url, original.id]
        );

        // Mark the original help message as read since we've handled it.
        await db.execute('UPDATE inbox_messages SET is_read=1 WHERE id=?', [original.id]);

        res.status(201).json({ message: 'Reply sent.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to send reply.' });
    }
});

// DELETE /api/admin/messages/:id  — dismiss a help thread from admin's view
router.delete('/messages/:id', async (req, res) => {
    try {
        const [[msg]] = await db.execute(
            'SELECT user_id, is_help FROM inbox_messages WHERE id=?', [req.params.id]
        );
        if (!msg || !msg.is_help) return res.status(404).json({ error: 'Message not found.' });
        if (msg.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden.' });
        await db.execute('DELETE FROM inbox_messages WHERE id=?', [req.params.id]);
        res.json({ message: 'Message dismissed.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;

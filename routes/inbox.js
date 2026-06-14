const router = require('express').Router();
const path   = require('path');
const fs     = require('fs');
const multer = require('multer');
const db     = require('../config/db');
const { authenticate } = require('../middleware/auth');

// ── Message-image upload setup ────────────────────────────────
const MSG_IMG_DIR = path.join(__dirname, '..', '..', 'frontend', 'img', 'uploads', 'messages');
fs.mkdirSync(MSG_IMG_DIR, { recursive: true });

const msgImgStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MSG_IMG_DIR),
    filename: (_req, file, cb) => {
        const ext = (path.extname(file.originalname) || '.png').toLowerCase();
        const safeExt = /^\.(jpe?g|png|gif|webp)$/.test(ext) ? ext : '.png';
        cb(null, `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`);
    },
});
const msgImgUpload = multer({
    storage: msgImgStorage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) =>
        /^(image|video)\//.test(file.mimetype)
            ? cb(null, true)
            : cb(new Error('Only image and video files are allowed.')),
});

// POST /api/inbox/upload-image  — shared by user + admin, returns { url }
router.post('/upload-image', authenticate, (req, res, next) => {
    msgImgUpload.single('image')(req, res, err => {
        if (err) return res.status(400).json({ error: err.message });
        next();
    });
}, (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    res.status(201).json({ url: `/img/uploads/messages/${req.file.filename}` });
});

// GET /api/inbox  — user's messages (excludes their own help requests)
router.get('/', authenticate, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT id, order_id, sender, subject, body, image_url, is_read, created_at, parent_id
             FROM inbox_messages
             WHERE user_id=? AND is_help=0
             ORDER BY created_at DESC`,
            [req.user.id]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch inbox.' });
    }
});

// GET /api/inbox/unread-count
router.get('/unread-count', authenticate, async (req, res) => {
    try {
        const [[{ count }]] = await db.execute(
            'SELECT COUNT(*) AS count FROM inbox_messages WHERE user_id=? AND is_help=0 AND is_read=0',
            [req.user.id]
        );
        res.json({ count });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// POST /api/inbox/help  — user sends a HELP message to admin
router.post('/help', authenticate, async (req, res) => {
    try {
        const subject     = (req.body.subject    || '').trim();
        const body        = (req.body.body       || '').trim();
        // Accept either new attachments[] array or legacy single image_url
        const rawAttach   = req.body.attachments;
        const legacyUrl   = (req.body.image_url  || '').trim() || null;
        const attachments = Array.isArray(rawAttach)
            ? rawAttach.filter(Boolean)
            : (legacyUrl ? [legacyUrl] : []);
        const image_url   = attachments.length ? JSON.stringify(attachments) : null;
        if (!subject || !body) {
            return res.status(400).json({ error: 'Subject and message are required.' });
        }
        if (subject.length > 200) {
            return res.status(400).json({ error: 'Subject is too long (max 200 chars).' });
        }
        if (body.length > 4000) {
            return res.status(400).json({ error: 'Message is too long (max 4000 chars).' });
        }

        // Deliver one HELP row to every admin's inbox so any admin can pick it up.
        const [admins] = await db.execute("SELECT id FROM users WHERE role='admin'");
        if (!admins.length) {
            return res.status(503).json({ error: 'No admin available right now.' });
        }

        const senderName = req.user.username || `User #${req.user.id}`;
        for (const a of admins) {
            await db.execute(
                `INSERT INTO inbox_messages
                    (user_id, from_user_id, sender, subject, body, image_url, is_help)
                 VALUES (?,?,?,?,?,?,1)`,
                [a.id, req.user.id, senderName, subject, body, image_url]
            );
        }

        res.status(201).json({ message: 'Your message was sent to support.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to send help message.' });
    }
});

// GET /api/inbox/sent  — user's own outgoing HELP messages (so they can see what they sent)
router.get('/sent', authenticate, async (req, res) => {
    try {
        // Each help submission was fanned out once per admin — collapse by created_at+subject+body.
        const [rows] = await db.execute(
            `SELECT MIN(id) AS id, subject, body, image_url, MIN(created_at) AS created_at
             FROM inbox_messages
             WHERE from_user_id=? AND is_help=1
             GROUP BY subject, body, image_url, created_at
             ORDER BY created_at DESC`,
            [req.user.id]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// PATCH /api/inbox/read-all  — mark all of recipient's normal messages as read
router.patch('/read-all', authenticate, async (req, res) => {
    try {
        await db.execute(
            'UPDATE inbox_messages SET is_read=1 WHERE user_id=? AND is_help=0',
            [req.user.id]
        );
        res.json({ message: 'All messages marked as read.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// PATCH /api/inbox/:id/read  — mark single message as read
router.patch('/:id/read', authenticate, async (req, res) => {
    try {
        const [[msg]] = await db.execute(
            'SELECT user_id FROM inbox_messages WHERE id=?', [req.params.id]
        );
        if (!msg) return res.status(404).json({ error: 'Message not found.' });
        if (msg.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden.' });
        await db.execute('UPDATE inbox_messages SET is_read=1 WHERE id=?', [req.params.id]);
        res.json({ message: 'Marked as read.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// DELETE /api/inbox/:id
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const [[msg]] = await db.execute(
            'SELECT user_id FROM inbox_messages WHERE id=?', [req.params.id]
        );
        if (!msg) return res.status(404).json({ error: 'Message not found.' });
        if (msg.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden.' });
        await db.execute('DELETE FROM inbox_messages WHERE id=?', [req.params.id]);
        res.json({ message: 'Message deleted.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;

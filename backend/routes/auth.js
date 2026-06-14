const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db      = require('../config/db');
const { authenticate } = require('../middleware/auth');

// POST /api/auth/register
router.post('/register', [
    body('username').trim().isLength({ min: 3, max: 50 }).matches(/^\w+$/),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('full_name').optional().trim().isLength({ max: 100 }),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { username, email, password, full_name } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        const [result] = await db.execute(
            'INSERT INTO users (username,email,password,full_name) VALUES (?,?,?,?)',
            [username, email, hash, full_name || null]
        );
        const token = jwt.sign(
            { id: result.insertId, username, role: 'user' },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );
        res.status(201).json({ token, user: { id: result.insertId, username, email, role: 'user' } });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Username or email already taken.' });
        }
        console.error(err);
        res.status(500).json({ error: 'Registration failed.' });
    }
});

// POST /api/auth/login
router.post('/login', [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { email, password } = req.body;
    try {
        const [[user]] = await db.execute(
            'SELECT id,username,email,password,full_name,role FROM users WHERE email=?',
            [email]
        );
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );
        const { password: _, ...safeUser } = user;
        res.json({ token, user: safeUser });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Login failed.' });
    }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
    try {
        const [[user]] = await db.execute(
            'SELECT id,username,email,full_name,role,avatar_url,created_at FROM users WHERE id=?',
            [req.user.id]
        );
        if (!user) return res.status(404).json({ error: 'User not found.' });
        res.json(user);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;

/**
 * Admin auth routes:
 *   POST /admin/login  - autentikasi user
 *   POST /admin/logout - keluar
 *   GET  /admin/me     - info user aktif (JSON)
 *
 * Halaman admin (login, dashboard, editor) di-serve sebagai file statis
 * dari public/admin/*.html.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { getDb } = require('../db/db');
const { requireApiAuth } = require('../middleware/auth');

const router = express.Router();

// Rate limit khusus untuk login: 5 percobaan per 15 menit
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' },
  standardHeaders: true,
});

// POST /admin/login
router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Username atau password salah' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;

  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

  res.json({
    ok: true,
    user: { id: user.id, username: user.username, role: user.role },
  });
});

// POST /admin/logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Gagal logout' });
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// GET /admin/me
router.get('/me', requireApiAuth, (req, res) => {
  res.json({
    id: req.session.userId,
    username: req.session.username,
    role: req.session.role,
  });
});

// POST /admin/change-password
router.post('/change-password', requireApiAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'oldPassword & newPassword wajib' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !bcrypt.compareSync(oldPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Password lama salah' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);
  res.json({ ok: true });
});

module.exports = router;

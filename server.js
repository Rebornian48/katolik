/**
 * Peta Paroki - Server v2 (dengan SQLite + Admin CRUD + Radius Search)
 */

const express = require('express');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const Database = require('better-sqlite3');

const { getDb, initSchema, DB_PATH } = require('./db/db');
const apiRouter = require('./routes/api');
const adminRouter = require('./routes/admin');
const { requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// ---------- Init DB ----------
initSchema();
const db = getDb();
console.log(`[server] DB terhubung: ${DB_PATH}`);

// Database baru (mis. setelah deploy) masih kosong: buat admin & muat data awal
if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  console.log('[server] Belum ada user, menjalankan db/init...');
  require('./db/init');
}
if (db.prepare('SELECT COUNT(*) AS n FROM locations').get().n === 0) {
  console.log('[server] Tabel locations kosong, menjalankan db/seed...');
  require('./db/seed');
}

// ---------- Setup ----------
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ---------- Middleware ----------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https://*.tile.openstreetmap.org',
          'https://tile.openstreetmap.org',
          'https://*.basemaps.cartocdn.com',
          'https://server.arcgisonline.com',
        ],
        connectSrc: ["'self'", 'https://nominatim.openstreetmap.org'],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ---------- Session (menggunakan SQLite untuk store) ----------
// Session store SQLite butuh instance Database sendiri (bukan getDb kita).
const sessionDb = new Database(DB_PATH);
app.use(
  session({
    store: new SqliteStore({
      client: sessionDb,
      expired: {
        clear: true,
        intervalMs: 15 * 60 * 1000,
      },
    }),
    secret: process.env.SESSION_SECRET || 'peta-paroki-secret-CHANGE-ME',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 1 hari
    },
  }),
);

// ---------- Routes ----------
app.use('/api', apiRouter);
app.use('/admin', adminRouter);

// Halaman admin
// Login page — bebas akses
app.get('/admin/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html'));
});
// Dashboard & editor — butuh login
app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});
app.get('/admin/edit/:id?', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'edit.html'));
});

// Health check
app.get('/health', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS n FROM locations WHERE is_active = 1').get().n;
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    locations: total,
  });
});

// ---------- Static Files ----------
const staticOptions = {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
};
app.use(express.static(path.join(__dirname, 'public'), staticOptions));

// ---------- Fallback ----------
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/')) {
    return res.status(404).json({ error: 'Endpoint tidak ditemukan' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- Error handler ----------
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Terjadi kesalahan pada server' });
});

// ---------- Start ----------
app.listen(PORT, HOST, () => {
  console.log('===============================================');
  console.log('  Peta Paroki v2.0 - Server berjalan');
  console.log('  URL:   http://' + HOST + ':' + PORT);
  console.log('  Env:   ' + (process.env.NODE_ENV || 'development'));
  console.log('  Admin: http://' + HOST + ':' + PORT + '/admin');
  console.log('===============================================');
});

process.on('SIGTERM', () => {
  console.log('SIGTERM diterima, shutting down...');
  sessionDb.close();
  process.exit(0);
});

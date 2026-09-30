/**
 * Inisialisasi database & user admin default.
 * Jalankan dengan: npm run db:init
 * Reset total: npm run db:init -- --reset
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { getDb, initSchema, DB_PATH } = require('./db');

const RESET = process.argv.includes('--reset');

if (RESET && fs.existsSync(DB_PATH)) {
  console.log(`[init] Menghapus database lama: ${DB_PATH}`);
  fs.unlinkSync(DB_PATH);
  // hapus juga -wal dan -shm bila ada
  for (const ext of ['-wal', '-shm']) {
    const p = DB_PATH + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

console.log(`[init] Database path: ${DB_PATH}`);
initSchema();
console.log(`[init] Schema berhasil dibuat`);

const db = getDb();

// Buat user admin default
const DEFAULT_USER = process.env.ADMIN_USER || 'admin';
const DEFAULT_PASS = process.env.ADMIN_PASS || 'admin123';

const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(DEFAULT_USER);
if (!existingUser) {
  const hash = bcrypt.hashSync(DEFAULT_PASS, 10);
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
    DEFAULT_USER,
    hash,
    'admin',
  );
  console.log(`[init] User admin dibuat:`);
  console.log(`         username: ${DEFAULT_USER}`);
  console.log(`         password: ${DEFAULT_PASS}`);
  console.log(`         SEGERA UBAH PASSWORD SETELAH LOGIN PERTAMA!`);
} else {
  console.log(`[init] User admin sudah ada: ${DEFAULT_USER}`);
}

// Info jumlah lokasi
const count = db.prepare('SELECT COUNT(*) AS n FROM locations').get().n;
console.log(`[init] Total lokasi tersimpan: ${count}`);

if (count === 0) {
  console.log(`[init] Tips: jalankan 'npm run db:seed' untuk memuat data awal.`);
}

console.log(`[init] Selesai.`);

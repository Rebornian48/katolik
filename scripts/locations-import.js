/**
 * Import lokasi dari file JSON (hasil scripts/locations-export.js) ke database
 * di DB_PATH. Hanya tabel `locations` yang disentuh; user, password admin, dan
 * session tetap utuh. Aman dijalankan saat website sedang berjalan.
 *
 * Deteksi duplikat sama dengan scraper (lihat upsertLocation): lokasi yang sudah
 * ada hanya diisi field yang masih kosong, sehingga edit dari admin tidak ditimpa.
 *
 * Jalankan: npm run locations:import -- path/ke/locations.json
 */

const fs = require('fs');
const { upsertLocation, db } = require('./lib/scraper-common');
const { DB_PATH } = require('../db/db');

const file = process.argv[2];
if (!file) {
  console.error('Pemakaian: npm run locations:import -- path/ke/locations.json');
  process.exit(1);
}

const rows = JSON.parse(fs.readFileSync(file, 'utf-8'));
console.log(`[import] Database: ${DB_PATH}`);
console.log(`[import] Memuat ${rows.length} lokasi dari ${file}...`);

const stats = { added: 0, existing: 0, skipped: 0 };
db.transaction(() => {
  for (const row of rows) {
    const r = upsertLocation(row);
    if (r.added) stats.added++;
    else if (r.updated) stats.existing++;
    else stats.skipped++;
  }
})();

const total = db.prepare('SELECT COUNT(*) AS n FROM locations WHERE is_active = 1').get().n;
console.log(`[import] Baru:        ${stats.added}`);
console.log(`[import] Sudah ada:   ${stats.existing} (hanya field kosong yang diisi)`);
console.log(`[import] Dilewati:    ${stats.skipped} (tanpa nama/koordinat)`);
console.log(`[import] Total lokasi aktif sekarang: ${total}`);

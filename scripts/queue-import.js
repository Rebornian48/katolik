/**
 * Masukkan daftar lokasi yang tidak ditemukan (scripts/output/*-tidak-ditemukan.json)
 * ke antrian admin (/admin/antrian), supaya titiknya bisa ditentukan manual.
 *
 * Gereja yang sama dari beberapa sumber digabung jadi satu entri, dan lokasi
 * yang sudah ada di peta dilewati. Aman dijalankan berulang kali.
 *
 * Jalankan: npm run queue:import
 *           npm run queue:import -- path/ke/file.json [file lain...]
 */

const fs = require('fs');
const path = require('path');
const { addToQueue, db } = require('./lib/scraper-common');
const { DB_PATH } = require('../db/db');

const OUTPUT = path.join(__dirname, 'output');
// Urutan default: sumber dengan data terlengkap (alamat + jadwal) lebih dulu
const DEFAULT_FILES = ['jadwalmisa.id', 'ekatolik.com', 'imankatolik.or.id']
  .map((s) => path.join(OUTPUT, `${s}-tidak-ditemukan.json`))
  .filter((f) => fs.existsSync(f));

const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES;
if (!files.length) {
  console.error('Tidak ada file. Pemakaian: npm run queue:import -- path/ke/file.json');
  process.exit(1);
}

console.log(`[antrian] Database: ${DB_PATH}`);
for (const file of files) {
  // File lama belum mencatat `source`; ambil dari nama file (jadwalmisa.id-tidak-ditemukan.json)
  const fallbackSource = path.basename(file).replace(/-tidak-ditemukan\.json$/, '');
  const rows = JSON.parse(fs.readFileSync(file, 'utf-8')).map((r) => ({ source: fallbackSource, ...r }));
  const s = addToQueue(rows);
  console.log(`[antrian] ${path.basename(file)}: ${rows.length} baris -> ${s.added} baru, ${s.merged} digabung, ${s.located} sudah ada di peta, ${s.skipped} dilewati`);
}

const count = (status) => db.prepare('SELECT COUNT(*) AS n FROM location_queue WHERE status = ?').get(status).n;
console.log(`[antrian] Menunggu: ${count('pending')}, selesai: ${count('done')}, dilewati: ${count('skipped')}`);

/**
 * Export semua lokasi aktif ke file JSON, untuk dipindahkan ke database lain
 * (mis. hasil scraping di lokal -> server) dengan scripts/locations-import.js.
 * Hanya tabel `locations` yang diekspor; user & session tidak ikut.
 *
 * Jalankan: npm run locations:export
 *           npm run locations:export -- path/ke/file.json
 */

const fs = require('fs');
const path = require('path');
const { getDb, initSchema, DB_PATH } = require('../db/db');

const outFile = process.argv[2] || path.join(__dirname, 'output', 'locations.json');

initSchema();
const rows = getDb()
  .prepare(`
    SELECT name, type, pastor, address, city, province, diocese, lat, lng,
           phone, email, website, misa, source, source_url
    FROM locations
    WHERE is_active = 1
    ORDER BY id
  `)
  .all();

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(rows, null, 2));

console.log(`[export] Database: ${DB_PATH}`);
console.log(`[export] ${rows.length} lokasi ditulis ke ${path.relative(process.cwd(), outFile)}`);

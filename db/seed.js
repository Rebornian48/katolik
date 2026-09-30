/**
 * Seeder database - memuat data awal ke SQLite.
 * Jalankan: npm run db:seed
 *
 * Data seed mencakup ~80 lokasi utama Katolik di seluruh Indonesia
 * (katedral tiap keuskupan, paroki-paroki utama di kota besar,
 *  ditambah 19 lokasi wilayah Semarang-Magelang-Temanggung).
 *
 * Jalankan dengan --force untuk mengganti data existing yang match by (name, lat, lng).
 */

const fs = require('fs');
const path = require('path');
const { getDb, initSchema } = require('./db');

const FORCE = process.argv.includes('--force');
const seedPath = path.join(__dirname, 'seed-data.json');
const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));

initSchema();
const db = getDb();

const insert = db.prepare(`
  INSERT INTO locations (
    name, type, pastor, address, city, province, diocese,
    lat, lng, phone, email, website, misa, source, is_active
  ) VALUES (
    @name, @type, @pastor, @address, @city, @province, @diocese,
    @lat, @lng, @phone, @email, @website, @misa, 'seed', 1
  )
`);

const findExisting = db.prepare(
  'SELECT id FROM locations WHERE name = ? AND ABS(lat - ?) < 0.001 AND ABS(lng - ?) < 0.001',
);

const update = db.prepare(`
  UPDATE locations SET
    type = @type,
    pastor = @pastor,
    address = @address,
    city = @city,
    province = @province,
    diocese = @diocese,
    phone = @phone,
    email = @email,
    website = @website,
    misa = @misa,
    is_active = 1
  WHERE id = @id
`);

const NORM = (v) => (v == null || v === '' ? null : String(v));
const normalize = (r) => ({
  name: NORM(r.name),
  type: NORM(r.type) || 'Paroki',
  pastor: NORM(r.pastor),
  address: NORM(r.address),
  city: NORM(r.city),
  province: NORM(r.province),
  diocese: NORM(r.diocese),
  lat: parseFloat(r.lat),
  lng: parseFloat(r.lng),
  phone: NORM(r.phone),
  email: NORM(r.email),
  website: NORM(r.website),
  misa: NORM(r.misa),
});

let added = 0;
let updated = 0;
let skipped = 0;

const tx = db.transaction((rows) => {
  for (const raw of rows) {
    const row = normalize(raw);
    if (!row.name || isNaN(row.lat) || isNaN(row.lng)) {
      skipped++;
      continue;
    }
    const existing = findExisting.get(row.name, row.lat, row.lng);
    if (existing) {
      if (FORCE) {
        update.run({ ...row, id: existing.id });
        updated++;
      } else {
        skipped++;
      }
    } else {
      insert.run(row);
      added++;
    }
  }
});

console.log(`[seed] Memuat ${seedData.length} record...`);
tx(seedData);

const totalNow = db.prepare('SELECT COUNT(*) AS n FROM locations').get().n;
console.log(`[seed] Ditambahkan: ${added}`);
console.log(`[seed] Diupdate:    ${updated}`);
console.log(`[seed] Dilewati:    ${skipped}`);
console.log(`[seed] Total lokasi di DB: ${totalNow}`);
console.log(`[seed] Selesai.`);

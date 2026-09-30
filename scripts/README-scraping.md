# Scraping Data Paroki - Panduan

Tiga skrip scraper disediakan untuk menambahkan data dari sumber publik:

- `scrape-jadwalmisa.js` — https://jadwalmisa.id
- `scrape-ekatolik.js`  — https://ekatolik.com/jadwal-misa
- `scrape-imankatolik.js` — https://www.imankatolik.or.id/jadwalmisa.html

## ⚠️ Penting Dibaca Dulu

**Selector di skrip adalah placeholder umum.** Struktur HTML setiap situs berbeda dan bisa berubah kapan saja. Sebelum menjalankan, Anda perlu:

1. Buka situs sumber di browser
2. Right-click → Inspect
3. Cari nama paroki, alamat, jadwal misa, lalu catat CSS selector-nya
4. Buka file `scripts/scrape-*.js` yang bersangkutan
5. Ganti selector di bagian yang ditandai `// TODO:`

Contoh — dari file `scrape-jadwalmisa.js`:
```javascript
// TODO: sesuaikan selector berikut dengan struktur asli jadwalmisa.id
$('a[href*="/paroki/"]').each((_, el) => { ... });
```
Ganti `'a[href*="/paroki/"]'` dengan selector yang benar setelah Anda inspect.

## Etika Scraping

- **Rate limit:** skrip default sleep 1.2-1.5 detik per request. Jangan turunkan.
- **User-Agent:** sudah di-set ke `peta-paroki-scraper/2.0`. Ganti email di dalamnya biar admin situs sumber bisa kontak Anda kalau ada masalah.
- **Robots.txt:** cek dulu `https://situs/robots.txt` — hormati aturannya.
- **Cache:** skrip menyimpan hasil ke DB SQLite lokal. Tidak perlu re-scrape berulang kalau data belum berubah.
- **Attribusi:** setiap record dari scraper diberi field `source` dan `source_url` — jangan hapus ini.

## Jalan Percobaan (Dry Run)

Untuk uji dulu dengan sedikit data, pakai flag `--limit=N`:

```bash
node scripts/scrape-jadwalmisa.js --limit=5
```

Jika hasil di DB masuk akal (nama, alamat, koordinat terisi), baru jalankan penuh.

## Menjalankan Semua

```bash
# Sequential (aman)
node scripts/scrape-jadwalmisa.js
node scripts/scrape-ekatolik.js
node scripts/scrape-imankatolik.js
```

**Estimasi waktu:** Untuk ~1000 paroki x 3 detik/paroki (fetch + geocode) ≈ 50 menit.
Untuk seluruh Indonesia (~3000+ paroki) ≈ 3 jam. Jalankan di server yang stabil.

## Cara Kerja

Setiap scraper:

1. **Fetch daftar** paroki dari halaman index
2. **Fetch detail** setiap paroki (nama, alamat, jadwal misa)
3. **Geocode** alamat ke koordinat lat/lng via **Nominatim** (OpenStreetMap gratis, rate-limit 1 req/detik)
4. **Upsert** ke tabel `locations` SQLite

Skrip mendeteksi duplikat berdasarkan:
- Nama sama + koordinat dekat (< ~500m), atau
- `source_url` yang sama

Jika duplikat, field yang **NULL di DB** akan diisi dari data baru (via `COALESCE`), tidak menimpa data yang sudah ada.

## Log Audit

Setiap run tersimpan di tabel `scrape_logs`:

```sql
SELECT source, records_added, records_updated, status, error_message
FROM scrape_logs
ORDER BY id DESC LIMIT 5;
```

## Kalau Selector Rumit

Beberapa situs pakai JavaScript berat / API internal. Untuk kasus itu:

**Opsi A: Pakai Puppeteer** (headless browser)
```bash
npm install puppeteer
```
Kemudian ganti `fetchText()` dengan `page.evaluate()` di scraper.

**Opsi B: Cari endpoint API internal**
Buka DevTools → Network → cari request JSON. Kalau ada, langsung fetch endpoint itu (tanpa parsing HTML).

**Opsi C: Impor CSV/JSON manual**
Kalau Anda punya file CSV/JSON dari sumber lain:
```bash
node -e "
const fs = require('fs');
const {getDb, initSchema} = require('./db/db');
initSchema();
const rows = JSON.parse(fs.readFileSync('paroki.json', 'utf-8'));
const db = getDb();
const stmt = db.prepare(\`
  INSERT INTO locations (name, type, lat, lng, address, city, province, diocese, misa, source)
  VALUES (@name, @type, @lat, @lng, @address, @city, @province, @diocese, @misa, 'import')
\`);
const tx = db.transaction(rows => rows.forEach(r => stmt.run(r)));
tx(rows);
console.log('Imported', rows.length);
"
```

## Sumber Alternatif

Beberapa sumber lain yang bisa dipertimbangkan:

- **Wikipedia** — daftar keuskupan Indonesia terkurasi rapi
- **KWI (Konferensi Waligereja Indonesia)** — kwi.or.id
- **Situs resmi keuskupan** — masing-masing keuskupan biasanya punya daftar paroki
- **Google Maps Places API** — berbayar, tapi lengkap dan akurat
- **OpenStreetMap Overpass API** — gratis, cari `amenity=place_of_worship religion=christian denomination=roman_catholic`

Contoh query Overpass untuk semua gereja Katolik di Indonesia:
```
[out:json][timeout:180];
area["ISO3166-1"="ID"]->.id;
(
  node["amenity"="place_of_worship"]["religion"="christian"]["denomination"~"roman_catholic|catholic"](area.id);
  way["amenity"="place_of_worship"]["religion"="christian"]["denomination"~"roman_catholic|catholic"](area.id);
);
out center;
```

Kirim ke: `https://overpass-api.de/api/interpreter?data=<encoded query>`

Ini akan mengembalikan ribuan gereja Katolik di Indonesia dalam JSON dengan koordinat sudah ada — **tanpa perlu geocoding**. Sangat direkomendasikan sebagai starter.

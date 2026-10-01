# Scraping Data Paroki - Panduan

Tiga skrip scraper disediakan untuk menambahkan data dari sumber publik:

| Skrip | Sumber | Isi | Perkiraan jumlah |
|---|---|---|---|
| `scrape-jadwalmisa.js` | https://jadwalmisa.id | nama, alamat, jadwal misa | ~880 gereja |
| `scrape-ekatolik.js` | https://ekatolik.com/jadwal-misa | nama, alamat, telepon, jadwal misa | ~500 gereja |
| `scrape-imankatolik.js` | https://www.imankatolik.or.id/jadwalmisa.html | nama, keuskupan, jadwal misa (tanpa alamat) | ~1.170 paroki |

Selector ketiga skrip sudah disesuaikan dengan struktur situs per Oktober 2026.
Penjelasan struktur tiap situs ada di komentar paling atas masing-masing skrip.
Kalau suatu saat hasilnya 0, kemungkinan situs sumber berubah. Lihat bagian
[Kalau Situs Sumber Berubah](#kalau-situs-sumber-berubah).

## Cara Menjalankan

```bash
# 1. Lihat hasil parsing saja (tanpa geocoding, tanpa menyimpan ke DB)
node scripts/scrape-jadwalmisa.js --limit=10 --dry-run

# 2. Uji coba kecil: simpan 10 lokasi ke DB
node scripts/scrape-jadwalmisa.js --limit=10

# 3. Jalankan penuh, satu per satu (JANGAN paralel)
npm run scrape:jadwalmisa
npm run scrape:ekatolik
npm run scrape:imankatolik
```

**Estimasi waktu:** tiap lokasi butuh 1–4 request geocoding (±1,1 detik per request).
Satu sumber penuh bisa memakan 30–90 menit.

### Kontak untuk Nominatim (opsional)

Geocoding memakai Nominatim (OpenStreetMap). Nominatim mewajibkan User-Agent dengan
kontak yang valid, dan menolak (HTTP 403) alamat contoh seperti `your-email@example.com`.
Defaultnya memakai URL repo GitHub proyek ini. Untuk memakai email sendiri:

```bash
SCRAPER_CONTACT=email-anda@domain.com npm run scrape:jadwalmisa
```

Kalau Nominatim menolak request (403/429), scraper langsung berhenti dengan pesan error.

## Hasil yang Perlu Diketahui

- **Tidak semua lokasi mendapat pin.** Ketiga sumber tidak menyediakan koordinat, jadi
  koordinat dicari lewat OpenStreetMap. Banyak paroki (terutama di luar kota besar)
  belum tercatat di OpenStreetMap. Dari uji coba kecil (12 lokasi per sumber):
  jadwalmisa.id 6/12 ketemu, ekatolik.com 4/12, imankatolik.or.id 1/12 (karena tidak ada alamat).
- **Hasil divalidasi supaya pin tidak salah tempat.** Hasil OpenStreetMap hanya diterima
  kalau nama gereja dan kota/wilayahnya cocok. Contohnya, "Hati Kudus" tidak boleh jatuh
  ke "Bunda Hati Kudus", dan gereja di Sumatera tidak boleh jatuh ke Surabaya. Akibatnya,
  lebih banyak yang dilewati, tetapi pin yang masuk dapat dipercaya.
- **Lokasi yang tidak ditemukan disimpan** di `scripts/output/<sumber>-tidak-ditemukan.json`
  (nama, alamat, kota, jadwal misa). Tambahkan manual lewat halaman admin
  (`/admin`) dengan koordinat dari Google Maps.

## Cara Kerja

1. **Ambil daftar** gereja dari sitemap / halaman indeks sumber
2. **Ambil detail** tiap gereja (nama, alamat, jadwal misa), jeda 1,2–1,5 detik per request
3. **Geocode** ke lat/lng via Nominatim dengan beberapa variasi query, misalnya
   `Gereja Katolik <nama pelindung> <kota>`, lalu alamat jalan sebagai cadangan
4. **Upsert** ke tabel `locations` SQLite

Deteksi duplikat (record dianggap gereja yang sama bila):
- `source_url` sama (menjalankan ulang scraper yang sama), atau
- nama sama dan koordinat berdekatan (< ~500 m), atau
- tipe sama dan koordinat sangat dekat (< ~150 m), atau
- dalam radius ~1 km dan nama pelindungnya cocok, misalnya "Katedral Santo Petrus Bandung" dengan
  "Katedral St Petrus - Bandung". Sumber berbeda sering memberi koordinat yang selisih ratusan meter.

Gereja yang nama pelindungnya berbeda antar-sumber (mis. seed "Paroki Baciro (Santo Yusup)" vs
jadwalmisa "Gereja Kristus Raja - Baciro") tidak bisa dikenali otomatis dan perlu digabung manual.

Jika duplikat, hanya field yang **masih kosong di DB** yang diisi dari data baru (via
`COALESCE`), sehingga data hasil edit di admin tidak ditimpa.

## Menjalankan di Server Hostinger

Database di server terpisah dari database di komputer lokal. Cara paling aman: jalankan
scraper langsung di server lewat SSH (hPanel → Advanced → SSH Access), dari folder aplikasi:

```bash
npm run scrape:jadwalmisa
```

Data langsung masuk ke database yang dipakai website, tanpa perlu restart.

### Alternatif: scraping di lokal, lalu pindahkan lokasinya ke server

Jangan upload file `.sqlite` lokal untuk menimpa database server, karena akun admin
dan session di server ikut hilang. Pindahkan **lokasinya saja**:

```bash
# Di komputer lokal, setelah scraping selesai
npm run locations:export
# -> scripts/output/locations.json
```

Upload `locations.json` ke server (File Manager atau `scp`), misalnya ke `~/data/`, lalu lewat SSH
dari folder aplikasi (dengan `DB_PATH` yang sama seperti website):

```bash
npm run locations:import -- ~/data/locations.json
```

Import aman dijalankan saat website sedang berjalan dan aman diulang. Lokasi yang sudah ada
di server hanya diisi field yang masih kosong, sehingga edit dari admin tidak tertimpa.

## Etika Scraping

- **Rate limit:** jeda 1,2–1,5 detik per request ke situs sumber dan ±1,1 detik ke
  Nominatim. Jangan diturunkan, dan jangan jalankan beberapa scraper sekaligus.
- **Robots.txt:** ketiga situs mengizinkan halaman yang diakses (dicek Oktober 2026).
  jadwalmisa.id hanya melarang `/api/`, `/auth/`, `/_next/image`.
- **jadwalmisa.id:** hanya 1 request per kabupaten/kota (±285 request), karena satu halaman
  sudah berisi semua gereja di kabupaten/kota tersebut.
- **Atribusi:** setiap record diberi `source` dan `source_url`. Jangan dihapus.
  imankatolik.or.id mensyaratkan pencantuman sumber bila mengutip isinya.

## Log Audit

Setiap run tersimpan di tabel `scrape_logs`:

```sql
SELECT source, records_added, records_updated, records_skipped, status, error_message
FROM scrape_logs
ORDER BY id DESC LIMIT 5;
```

## Kalau Situs Sumber Berubah

Jalankan dengan `--limit=5 --dry-run`. Kalau hasilnya 0 atau kosong, struktur situs berubah:

1. Buka situs sumber di browser, klik kanan → **Inspect**
2. Bandingkan dengan struktur yang dijelaskan di komentar atas skrip
3. Perbarui bagian parsing di skrip yang bersangkutan
4. Untuk situs yang memuat data lewat JavaScript, cek DevTools → Network untuk
   endpoint JSON, atau data JSON yang tertanam di halaman (seperti `__NEXT_DATA__`
   pada jadwalmisa.id)

## Sumber Alternatif

Beberapa sumber lain yang bisa dipertimbangkan:

- **OpenStreetMap Overpass API** — gratis, ribuan gereja Katolik di Indonesia **sudah
  lengkap dengan koordinat**, tetapi tanpa jadwal misa
- **Situs resmi keuskupan** — masing-masing keuskupan biasanya punya daftar paroki
- **KWI (Konferensi Waligereja Indonesia)** — kwi.or.id
- **Google Maps Places API** — berbayar, tapi lengkap dan akurat

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

### Impor CSV/JSON manual

Kalau Anda punya file JSON berisi lokasi lengkap dengan koordinat:
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

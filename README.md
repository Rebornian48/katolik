# Peta Paroki v2.0 - Katolik Indonesia

Aplikasi web Node.js + Express + SQLite untuk menampilkan peta interaktif Paroki, Stasi, Katedral, Seminari, Kapel, Biara, dan Sekolah Katolik di seluruh Indonesia.

## Fitur v2

- 🗺️ Peta interaktif Leaflet dengan 6 pilihan basemap
- 💾 **Database SQLite** (bukan lagi JSON) — cepat, portable, mendukung ribuan record
- 🔍 **Radius search 1-100 km** dari lokasi user (menggunakan Haversine di SQL)
- 🌐 Filter per provinsi, keuskupan, atau tipe
- 🔐 **Admin panel** dengan login + CRUD (Create, Read, Update, Delete/soft-delete)
- 📥 **Skrip scraper** untuk 3 sumber data: jadwalmisa.id, ekatolik.com, imankatolik.or.id
- 🗺️ Map picker untuk memilih koordinat saat menambah lokasi
- 🌏 Reverse geocoding via Nominatim (klik "Cari via Alamat")
- 🔒 Password admin di-hash bcrypt, session cookie httpOnly, rate-limit login
- 🌗 Dark mode otomatis, responsive mobile

## Struktur Proyek

```
peta-paroki/
├── server.js              # Express server utama
├── package.json
├── .htaccess              # Konfigurasi Hostinger/Apache
├── .env.example
├── data/
│   └── locations.json     # (Legacy - v1)
├── db/
│   ├── schema.sql         # SQLite schema
│   ├── db.js              # DB singleton + haversine SQL fn
│   ├── init.js            # Init schema + user admin
│   ├── seed.js            # Seeder awal
│   ├── seed-data.json     # 84 lokasi utama kurasi manual
│   └── peta-paroki.sqlite # (auto-generated)
├── middleware/
│   └── auth.js
├── routes/
│   ├── api.js             # /api/*
│   └── admin.js           # /admin login, /me, /change-password
├── scripts/
│   ├── lib/scraper-common.js
│   ├── scrape-jadwalmisa.js
│   ├── scrape-ekatolik.js
│   ├── scrape-imankatolik.js
│   └── README-scraping.md
└── public/
    ├── index.html         # Halaman peta publik
    ├── css/styles.css
    ├── js/app.js
    ├── vendor/leaflet/    # Library Leaflet
    └── admin/
        ├── login.html
        ├── index.html     # Dashboard
        ├── edit.html      # Form CRUD
        ├── css/admin.css
        └── js/{admin,edit}.js
```

## Instalasi & Setup Lokal

```bash
# 1. Install dependencies
npm install

# 2. Init database + buat user admin
npm run db:init

# 3. Muat data awal (~84 lokasi kurasi manual)
npm run db:seed

# 4. Jalankan server
npm start
# atau dengan auto-reload:
npm run dev

# 5. Akses:
# Peta publik:  http://localhost:3000
# Admin panel:  http://localhost:3000/admin
```

**Kredensial admin default:**
- Username: `admin`
- Password: `admin123`
- ⚠️ **SEGERA UBAH** setelah login pertama (menu 🔒 Password di dashboard).

## API Endpoints

### Publik

| Method | Path                              | Deskripsi                                            |
|--------|-----------------------------------|------------------------------------------------------|
| GET    | `/api/meta`                       | Statistik + daftar provinsi & keuskupan              |
| GET    | `/api/locations`                  | List lokasi. Query: `q, type, province, diocese, city, limit, offset` |
| GET    | `/api/locations/:id`              | Detail satu lokasi                                   |
| GET    | `/api/locations/nearby`           | Radius search. Query: `lat, lng, radius (km), type?` |
| GET    | `/health`                         | Health check                                         |

Contoh:
```
GET /api/locations/nearby?lat=-6.1697&lng=106.8347&radius=25
```

### Admin (butuh login)

| Method | Path                          | Deskripsi                          |
|--------|-------------------------------|-------------------------------------|
| POST   | `/admin/login`                | `{username, password}`             |
| POST   | `/admin/logout`               |                                     |
| GET    | `/admin/me`                   | Info user                          |
| POST   | `/admin/change-password`      | `{oldPassword, newPassword}`       |
| POST   | `/api/locations`              | Tambah lokasi                      |
| PUT    | `/api/locations/:id`          | Update lokasi                      |
| DELETE | `/api/locations/:id`          | Soft delete (`?soft=false` untuk hard) |

## Scraping Data Tambahan

Aplikasi datang dengan **84 lokasi utama kurasi manual**. Untuk memperluas ke ribuan paroki di seluruh Indonesia, gunakan skrip scraper.

📄 Baca [scripts/README-scraping.md](scripts/README-scraping.md) untuk detail.

Ringkasan:
```bash
# Scrape dari jadwalmisa.id (batasi 10 dulu untuk uji)
node scripts/scrape-jadwalmisa.js --limit=10

# Setelah oke, jalankan penuh
node scripts/scrape-jadwalmisa.js

# Sumber lain
node scripts/scrape-ekatolik.js
node scripts/scrape-imankatolik.js
```

**⚠️ Penting:** Skrip scraper berisi *selector CSS placeholder* karena struktur HTML setiap situs bisa berubah. Anda perlu mengunjungi situs sumber, inspect halaman, dan sesuaikan selector di file scraper agar sesuai. Lihat komentar `TODO:` di setiap file.

## Deploy ke Hostinger Business Web Hosting

### Ringkasan Langkah

1. **Kompres proyek** jadi ZIP (tanpa `node_modules` & `db/peta-paroki.sqlite*`)
2. Upload & ekstrak di folder `domains/namadomain.com/public_html`
3. Buka hPanel → **Advanced → Node.js → Create Application**
   - Node.js version: **20.x** (atau terbaru)
   - Application mode: **Production**
   - Application root: folder tempat file diekstrak
   - Application URL: domain/subdomain Anda
   - Startup file: **`server.js`**
4. Klik **Run NPM Install** (butuh ~1-2 menit)
5. Buka terminal SSH atau gunakan File Manager untuk jalankan:
   ```bash
   npm run db:init
   npm run db:seed
   ```
6. Klik **Start Application**

Setelah aktif:
- Peta publik: `https://namadomain.com/`
- Admin: `https://namadomain.com/admin`

### Environment Variables (Hostinger hPanel)

Set di panel Node.js:

| Variable          | Value                     | Wajib? |
|-------------------|---------------------------|--------|
| `NODE_ENV`        | `production`              | ✓      |
| `SESSION_SECRET`  | (random string 32+ chars) | ✓      |
| `ADMIN_USER`      | (username admin awal)     | Optional |
| `ADMIN_PASS`      | (password admin awal)     | Optional |
| `DB_PATH`         | (path absolut ke .sqlite) | Optional |

`PORT` otomatis di-set oleh Hostinger.

### Persistensi Database

Database SQLite disimpan di `db/peta-paroki.sqlite`. Pastikan folder `db/` **writable** oleh proses Node. Di Hostinger biasanya sudah OK secara default.

Untuk **backup database**, cukup download file `.sqlite` via File Manager atau SSH:
```bash
scp -P 65002 user@server.hostinger.com:~/domains/xxx/public_html/db/peta-paroki.sqlite ./backup.sqlite
```

## Perawatan

### Backup & Restore

```bash
# Backup: cukup copy file .sqlite
cp db/peta-paroki.sqlite db/backup-$(date +%Y%m%d).sqlite

# Restore: replace file .sqlite (server harus stopped/restart)
cp db/backup-20260929.sqlite db/peta-paroki.sqlite
```

### Reset Database

```bash
npm run db:reset   # hapus semua + init ulang + seed ulang
```

### Ubah Password Admin

Lewat UI: login → klik 🔒 Password di header.

Lewat CLI:
```bash
node -e "
const bcrypt = require('bcryptjs');
const {getDb} = require('./db/db');
getDb().prepare('UPDATE users SET password_hash = ? WHERE username = ?')
  .run(bcrypt.hashSync('password_baru', 10), 'admin');
console.log('OK');
"
```

## Troubleshooting

**❌ `better-sqlite3` install error di Hostinger**
- Butuh Node ≥ 18 dan build tools. Cek versi Node di panel.
- Jika gagal, coba `npm rebuild better-sqlite3` di SSH.

**❌ Radius search return 0**
- Cek DB tidak kosong: `curl /health` harus tampilkan `locations > 0`
- Cek koordinat lat/lng valid

**❌ Admin login: "Too many attempts"**
- Rate-limit 5 percobaan / 15 menit. Tunggu atau restart server.

**❌ Peta tidak tampil di production**
- Cek `NODE_ENV=production` dan HTTPS aktif (tile server perlu HTTPS)

## Tech Stack

- **Backend:** Node.js 18+, Express 4, better-sqlite3, bcryptjs, express-session
- **Frontend:** Vanilla JS, Leaflet 1.9.4
- **DB:** SQLite (WAL mode, custom `haversine()` SQL function)
- **Scraping:** node-fetch, cheerio

## Lisensi

MIT

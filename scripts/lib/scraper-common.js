/**
 * Helper umum untuk scraper.
 * - HTTP dengan retry & rate-limit
 * - Geocoding via Nominatim (opsional, karena banyak endpoint tidak menyediakan koordinat)
 * - Upsert ke SQLite
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { getDb, initSchema } = require('../../db/db');

// Nominatim mewajibkan kontak yang valid dan menolak (HTTP 403) alamat contoh
// seperti your-email@example.com. Bisa diganti: SCRAPER_CONTACT=email-anda@domain.com
const CONTACT = process.env.SCRAPER_CONTACT || 'https://github.com/Rebornian48/katolik';
const DEFAULT_UA = `peta-paroki-scraper/2.0 (+${CONTACT})`;
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, opts = {}) {
  const maxRetry = opts.maxRetry ?? 3;
  const timeout = opts.timeout ?? 30000;
  const headers = { 'User-Agent': DEFAULT_UA, 'Accept': 'text/html,application/json', ...(opts.headers || {}) };

  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Situs lama (mis. imankatolik.or.id) memakai encoding latin1, bukan UTF-8
      if (opts.encoding) return (await res.buffer()).toString(opts.encoding);
      return await res.text();
    } catch (e) {
      if (attempt >= maxRetry) throw e;
      const wait = 1000 * attempt;
      console.warn(`  [retry] ${url}: ${e.message}, coba lagi dalam ${wait}ms`);
      await SLEEP(wait);
    }
  }
}

async function geocode(query, opts = {}) {
  const [hit] = await searchNominatim(query, 1, opts);
  return hit ? toGeo(hit) : null;
}

const toGeo = (hit) => ({ lat: parseFloat(hit.lat), lng: parseFloat(hit.lon), display: hit.display_name });

async function searchNominatim(query, limit, opts = {}) {
  // Rate-limit Nominatim: 1 req/detik
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=${limit}&countrycodes=id&q=${encodeURIComponent(query)}`;
  const headers = {
    'User-Agent': opts.userAgent || DEFAULT_UA,
    'Accept': 'application/json',
    'Accept-Language': 'id,en',
  };
  const res = await fetch(url, { headers });
  if (res.status === 403 || res.status === 429) {
    // Diblokir / kena rate limit: percuma lanjut, hentikan seluruh proses
    const err = new Error(`Nominatim menolak request (HTTP ${res.status}). Cek SCRAPER_CONTACT dan jangan jalankan beberapa scraper sekaligus.`);
    err.fatal = true;
    throw err;
  }
  if (!res.ok) throw new Error('Geocoding gagal: HTTP ' + res.status);
  const arr = await res.json();
  await SLEEP(1100); // hormati kebijakan Nominatim
  return arr;
}

const isChurchResult = (r) =>
  r.type === 'place_of_worship' || /gereja|church|katolik|katholik|katedral|kapel|paroki/i.test(r.display_name);

const STOP_WORDS = new Set([
  'gereja', 'katolik', 'katholik', 'paroki', 'stasi', 'kapel', 'santo', 'santa', 'santu',
  'dari', 'yang', 'dan', 'kota', 'kabupaten', 'kab', 'jalan', 'flores', 'papua',
]);

/** Kata-kata khas (≥4 huruf, bukan kata umum), dinormalisasi: "St. Yosef" -> ['yosef'] */
function keyWords(text) {
  return (text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
}

// Cocokkan 5 huruf awal supaya variasi ejaan ringan tetap lolos (Theresia/Therese)
const mentions = (display, word) => display.includes(word.slice(0, 5));
const sameWord = (a, b) => a.slice(0, 5) === b.slice(0, 5);

/**
 * Coba beberapa query berurutan, kembalikan hasil pertama yang lolos pengecekan.
 * Item: { q, church: true } -> hasil harus gereja, memuat SEMUA kata khas `check.name`,
 *                              minimal satu kata `check.region`, dan nama gereja di OSM
 *                              tidak boleh punya kata khas lain di luar nama & wilayah
 *       'string'            -> query alamat; cukup memuat salah satu kata `check.region`
 * Tanpa pengecekan ini Nominatim sering mengembalikan gereja lain bernama mirip
 * (mis. "Hati Kudus" -> "Bunda Hati Kudus") atau kota yang salah.
 * Alamat lengkap + nama hampir selalu gagal di Nominatim; pola yang paling
 * sering berhasil adalah "Gereja Katolik <nama pelindung> <kota>".
 */
async function geocodeFirst(queries, check = {}) {
  const nameWords = keyWords(check.name);
  const regionWords = keyWords(check.region);
  const inRegion = (d) => !regionWords.length || regionWords.some((w) => mentions(d, w));
  const allowed = [...nameWords, ...regionWords];
  const sameChurch = (r) => {
    const d = keyWords(r.display_name).join(' ');
    const osmName = keyWords(r.name || r.display_name.split(',')[0]);
    return isChurchResult(r)
      && nameWords.every((w) => mentions(d, w))
      && osmName.every((w) => allowed.some((a) => sameWord(a, w)));
  };

  const seen = new Set();
  for (const item of queries) {
    const { q, church } = typeof item === 'string' ? { q: item } : item;
    const query = (q || '').replace(/\s+/g, ' ').trim();
    if (!query || seen.has(query)) continue;
    seen.add(query);

    const hit = (await searchNominatim(query, 5)).find(
      (r) => inRegion(keyWords(r.display_name).join(' ')) && (!church || sameChurch(r)),
    );
    if (hit) return { ...toGeo(hit), query };
  }
  return null;
}

/** Buang RT/RW, kode pos, dan "Kec." supaya alamat lebih mudah dikenali Nominatim. */
function cleanAddress(address) {
  if (!address) return '';
  return address
    .replace(/\bRT\.?\s*\d+\s*\/?\s*RW\.?\s*\d+\b,?/gi, '')
    .replace(/\b(RT|RW)\.?\s*\d+\b,?/gi, '')
    .replace(/\b\d{5}\b/g, '')
    .replace(/\bKec\.\s*/gi, '')
    .replace(/\s*,\s*(,\s*)+/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '');
}

/**
 * Pecah nama gereja jadi nama pelindung & nama tempat, untuk query geocoding.
 * "Gereja Santa Clara - Bekasi Utara"  -> { core: 'Santa Clara', place: 'Bekasi Utara' }
 * "Paroki Kristus Raja"                -> { core: 'Kristus Raja', place: '' }
 */
function splitChurchName(name) {
  const [left, ...rest] = (name || '').split(/\s+[-–]\s+/);
  const core = left
    .replace(/\b(gereja|katolik|katholik|paroki|stasi|kapel)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { core: core || left.trim(), place: rest.join(' ').trim() };
}

/** Tebak tipe lokasi dari nama / slug. */
function guessType(text) {
  const t = (text || '').toLowerCase();
  if (/katedral/.test(t)) return 'Katedral';
  if (/\bstasi\b/.test(t)) return 'Stasi';
  if (/\bkapel\b/.test(t)) return 'Kapel';
  if (/\b(biara|pertapaan|susteran|frateran|bruderan)\b/.test(t)) return 'Biara';
  if (/\bseminari\b/.test(t)) return 'Seminari';
  return 'Paroki';
}

initSchema();
const db = getDb();

const findExisting = db.prepare(`
  SELECT id FROM locations
  WHERE (name = @name AND ABS(lat - @lat) < 0.005 AND ABS(lng - @lng) < 0.005)
     OR (source_url IS NOT NULL AND source_url = @source_url)
     -- sumber berbeda menamai gereja yang sama secara berbeda; anggap lokasi
     -- dalam ~150 m dengan tipe sama sebagai gereja yang sama
     OR (type = @type AND ABS(lat - @lat) < 0.0015 AND ABS(lng - @lng) < 0.0015)
  ORDER BY (source_url IS @source_url) DESC, (name = @name) DESC
  LIMIT 1
`);

const insertStmt = db.prepare(`
  INSERT INTO locations (
    name, type, pastor, address, city, province, diocese,
    lat, lng, phone, email, website, misa, source, source_url, is_active
  ) VALUES (
    @name, @type, @pastor, @address, @city, @province, @diocese,
    @lat, @lng, @phone, @email, @website, @misa, @source, @source_url, 1
  )
`);

// Nilai yang sudah ada menang: hanya field kosong yang diisi, supaya hasil edit
// di halaman admin tidak tertimpa saat scraper/import dijalankan ulang.
const updateStmt = db.prepare(`
  UPDATE locations SET
    pastor = COALESCE(pastor, @pastor),
    address = COALESCE(address, @address),
    city = COALESCE(city, @city),
    province = COALESCE(province, @province),
    diocese = COALESCE(diocese, @diocese),
    phone = COALESCE(phone, @phone),
    email = COALESCE(email, @email),
    website = COALESCE(website, @website),
    misa = COALESCE(misa, @misa),
    source_url = COALESCE(source_url, @source_url)
  WHERE id = @id
`);

function upsertLocation(row) {
  const clean = {
    name: row.name?.trim(),
    type: row.type || 'Paroki',
    pastor: row.pastor || null,
    address: row.address || null,
    city: row.city || null,
    province: row.province || null,
    diocese: row.diocese || null,
    lat: row.lat != null ? parseFloat(row.lat) : null,
    lng: row.lng != null ? parseFloat(row.lng) : null,
    phone: row.phone || null,
    email: row.email || null,
    website: row.website || null,
    misa: row.misa || null,
    source: row.source || 'scraper',
    source_url: row.source_url || null,
  };

  if (!clean.name || clean.lat == null || clean.lng == null) return { skipped: true, reason: 'no coord/name' };

  const existing = findExisting.get(clean);
  if (existing) {
    updateStmt.run({ ...clean, id: existing.id });
    return { updated: true, id: existing.id };
  }
  const result = insertStmt.run(clean);
  return { added: true, id: result.lastInsertRowid };
}

function logScrapeStart(source) {
  const r = db
    .prepare('INSERT INTO scrape_logs (source, status) VALUES (?, ?)')
    .run(source, 'running');
  return r.lastInsertRowid;
}

function logScrapeFinish(logId, stats, error = null) {
  db.prepare(`
    UPDATE scrape_logs SET
      finished_at = CURRENT_TIMESTAMP,
      status = ?,
      records_added = ?,
      records_updated = ?,
      records_skipped = ?,
      error_message = ?
    WHERE id = ?
  `).run(
    error ? 'error' : 'success',
    stats.added || 0,
    stats.updated || 0,
    stats.skipped || 0,
    error ? String(error.message || error).slice(0, 500) : null,
    logId,
  );
}

/** Baca --limit=N dan --dry-run dari argumen command line. */
function parseArgs(argv = process.argv) {
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  return {
    limit: limitArg ? parseInt(limitArg.split('=')[1], 10) || 0 : 0,
    dryRun: argv.includes('--dry-run'),
  };
}

/**
 * Loop bersama untuk semua scraper: geocode tiap record lalu upsert ke DB.
 * Setiap record membawa `geoQueries` dan `geoCheck` (lihat geocodeFirst). Dengan --dry-run
 * record hanya dicetak, tanpa geocoding dan tanpa menulis ke DB.
 */
async function importRecords(source, records, { dryRun = false } = {}) {
  if (dryRun) {
    for (const { geoQueries, geoCheck, ...r } of records) {
      console.log(JSON.stringify(r), '\n  geocode:', geoQueries, '\n  cek:', geoCheck);
    }
    console.log(`[${source}] Dry run: ${records.length} record, tidak ada yang disimpan.`);
    return;
  }

  const logId = logScrapeStart(source);
  const stats = { added: 0, updated: 0, skipped: 0 };
  const notFound = [];
  try {
    for (const [i, { geoQueries, geoCheck, ...rec }] of records.entries()) {
      console.log(`[${i + 1}/${records.length}] ${rec.name}`);
      try {
        const geo = await geocodeFirst(geoQueries, geoCheck);
        if (!geo) {
          stats.skipped++;
          notFound.push(rec);
          console.log('  (skip: lokasi tidak ditemukan di OpenStreetMap)');
          continue;
        }
        const r = upsertLocation({ ...rec, lat: geo.lat, lng: geo.lng, source });
        if (r.added) stats.added++;
        else if (r.updated) stats.updated++;
        else stats.skipped++;
        console.log(`  ${r.added ? 'baru' : r.updated ? 'update' : 'skip'} <- "${geo.query}"`);
      } catch (e) {
        if (e.fatal) throw e;
        console.warn('  Error:', e.message);
        stats.skipped++;
      }
    }
    logScrapeFinish(logId, stats);
    console.log('==============================');
    console.log(`Selesai. Added=${stats.added} Updated=${stats.updated} Skipped=${stats.skipped}`);
    if (notFound.length) {
      // Lokasi yang tidak ketemu bisa ditambahkan manual lewat halaman admin
      const file = path.join(__dirname, '..', 'output', `${source}-tidak-ditemukan.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(notFound, null, 2));
      console.log(`${notFound.length} lokasi tidak ditemukan, daftarnya di: ${path.relative(process.cwd(), file)}`);
    }
  } catch (e) {
    logScrapeFinish(logId, stats, e);
    throw e;
  }
}

module.exports = {
  parseArgs, importRecords,
  fetchText, geocode, geocodeFirst, cleanAddress, splitChurchName, guessType,
  upsertLocation, logScrapeStart, logScrapeFinish, SLEEP, db,
};

/**
 * Helper umum untuk scraper.
 * - HTTP dengan retry & rate-limit
 * - Geocoding via Nominatim (opsional, karena banyak endpoint tidak menyediakan koordinat)
 * - Upsert ke SQLite
 */

const fetch = require('node-fetch');
const { getDb, initSchema } = require('../../db/db');

const DEFAULT_UA = 'peta-paroki-scraper/2.0 (+contact: your-email@example.com)';
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
  // Rate-limit Nominatim: 1 req/detik
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=id&q=${encodeURIComponent(query)}`;
  const headers = {
    'User-Agent': opts.userAgent || DEFAULT_UA,
    'Accept': 'application/json',
    'Accept-Language': 'id,en',
  };
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error('Geocoding gagal: HTTP ' + res.status);
  const arr = await res.json();
  await SLEEP(1100); // hormati kebijakan Nominatim
  if (!arr.length) return null;
  return { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon), display: arr[0].display_name };
}

initSchema();
const db = getDb();

const findExisting = db.prepare(`
  SELECT id FROM locations
  WHERE (name = @name AND ABS(lat - @lat) < 0.005 AND ABS(lng - @lng) < 0.005)
     OR (source_url IS NOT NULL AND source_url = @source_url)
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

const updateStmt = db.prepare(`
  UPDATE locations SET
    pastor = COALESCE(@pastor, pastor),
    address = COALESCE(@address, address),
    city = COALESCE(@city, city),
    province = COALESCE(@province, province),
    diocese = COALESCE(@diocese, diocese),
    phone = COALESCE(@phone, phone),
    email = COALESCE(@email, email),
    website = COALESCE(@website, website),
    misa = COALESCE(@misa, misa),
    source_url = COALESCE(@source_url, source_url)
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

module.exports = { fetchText, geocode, upsertLocation, logScrapeStart, logScrapeFinish, SLEEP, db };

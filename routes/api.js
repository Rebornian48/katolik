/**
 * API Routes untuk lokasi paroki.
 *
 * Endpoint publik:
 *   GET  /api/locations
 *   GET  /api/locations/:id
 *   GET  /api/locations/nearby?lat=..&lng=..&radius=..
 *   GET  /api/meta  (statistik + daftar province & diocese)
 *
 * Endpoint admin (butuh login):
 *   POST   /api/locations
 *   PUT    /api/locations/:id
 *   DELETE /api/locations/:id
 */

const express = require('express');
const { getDb } = require('../db/db');
const { requireApiAuth } = require('../middleware/auth');

const router = express.Router();

const VALID_TYPES = ['Paroki', 'Stasi', 'Seminari', 'Sekolah', 'Katedral', 'Kapel', 'Biara'];

// ---------- Helpers ----------
function sanitizeLocationPayload(body) {
  const fields = [
    'name', 'type', 'pastor', 'address', 'city', 'province',
    'diocese', 'phone', 'email', 'website', 'misa', 'source',
    'source_url',
  ];
  const out = {};
  for (const f of fields) {
    if (body[f] !== undefined) {
      const v = typeof body[f] === 'string' ? body[f].trim() : body[f];
      out[f] = v === '' ? null : v;
    }
  }
  if (body.lat !== undefined) out.lat = parseFloat(body.lat);
  if (body.lng !== undefined) out.lng = parseFloat(body.lng);
  if (body.is_active !== undefined) out.is_active = body.is_active ? 1 : 0;
  return out;
}

function validateForCreate(data) {
  const errors = [];
  if (!data.name) errors.push('name wajib diisi');
  if (!data.type) errors.push('type wajib diisi');
  else if (!VALID_TYPES.includes(data.type))
    errors.push(`type harus salah satu dari: ${VALID_TYPES.join(', ')}`);
  if (data.lat == null || isNaN(data.lat)) errors.push('lat wajib berupa angka');
  if (data.lng == null || isNaN(data.lng)) errors.push('lng wajib berupa angka');
  if (data.lat != null && (data.lat < -90 || data.lat > 90))
    errors.push('lat harus antara -90 sampai 90');
  if (data.lng != null && (data.lng < -180 || data.lng > 180))
    errors.push('lng harus antara -180 sampai 180');
  return errors;
}

// ---------- GET /api/locations ----------
router.get('/locations', (req, res) => {
  const db = getDb();
  const { type, province, diocese, city, q, limit, offset } = req.query;
  const conds = ['is_active = 1'];
  const params = {};

  if (type) { conds.push('type = @type'); params.type = type; }
  if (province) { conds.push('province = @province'); params.province = province; }
  if (diocese) { conds.push('diocese = @diocese'); params.diocese = diocese; }
  if (city) { conds.push('city = @city'); params.city = city; }
  if (q) {
    conds.push('(name LIKE @q OR pastor LIKE @q OR address LIKE @q OR city LIKE @q OR diocese LIKE @q)');
    params.q = `%${q}%`;
  }

  const where = conds.join(' AND ');
  const lim = Math.min(parseInt(limit) || 5000, 5000);
  const off = parseInt(offset) || 0;

  const rows = db
    .prepare(`SELECT * FROM locations WHERE ${where} ORDER BY name LIMIT @lim OFFSET @off`)
    .all({ ...params, lim, off });

  const total = db.prepare(`SELECT COUNT(*) AS n FROM locations WHERE ${where}`).get(params).n;

  res.json({ count: rows.length, total, data: rows });
});

// ---------- GET /api/locations/nearby ----------
router.get('/locations/nearby', (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radius = Math.min(Math.max(parseFloat(req.query.radius) || 10, 0.1), 500);
  const type = req.query.type;
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'Parameter lat & lng wajib berupa angka' });
  }

  const db = getDb();

  // Optimisasi: pre-filter bounding box, lalu hitung haversine akurat
  const latDelta = radius / 111;
  const lngDelta = radius / (111 * Math.cos((lat * Math.PI) / 180) || 1);

  const conds = [
    'is_active = 1',
    'lat BETWEEN @latMin AND @latMax',
    'lng BETWEEN @lngMin AND @lngMax',
  ];
  const params = {
    lat,
    lng,
    latMin: lat - latDelta,
    latMax: lat + latDelta,
    lngMin: lng - lngDelta,
    lngMax: lng + lngDelta,
    radius,
    limit,
  };

  if (type) {
    conds.push('type = @type');
    params.type = type;
  }

  const sql = `
    SELECT * FROM (
      SELECT *, haversine(@lat, @lng, lat, lng) AS distance_km
      FROM locations
      WHERE ${conds.join(' AND ')}
    )
    WHERE distance_km <= @radius
    ORDER BY distance_km ASC
    LIMIT @limit
  `;

  const rows = db.prepare(sql).all(params);

  res.json({
    origin: { lat, lng },
    radius_km: radius,
    count: rows.length,
    data: rows,
  });
});

// ---------- GET /api/meta ----------
router.get('/meta', (req, res) => {
  const db = getDb();
  const stats = db.prepare('SELECT type, COUNT(*) AS n FROM locations WHERE is_active = 1 GROUP BY type').all();
  const provinces = db.prepare(
    'SELECT DISTINCT province FROM locations WHERE is_active = 1 AND province IS NOT NULL ORDER BY province'
  ).all().map(r => r.province);
  const dioceses = db.prepare(
    'SELECT DISTINCT diocese FROM locations WHERE is_active = 1 AND diocese IS NOT NULL ORDER BY diocese'
  ).all().map(r => r.diocese);
  const total = db.prepare('SELECT COUNT(*) AS n FROM locations WHERE is_active = 1').get().n;

  res.json({ total, byType: stats, provinces, dioceses });
});

// ---------- GET /api/locations/:id ----------
router.get('/locations/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  const loc = db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
  if (!loc) return res.status(404).json({ error: 'Lokasi tidak ditemukan' });
  res.json(loc);
});

// ---------- POST /api/locations (admin) ----------
router.post('/locations', requireApiAuth, (req, res) => {
  const data = sanitizeLocationPayload(req.body);
  const errors = validateForCreate(data);
  if (errors.length) return res.status(400).json({ error: 'Validasi gagal', details: errors });

  const db = getDb();
  const result = db
    .prepare(`
      INSERT INTO locations (
        name, type, pastor, address, city, province, diocese,
        lat, lng, phone, email, website, misa, source, source_url, is_active
      ) VALUES (
        @name, @type, @pastor, @address, @city, @province, @diocese,
        @lat, @lng, @phone, @email, @website, @misa, @source, @source_url, @is_active
      )
    `)
    .run({
      name: data.name,
      type: data.type,
      pastor: data.pastor || null,
      address: data.address || null,
      city: data.city || null,
      province: data.province || null,
      diocese: data.diocese || null,
      lat: data.lat,
      lng: data.lng,
      phone: data.phone || null,
      email: data.email || null,
      website: data.website || null,
      misa: data.misa || null,
      source: data.source || 'manual',
      source_url: data.source_url || null,
      is_active: data.is_active ?? 1,
    });

  const created = db.prepare('SELECT * FROM locations WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(created);
});

// ---------- PUT /api/locations/:id (admin) ----------
router.put('/locations/:id', requireApiAuth, (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Lokasi tidak ditemukan' });

  const data = sanitizeLocationPayload(req.body);
  const merged = { ...existing, ...data };
  const errors = validateForCreate(merged);
  if (errors.length) return res.status(400).json({ error: 'Validasi gagal', details: errors });

  db.prepare(`
    UPDATE locations SET
      name = @name, type = @type, pastor = @pastor, address = @address,
      city = @city, province = @province, diocese = @diocese,
      lat = @lat, lng = @lng, phone = @phone, email = @email,
      website = @website, misa = @misa, source = @source,
      source_url = @source_url, is_active = @is_active
    WHERE id = @id
  `).run({
    id,
    name: merged.name,
    type: merged.type,
    pastor: merged.pastor || null,
    address: merged.address || null,
    city: merged.city || null,
    province: merged.province || null,
    diocese: merged.diocese || null,
    lat: merged.lat,
    lng: merged.lng,
    phone: merged.phone || null,
    email: merged.email || null,
    website: merged.website || null,
    misa: merged.misa || null,
    source: merged.source || 'manual',
    source_url: merged.source_url || null,
    is_active: merged.is_active ?? 1,
  });

  const updated = db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
  res.json(updated);
});

// ---------- DELETE /api/locations/:id (admin) ----------
router.delete('/locations/:id', requireApiAuth, (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  const soft = req.query.soft !== 'false';

  const existing = db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Lokasi tidak ditemukan' });

  if (soft) {
    db.prepare('UPDATE locations SET is_active = 0 WHERE id = ?').run(id);
    res.json({ ok: true, id, mode: 'soft_delete' });
  } else {
    db.prepare('DELETE FROM locations WHERE id = ?').run(id);
    res.json({ ok: true, id, mode: 'hard_delete' });
  }
});

module.exports = router;

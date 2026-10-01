/**
 * API antrian lokasi tanpa koordinat (semua butuh login admin):
 *   GET /api/queue              ?status=pending|skipped|done&q=..&source=..&limit=..&offset=..
 *   GET /api/queue/:id
 *   PUT /api/queue/:id          { status: 'pending' | 'skipped' }
 *
 * Entri ditandai 'done' oleh POST /api/locations dengan body.queue_id
 * (lihat routes/api.js), sehingga pembuatan lokasi & penutupan antrian
 * terjadi dalam satu transaksi.
 */

const express = require('express');
const { getDb } = require('../db/db');
const { requireApiAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireApiAuth);

const STATUSES = ['pending', 'skipped', 'done'];

function buildFilter(query) {
  const conds = [];
  const params = {};
  const status = STATUSES.includes(query.status) ? query.status : 'pending';
  conds.push('status = @status');
  params.status = status;
  if (query.source) { conds.push('source = @source'); params.source = query.source; }
  if (query.q) {
    conds.push('(name LIKE @q OR address LIKE @q OR city LIKE @q OR diocese LIKE @q OR province LIKE @q)');
    params.q = `%${query.q}%`;
  }
  return { where: conds.join(' AND '), params };
}

// ---------- GET /api/queue ----------
router.get('/', (req, res) => {
  const db = getDb();
  const { where, params } = buildFilter(req.query);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;

  // Yang punya alamat & jadwal misa didahulukan: paling mudah dicari & paling berguna
  const rows = db.prepare(`
    SELECT * FROM location_queue WHERE ${where}
    ORDER BY (address IS NULL), (misa IS NULL), name
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset });
  const total = db.prepare(`SELECT COUNT(*) AS n FROM location_queue WHERE ${where}`).get(params).n;

  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM location_queue GROUP BY status').all()) counts[r.status] = r.n;
  const sources = db.prepare('SELECT DISTINCT source FROM location_queue WHERE source IS NOT NULL ORDER BY source').all().map((r) => r.source);

  res.json({ data: rows, total, limit, offset, counts, sources });
});

// ---------- GET /api/queue/:id ----------
router.get('/:id', (req, res) => {
  const row = getDb().prepare('SELECT * FROM location_queue WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!row) return res.status(404).json({ error: 'Entri antrian tidak ditemukan' });
  res.json(row);
});

// ---------- PUT /api/queue/:id (lewati / kembalikan ke antrian) ----------
router.put('/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  const { status } = req.body || {};
  if (!['pending', 'skipped'].includes(status)) {
    return res.status(400).json({ error: "status harus 'pending' atau 'skipped'" });
  }
  const row = db.prepare('SELECT * FROM location_queue WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Entri antrian tidak ditemukan' });
  if (row.status === 'done') return res.status(409).json({ error: 'Entri ini sudah dijadikan lokasi' });

  db.prepare('UPDATE location_queue SET status = ? WHERE id = ?').run(status, id);
  res.json({ ...row, status });
});

module.exports = router;

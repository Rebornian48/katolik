-- =====================================================
-- Peta Paroki - SQLite Schema
-- =====================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Tabel lokasi (paroki, stasi, seminari, sekolah, katedral, kapel)
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('Paroki', 'Stasi', 'Seminari', 'Sekolah', 'Katedral', 'Kapel', 'Biara')),
  pastor TEXT,
  address TEXT,
  city TEXT,
  province TEXT,
  diocese TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  phone TEXT,
  email TEXT,
  website TEXT,
  misa TEXT,
  source TEXT DEFAULT 'manual',
  source_url TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_locations_type ON locations(type);
CREATE INDEX IF NOT EXISTS idx_locations_diocese ON locations(diocese);
CREATE INDEX IF NOT EXISTS idx_locations_province ON locations(province);
CREATE INDEX IF NOT EXISTS idx_locations_active ON locations(is_active);
CREATE INDEX IF NOT EXISTS idx_locations_coords ON locations(lat, lng);
CREATE INDEX IF NOT EXISTS idx_locations_name ON locations(name);

-- Trigger untuk update updated_at otomatis
CREATE TRIGGER IF NOT EXISTS trg_locations_updated_at
AFTER UPDATE ON locations
FOR EACH ROW
BEGIN
  UPDATE locations SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

-- Antrian lokasi tanpa koordinat (mis. hasil scraper yang tidak ditemukan
-- di OpenStreetMap). Admin menentukan titiknya di peta lewat /admin/antrian;
-- setelah disimpan entri ditandai 'done' dan location_id menunjuk lokasinya.
CREATE TABLE IF NOT EXISTS location_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Paroki' CHECK(type IN ('Paroki', 'Stasi', 'Seminari', 'Sekolah', 'Katedral', 'Kapel', 'Biara')),
  pastor TEXT,
  address TEXT,
  city TEXT,
  province TEXT,
  diocese TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  misa TEXT,
  source TEXT,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'done', 'skipped')),
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_source_url ON location_queue(source_url) WHERE source_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_queue_status ON location_queue(status);

CREATE TRIGGER IF NOT EXISTS trg_queue_updated_at
AFTER UPDATE ON location_queue
FOR EACH ROW
BEGIN
  UPDATE location_queue SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

-- Tabel user admin
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'admin',
  last_login DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabel sesi (untuk express-session)
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expire INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);

-- Tabel log scraping (audit trail)
CREATE TABLE IF NOT EXISTS scrape_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  status TEXT,
  records_added INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  records_skipped INTEGER DEFAULT 0,
  error_message TEXT
);

/**
 * Scraper untuk jadwalmisa.id
 *
 * STRUKTUR SITUS (dicek Oktober 2026):
 *   - Situs Next.js. Daftar semua gereja ada di /gereja-sitemap.xml dengan URL
 *     /cari/<provinsi>/<kabupaten-kota>/<slug-gereja>.
 *   - Setiap halaman menyimpan datanya sebagai JSON di <script id="__NEXT_DATA__">.
 *     props.pageProps.data berisi SEMUA gereja di kabupaten/kota tersebut
 *     (nama, alamat, jadwal misa), jadi cukup 1 request per kabupaten/kota.
 *   - Tidak ada koordinat (hanya link Google Maps pendek), jadi tetap perlu geocoding.
 *
 * Jalankan:           node scripts/scrape-jadwalmisa.js
 * Uji 10 gereja:      node scripts/scrape-jadwalmisa.js --limit=10
 * Lihat hasil parse:  node scripts/scrape-jadwalmisa.js --limit=10 --dry-run
 */

const {
  fetchText, cleanAddress, splitChurchName, guessType, importRecords, parseArgs, SLEEP,
} = require('./lib/scraper-common');

const SOURCE = 'jadwalmisa.id';
const BASE = 'https://jadwalmisa.id';
const { limit, dryRun } = parseArgs();

/** Kelompokkan URL gereja dari sitemap per kabupaten/kota. */
async function fetchRegencyPages() {
  console.log('[jadwalmisa] Ambil sitemap gereja...');
  const xml = await fetchText(BASE + '/gereja-sitemap.xml');
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);

  const byRegency = new Map();
  for (const url of urls) {
    const m = url.match(/\/cari\/([^/]+)\/([^/]+)\/[^/]+$/);
    if (m && !byRegency.has(`${m[1]}/${m[2]}`)) byRegency.set(`${m[1]}/${m[2]}`, url);
  }
  console.log(`[jadwalmisa] ${urls.length} gereja di ${byRegency.size} kabupaten/kota`);
  return [...byRegency.entries()].map(([path, url]) => ({ path, url }));
}

function readNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('__NEXT_DATA__ tidak ditemukan (struktur situs berubah?)');
  return JSON.parse(m[1]).props.pageProps;
}

/** "Misa Minggu: 06:00, 09:00, 17:00 · Misa Sabtu: 17:00" */
function formatSchedules(schedules) {
  return (schedules || [])
    .filter((s) => s.status !== false && s.title)
    .map((s) => {
      const times = (s.time || []).map((t) => (t.start || '').trim()).filter(Boolean);
      return times.length ? `${s.title.trim()}: ${times.join(', ')}` : null;
    })
    .filter(Boolean)
    .join(' · ') || null;
}

function toRecord(church, path) {
  const regency = church.regencyName || church.regency?.name || null;
  const province = church.provinceName || church.province?.name || null;
  const { core, place } = splitChurchName(church.name);
  const street = cleanAddress(church.address);

  return {
    name: church.name.trim(),
    type: guessType(church.name),
    address: church.address || null,
    city: regency,
    province,
    phone: church.phone || null,
    email: church.email || null,
    misa: formatSchedules(church.schedules),
    source_url: `${BASE}/cari/${path}/${church.slug}`,
    geoQueries: [
      { q: `Gereja Katolik ${core} ${place || regency}`, church: true },
      { q: `Gereja ${core} ${regency}`, church: true },
      { q: church.name.replace(/\s+[-–]\s+/, ' '), church: true },
      street, // terakhir: posisi jalan, lebih kasar tapi masih mendekati
    ],
    geoCheck: { name: core, region: `${regency || ''} ${place}` },
  };
}

async function main() {
  const regencies = await fetchRegencyPages();
  const records = [];

  for (const [i, { path, url }] of regencies.entries()) {
    if (limit && records.length >= limit) break;
    try {
      const { data } = readNextData(await fetchText(url));
      const churches = (data || []).filter((c) => c.status !== false && c.name);
      console.log(`[${i + 1}/${regencies.length}] ${path}: ${churches.length} gereja`);
      for (const c of churches) records.push(toRecord(c, path));
    } catch (e) {
      console.warn(`  Error ${path}:`, e.message);
    }
    await SLEEP(1500); // sopan ke server
  }

  await importRecords(SOURCE, limit ? records.slice(0, limit) : records, { dryRun });
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});

/**
 * Scraper untuk ekatolik.com/jadwal-misa
 *
 * STRUKTUR SITUS (dicek Oktober 2026):
 *   - Daftar gereja ada di /jadwal-misa/sitemap.xml. URL /jadwal-misa/<slug> adalah
 *     halaman gereja; /jadwal-misa/kota/<kota> hanya halaman daftar (dilewati).
 *   - Halaman gereja dirender di server:
 *       <header><p>Gereja Katolik di Medan</p><h1>Paroki Kristus Raja</h1></header>
 *       <article>
 *         <h2>Misa Harian</h2> <p>Pagi 6.00</p> ...
 *         <dl><div><dt>Alamat</dt><dd>...</dd></div><div><dt>Telepon</dt>...</dl>
 *       </article>
 *
 * Jalankan:           node scripts/scrape-ekatolik.js
 * Uji 10 gereja:      node scripts/scrape-ekatolik.js --limit=10
 * Lihat hasil parse:  node scripts/scrape-ekatolik.js --limit=10 --dry-run
 */

const cheerio = require('cheerio');
const {
  fetchText, cleanAddress, splitChurchName, guessType, importRecords, parseArgs, SLEEP,
} = require('./lib/scraper-common');

const SOURCE = 'ekatolik.com';
const BASE = 'https://ekatolik.com';
const { limit, dryRun } = parseArgs();

async function fetchList() {
  console.log('[ekatolik] Ambil sitemap jadwal misa...');
  const xml = await fetchText(BASE + '/jadwal-misa/sitemap.xml');
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
    .map((m) => m[1])
    .filter((u) => /\/jadwal-misa\/[^/]+$/.test(u)); // buang /jadwal-misa/kota/<kota>
  console.log(`[ekatolik] ${urls.length} halaman gereja`);
  return urls;
}

const text = ($el) => $el.text().replace(/\s+/g, ' ').trim();

async function scrapeDetail(url) {
  const $ = cheerio.load(await fetchText(url));
  const name = text($('h1').first());
  if (!name) return null;

  const city = text($('header p').first()).replace(/^gereja katolik di\s+/i, '') || null;

  const fields = {};
  $('article dl > div').each((_, el) => {
    fields[text($(el).find('dt')).toLowerCase()] = text($(el).find('dd'));
  });

  const misa = $('article h2')
    .map((_, h2) => {
      const times = $(h2)
        .nextUntil('h2', 'p')
        .filter((_, p) => !$(p).find('em').length) // catatan "Jadwal misa dapat berubah..."
        .map((_, p) => text($(p)))
        .get()
        .filter(Boolean);
      return times.length ? `${text($(h2))}: ${times.join(', ')}` : null;
    })
    .get()
    .join(' · ');

  const address = fields.alamat || null;
  const { core } = splitChurchName(name);
  return {
    name,
    type: guessType(name + ' ' + url),
    address,
    city,
    phone: fields.telepon || null,
    email: fields.email || null,
    website: fields.website || null,
    misa: misa || null,
    source_url: url,
    geoQueries: [
      { q: `Gereja Katolik ${core} ${city || ''}`, church: true },
      { q: `${name} ${city || ''}`, church: true },
      cleanAddress(address),
    ],
    geoCheck: { name: core, region: city },
  };
}

async function main() {
  let urls = await fetchList();
  if (limit) urls = urls.slice(0, limit);

  const records = [];
  for (const [i, url] of urls.entries()) {
    try {
      const rec = await scrapeDetail(url);
      console.log(`[${i + 1}/${urls.length}] ${rec ? rec.name : '(tanpa nama, dilewati)'}`);
      if (rec) records.push(rec);
    } catch (e) {
      console.warn(`  Error ${url}:`, e.message);
    }
    await SLEEP(1500); // sopan ke server
  }

  await importRecords(SOURCE, records, { dryRun });
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});

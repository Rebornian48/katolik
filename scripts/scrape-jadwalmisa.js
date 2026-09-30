/**
 * Scraper untuk jadwalmisa.id
 *
 * PENDEKATAN:
 *   1. Ambil halaman index (daftar paroki per keuskupan)
 *   2. Untuk setiap paroki, ambil detail page → parsing nama, alamat, jadwal misa
 *   3. Geocode alamat pakai Nominatim untuk mendapat koordinat
 *   4. Upsert ke SQLite
 *
 * CATATAN:
 *   - Struktur HTML jadwalmisa.id bisa berubah — sesuaikan selector di bawah bila perlu.
 *   - Kecepatan dibatasi ke ~1-2 req/detik supaya sopan.
 *
 * Jalankan: node scripts/scrape-jadwalmisa.js
 * Debug 1 keuskupan saja:  node scripts/scrape-jadwalmisa.js --limit=10
 */

const cheerio = require('cheerio');
const { fetchText, geocode, upsertLocation, logScrapeStart, logScrapeFinish, SLEEP } = require('./lib/scraper-common');

const SOURCE = 'jadwalmisa.id';
const BASE = 'https://jadwalmisa.id';
const LIMIT = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '0', 10);

async function fetchDioceseList() {
  console.log(`[jadwalmisa] Ambil daftar keuskupan...`);
  // Halaman keuskupan biasanya berupa link ke /gereja?keuskupan=xxx atau /paroki
  // Sesuaikan URL ini setelah inspect situs; ini contoh struktur umum.
  const html = await fetchText(BASE + '/paroki');
  const $ = cheerio.load(html);

  const parishes = [];
  // TODO: sesuaikan selector berikut dengan struktur asli jadwalmisa.id
  $('a[href*="/paroki/"]').each((_, el) => {
    const href = $(el).attr('href');
    const name = $(el).text().trim();
    if (href && name) {
      parishes.push({
        url: href.startsWith('http') ? href : BASE + href,
        name,
      });
    }
  });

  console.log(`[jadwalmisa] Ditemukan ${parishes.length} paroki di index`);
  return parishes;
}

async function scrapeParishDetail(url) {
  const html = await fetchText(url);
  const $ = cheerio.load(html);

  // TODO: sesuaikan selector - ini template umum
  const name = $('h1, .paroki-name').first().text().trim();
  const address = $('[itemprop="address"], .alamat, .address').first().text().trim();
  const diocese = $('.keuskupan, [data-keuskupan]').first().text().trim();
  const misaRows = [];

  $('.jadwal-misa li, .schedule-item').each((_, el) => {
    const t = $(el).text().trim();
    if (t) misaRows.push(t);
  });

  return {
    name,
    address,
    diocese: diocese || null,
    misa: misaRows.length ? misaRows.join(' · ') : null,
    source: SOURCE,
    source_url: url,
  };
}

async function main() {
  const logId = logScrapeStart(SOURCE);
  const stats = { added: 0, updated: 0, skipped: 0 };

  try {
    let parishes = await fetchDioceseList();
    if (LIMIT > 0) parishes = parishes.slice(0, LIMIT);

    for (const [i, p] of parishes.entries()) {
      console.log(`[${i + 1}/${parishes.length}] ${p.name}`);
      try {
        const detail = await scrapeParishDetail(p.url);
        if (!detail.name) { stats.skipped++; continue; }

        // Geocode
        const geo = await geocode(detail.address + ', ' + detail.name);
        if (!geo) { stats.skipped++; console.log('  (skip: gagal geocode)'); continue; }

        detail.lat = geo.lat;
        detail.lng = geo.lng;
        detail.type = 'Paroki';

        const r = upsertLocation(detail);
        if (r.added) stats.added++;
        else if (r.updated) stats.updated++;
        else stats.skipped++;

        await SLEEP(1500);  // sopan ke server
      } catch (e) {
        console.warn('  Error:', e.message);
        stats.skipped++;
      }
    }

    logScrapeFinish(logId, stats);
    console.log('==============================');
    console.log(`Selesai. Added: ${stats.added}, Updated: ${stats.updated}, Skipped: ${stats.skipped}`);
  } catch (e) {
    logScrapeFinish(logId, stats, e);
    console.error('FATAL:', e);
    process.exit(1);
  }
}

main();

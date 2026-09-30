/**
 * Scraper untuk ekatolik.com/jadwal-misa
 * Pola sama dengan jadwalmisa.id.
 *
 * Jalankan: node scripts/scrape-ekatolik.js
 */

const cheerio = require('cheerio');
const { fetchText, geocode, upsertLocation, logScrapeStart, logScrapeFinish, SLEEP } = require('./lib/scraper-common');

const SOURCE = 'ekatolik.com';
const BASE = 'https://ekatolik.com';
const INDEX_URL = BASE + '/jadwal-misa';
const LIMIT = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '0', 10);

async function fetchList() {
  const html = await fetchText(INDEX_URL);
  const $ = cheerio.load(html);
  const items = [];
  // TODO: sesuaikan selector setelah inspect halaman asli
  $('a[href*="/gereja/"], a[href*="/paroki/"]').each((_, el) => {
    const href = $(el).attr('href');
    const name = $(el).text().trim();
    if (href && name) {
      items.push({ url: href.startsWith('http') ? href : BASE + href, name });
    }
  });
  return items;
}

async function scrapeDetail(url) {
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  return {
    name: $('h1').first().text().trim(),
    address: $('.address, .alamat, [itemprop="streetAddress"]').first().text().trim(),
    phone: $('.phone, .telepon, [itemprop="telephone"]').first().text().trim() || null,
    diocese: $('.keuskupan, [data-keuskupan]').first().text().trim() || null,
    misa: $('.jadwal-misa, .misa-list').text().trim().replace(/\s+/g, ' ') || null,
    source: SOURCE,
    source_url: url,
  };
}

async function main() {
  const logId = logScrapeStart(SOURCE);
  const stats = { added: 0, updated: 0, skipped: 0 };

  try {
    let items = await fetchList();
    if (LIMIT > 0) items = items.slice(0, LIMIT);
    console.log(`[ekatolik] ${items.length} item ditemukan`);

    for (const [i, item] of items.entries()) {
      console.log(`[${i + 1}/${items.length}] ${item.name}`);
      try {
        const detail = await scrapeDetail(item.url);
        if (!detail.name) { stats.skipped++; continue; }

        const geo = await geocode(detail.address + ', ' + detail.name);
        if (!geo) { stats.skipped++; continue; }

        detail.lat = geo.lat;
        detail.lng = geo.lng;
        detail.type = 'Paroki';

        const r = upsertLocation(detail);
        if (r.added) stats.added++;
        else if (r.updated) stats.updated++;
        else stats.skipped++;

        await SLEEP(1500);
      } catch (e) {
        console.warn('  Error:', e.message);
        stats.skipped++;
      }
    }

    logScrapeFinish(logId, stats);
    console.log(`Selesai. Added=${stats.added} Updated=${stats.updated} Skipped=${stats.skipped}`);
  } catch (e) {
    logScrapeFinish(logId, stats, e);
    console.error('FATAL:', e);
    process.exit(1);
  }
}

main();

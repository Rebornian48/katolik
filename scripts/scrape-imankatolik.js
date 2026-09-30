/**
 * Scraper untuk imankatolik.or.id/jadwalmisa.html
 *
 * Situs ini biasanya menampilkan jadwal misa dalam bentuk tabel per keuskupan.
 * Kita scrape tabel tersebut kolom demi kolom, lalu geocode alamat.
 *
 * Jalankan: node scripts/scrape-imankatolik.js
 */

const cheerio = require('cheerio');
const { fetchText, geocode, upsertLocation, logScrapeStart, logScrapeFinish, SLEEP } = require('./lib/scraper-common');

const SOURCE = 'imankatolik.or.id';
const URL = 'https://www.imankatolik.or.id/jadwalmisa.html';
const LIMIT = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '0', 10);

async function main() {
  const logId = logScrapeStart(SOURCE);
  const stats = { added: 0, updated: 0, skipped: 0 };

  try {
    console.log('[imankatolik] Fetch:', URL);
    const html = await fetchText(URL);
    const $ = cheerio.load(html);

    let rows = [];
    let currentDiocese = null;

    // Halaman biasanya menampilkan blok diocese di heading, lalu tabel di bawahnya
    // TODO: sesuaikan selector setelah inspect struktur HTML asli
    $('table tr').each((_, tr) => {
      const cells = $(tr).find('td');
      if (cells.length >= 2) {
        const name = $(cells[0]).text().trim();
        const address = $(cells[1]).text().trim();
        const misa = cells.length > 2 ? $(cells[2]).text().trim() : null;
        if (name && address) {
          rows.push({ name, address, misa, diocese: currentDiocese });
        }
      } else {
        // Deteksi header keuskupan
        const header = $(tr).find('th, .diocese-header').text().trim();
        if (header && /keuskupan/i.test(header)) currentDiocese = header;
      }
    });

    if (LIMIT > 0) rows = rows.slice(0, LIMIT);
    console.log(`[imankatolik] ${rows.length} baris ditemukan`);

    for (const [i, r] of rows.entries()) {
      console.log(`[${i + 1}/${rows.length}] ${r.name}`);
      try {
        const geo = await geocode(r.address + ' ' + r.name);
        if (!geo) { stats.skipped++; continue; }

        const doc = {
          name: r.name,
          type: 'Paroki',
          address: r.address,
          diocese: r.diocese,
          misa: r.misa,
          lat: geo.lat,
          lng: geo.lng,
          source: SOURCE,
          source_url: URL,
        };

        const res = upsertLocation(doc);
        if (res.added) stats.added++;
        else if (res.updated) stats.updated++;
        else stats.skipped++;

        await SLEEP(1200);
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

/**
 * Scraper untuk imankatolik.or.id
 *
 * STRUKTUR SITUS (dicek Oktober 2026):
 *   - jadwalmisa.html hanya menu ke 6 halaman regio (rsum.html, jawa.html, ...).
 *     Setiap halaman regio memuat menu ke SEMUA 37 keuskupan (medan.html, kaj.html, ...).
 *   - Halaman keuskupan berisi tabel per paroki. Beberapa keuskupan (mis. KAS)
 *     memecah lagi per kevikepan (vikep_Kedu.html, ...), jadi bila halaman
 *     keuskupan tidak berisi tabel, link turunannya ikut dibuka.
 *   - Format tabel per paroki (HTML lama, encoding iso-8859-1):
 *       | Paroki                      | Jadwal Misa          |
 *       | Aek Kanopan - Pius X        | Harian       | : | 06.00 WIB |
 *       | Aek Kanopan                 | Minggu       | : | 08.00 WIB |
 *     Baris pertama kolom kiri = nama, baris kedua = wilayah. Di KAJ formatnya
 *     terbalik: "Paroki Cilincing" lalu "Salib Suci" (nama pelindung).
 *   - Banyak paroki tidak mencantumkan jam misa; kolom misa dibiarkan kosong.
 *   - Tidak ada alamat maupun koordinat; geocoding hanya dari nama + wilayah,
 *     sehingga persentase yang ditemukan lebih rendah dibanding sumber lain.
 *
 * Jalankan:           node scripts/scrape-imankatolik.js
 * Uji 10 paroki:      node scripts/scrape-imankatolik.js --limit=10
 * Lihat hasil parse:  node scripts/scrape-imankatolik.js --limit=10 --dry-run
 */

const cheerio = require('cheerio');
const { fetchText, guessType, importRecords, parseArgs, SLEEP } = require('./lib/scraper-common');

const SOURCE = 'imankatolik.or.id';
const BASE = 'https://www.imankatolik.or.id/';
const { limit, dryRun } = parseArgs();

const fetchPage = (url) => fetchText(url, { encoding: 'latin1' });
const clean = (s) => (s || '').replace(/[\s ]+/g, ' ').trim();
const absolute = (href) => new URL(href.trim(), BASE).href;

/** Daftar keuskupan diambil dari menu di halaman regio. */
async function fetchDioceses() {
  const $ = cheerio.load(await fetchPage(BASE + 'rsum.html'));
  const menuLinks = new Set();
  const dioceses = new Map();
  $('a[href]').each((_, a) => {
    const url = absolute($(a).attr('href'));
    menuLinks.add(url);
    const name = clean($(a).text());
    if (/^keuskupan/i.test(name) && !dioceses.has(url)) {
      dioceses.set(url, name.replace(/\s+sufragan\s+/i, ' '));
    }
  });
  console.log(`[imankatolik] ${dioceses.size} keuskupan`);
  return { dioceses: [...dioceses].map(([url, name]) => ({ url, name })), menuLinks };
}

/** Ambil blok tabel per paroki: { lines: [nama, wilayah, ...], rows: [[label, jam], ...] } */
function parseParishTables($) {
  const blocks = [];
  let cur = null;
  $('tr').each((_, tr) => {
    const tds = $(tr).children('td');
    if (tds.find('table').length) return; // baris pembungkus layout
    const cells = tds.map((_, td) => clean($(td).text())).get();
    if (/^paroki$/i.test(cells[0] || '') && /jadwal misa/i.test(cells[1] || '')) {
      cur = { lines: [], rows: [] };
      blocks.push(cur);
      return;
    }
    if (!cur || cells.length < 2) return;
    if (cells[0]) cur.lines.push(cells[0]);
    const label = cells[1];
    const time = clean(cells.slice(2).join(' ').replace(/^:/, ''));
    if (time) {
      // baris tanpa label = lanjutan jadwal di atasnya (mis. "17.30 WIB (sore)")
      const prev = cur.rows[cur.rows.length - 1];
      if (!label && prev) prev[1] += ', ' + time;
      else cur.rows.push([label, time]);
    }
  });
  return blocks.filter((b) => b.lines.length);
}

const expandSaint = (s) =>
  s.replace(/\bSt\.?\s+/g, 'Santo ').replace(/\bSta\.?\s+/g, 'Santa ').replace(/\bSto\.?\s+/g, 'Santo ');

// Kata yang menandakan nama pelindung gereja (bukan nama tempat)
const SAINT = /\b(St|Sto|Sta|Santo|Santa|Santu|Maria|Yesus|Kristus|Hati|Keluarga|Roh|Salib|Ratu|Bunda|Raja|Gembala|Tritunggal|Petrus|Paulus|Yosef|Yusuf|Joseph|Fransiskus|Theresia|Mikael|Antonius)\b/i;

/** "A - B" -> ['A', 'B'] (toleran terhadap spasi yang hilang: "Bajawa I- St. Maria") */
function splitDash(s) {
  const m = s.match(/^(.*?)\s*-\s+(.*)$|^(.*?)\s+-\s*(.*)$/);
  return m ? [clean(m[1] ?? m[3]), clean(m[2] ?? m[4])] : null;
}

/**
 * Halaman ini memakai beberapa format nama:
 *   Medan/KAS/dll : "Aek Kanopan - Pius X"        / "Aek Kanopan"           (tempat - pelindung / wilayah)
 *   Manado        : "Karombasan"                   / "Hati Kudus Yesus - Manado" (tempat / pelindung - kota)
 *   KAJ           : "Paroki Cilincing"             / "Salib Suci"            (tempat / pelindung)
 */
function parseNameLines(first, area) {
  const areaDash = splitDash(area);
  if (areaDash && SAINT.test(areaDash[0])) {
    const place = /^(katedral|paroki)$/i.test(first) || first === areaDash[0] ? areaDash[1] : first;
    return { place, saint: areaDash[0], city: areaDash[1] };
  }
  const firstDash = splitDash(first);
  if (firstDash) {
    // "Surabaya (Kenjean)" -> "Kenjean Surabaya"
    const place = firstDash[0].replace(/^(.*?)\s*\((.*)\)\s*$/, '$2 $1');
    return { place: clean(place), saint: firstDash[1], city: area };
  }
  if (/^paroki\s+/i.test(first) && area) {
    const place = first.replace(/^paroki\s+/i, '');
    return { place, saint: area, city: place };
  }
  // KAS DIY: "St. Franciscus Xaverius" / "Kidul Loji"
  const areaInName = !area || first.toLowerCase().includes(area.toLowerCase());
  return { place: areaInName ? '' : area, saint: first, city: area };
}

function toRecord(block, diocese, pageUrl) {
  const [first, area = ''] = block.lines;
  const { place, saint, city: rawCity } = parseNameLines(first, area);

  const type = guessType(`${first} ${saint}`);
  let name = clean(`${saint} ${place}`);
  if (type === 'Paroki' && !/^paroki\b/i.test(name)) name = 'Paroki ' + name;
  if (type === 'Katedral' && !/katedral/i.test(name)) name = 'Katedral ' + name;

  const city = clean(rawCity) || place || null;
  return {
    name,
    type,
    city,
    diocese: diocese.name,
    misa: [...new Set(block.rows.map(([label, time]) => (label ? `${label}: ${time}` : time)))].join(' · ') || null,
    // satu halaman berisi banyak paroki; tambahkan nama supaya source_url unik
    source_url: `${pageUrl}#${encodeURIComponent(name)}`,
    geoQueries: [
      { q: `Gereja Katolik ${expandSaint(saint)} ${place || city}`, church: true },
      { q: `Gereja ${saint} ${city}`, church: true },
      place && { q: `Gereja Katolik ${place}`, church: true },
    ].filter(Boolean),
    geoCheck: { name: saint, region: `${place} ${city || ''}` },
  };
}

async function main() {
  const { dioceses, menuLinks } = await fetchDioceses();
  const records = [];

  for (const [i, diocese] of dioceses.entries()) {
    if (limit && records.length >= limit) break;
    try {
      const $ = cheerio.load(await fetchPage(diocese.url));
      let pages = [{ url: diocese.url, $ }];

      if (!parseParishTables($).length) {
        // Tidak ada tabel: jadwal dipecah per kevikepan/dekenat
        // (KAS: vikep_Kedu.html, Manado: kevikepan_tonsea.htm, ...)
        const subUrls = [...new Set(
          $('a[href]')
            .filter((_, a) => /(ke)?vikep|dekenat|dekanat/i.test($(a).attr('href') + ' ' + $(a).text()))
            .map((_, a) => absolute($(a).attr('href')))
            .get(),
        )].filter((u) => !menuLinks.has(u) && u.startsWith(BASE));
        pages = [];
        for (const url of subUrls) {
          await SLEEP(1200);
          try {
            pages.push({ url, $: cheerio.load(await fetchPage(url)) });
          } catch (e) {
            console.warn(`  Error ${url}:`, e.message);
          }
        }
      }

      let count = 0;
      for (const page of pages) {
        for (const block of parseParishTables(page.$)) {
          records.push(toRecord(block, diocese, page.url));
          count++;
        }
      }
      console.log(`[${i + 1}/${dioceses.length}] ${diocese.name}: ${count} paroki`);
    } catch (e) {
      console.warn(`  Error ${diocese.name}:`, e.message);
    }
    await SLEEP(1200); // sopan ke server
  }

  await importRecords(SOURCE, limit ? records.slice(0, limit) : records, { dryRun });
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});

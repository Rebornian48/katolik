/**
 * Antrian lokasi tanpa koordinat: daftar + filter + lewati/kembalikan.
 * Filter disimpan di sessionStorage supaya halaman edit bisa lanjut ke
 * entri berikutnya dengan filter yang sama ("Simpan & berikutnya").
 */

const PAGE_SIZE = 50;

const searchInput = document.getElementById('searchInput');
const filterStatus = document.getElementById('filterStatus');
const filterSource = document.getElementById('filterSource');
const tableBody = document.getElementById('tableBody');
const statsEl = document.getElementById('stats');
const pagerInfo = document.getElementById('pagerInfo');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const userInfoEl = document.getElementById('userInfo');
const logoutBtn = document.getElementById('logoutBtn');

const filter = loadFilter();
let offset = filter.offset || 0;
let total = 0;

// ---------- Auth ----------
async function loadUser() {
  const res = await fetch('/admin/me');
  if (!res.ok) {
    window.location.href = '/admin/login';
    return null;
  }
  const user = await res.json();
  userInfoEl.textContent = `👤 ${user.username}`;
  return user;
}

logoutBtn.addEventListener('click', async () => {
  await fetch('/admin/logout', { method: 'POST' });
  window.location.href = '/admin/login';
});

// ---------- Filter (disimpan per tab browser) ----------
function loadFilter() {
  try {
    return JSON.parse(sessionStorage.getItem('queueFilter')) || {};
  } catch (e) {
    return {};
  }
}

function saveFilter() {
  try {
    sessionStorage.setItem('queueFilter', JSON.stringify({ ...filter, offset }));
  } catch (e) { /* sessionStorage tidak tersedia: filter tidak diingat */ }
}

// ---------- Data ----------
async function loadQueue() {
  tableBody.innerHTML = '<tr><td colspan="6" class="loading-row">Memuat data...</td></tr>';
  const params = new URLSearchParams({ status: filter.status || 'pending', limit: PAGE_SIZE, offset });
  if (filter.q) params.set('q', filter.q);
  if (filter.source) params.set('source', filter.source);

  const res = await fetch(`/api/queue?${params}`);
  if (res.status === 401) return (window.location.href = '/admin/login');
  const data = await res.json();
  total = data.total;

  renderStats(data.counts);
  renderSources(data.sources);
  renderTable(data.data);

  const from = total ? offset + 1 : 0;
  pagerInfo.textContent = `${from}–${offset + data.data.length} dari ${total}`;
  prevBtn.disabled = offset === 0;
  nextBtn.disabled = offset + PAGE_SIZE >= total;
  saveFilter();
}

function renderStats(counts) {
  const cards = [
    { label: 'Menunggu', value: counts.pending },
    { label: 'Selesai', value: counts.done },
    { label: 'Dilewati', value: counts.skipped },
  ];
  statsEl.innerHTML = cards
    .map((c) => `<div class="stat-card"><div class="stat-label">${c.label}</div><div class="stat-value">${c.value.toLocaleString('id-ID')}</div></div>`)
    .join('');
}

function renderSources(sources) {
  if (filterSource.options.length > 1) return;
  filterSource.innerHTML = '<option value="">Semua Sumber</option>' +
    sources.map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
  filterSource.value = filter.source || '';
}

function renderTable(rows) {
  if (!rows.length) {
    const empty = filter.status === 'done' ? 'Belum ada entri yang selesai.' :
      filter.status === 'skipped' ? 'Tidak ada entri yang dilewati.' : 'Antrian kosong. 🎉';
    tableBody.innerHTML = `<tr><td colspan="6" class="loading-row">${empty}</td></tr>`;
    return;
  }

  tableBody.innerHTML = rows.map((r) => {
    const place = r.city && r.diocese
      ? `${escapeHtml(r.city)}<br><small class="muted">${escapeHtml(r.diocese)}</small>`
      : escapeHtml(r.city || r.diocese);
    let actions;
    if (r.status === 'done') {
      actions = r.location_id
        ? `<a href="/admin/edit/${r.location_id}" class="btn btn-ghost btn-sm">✏️ Lihat lokasi</a>`
        : '<span class="muted">Selesai</span>';
    } else {
      actions = `<a href="/admin/edit?queue=${r.id}" class="btn btn-primary btn-sm">📍 Tentukan Lokasi</a>` +
        (r.status === 'pending'
          ? `<button class="btn btn-ghost btn-sm" data-id="${r.id}" data-status="skipped" title="Sembunyikan dari antrian (mis. sudah tutup / bukan gereja)">Lewati</button>`
          : `<button class="btn btn-ghost btn-sm" data-id="${r.id}" data-status="pending">Kembalikan</button>`);
    }
    return `<tr>
      <td><strong>${escapeHtml(r.name)}</strong>${r.address ? `<br><small class="muted">${escapeHtml(r.address)}</small>` : ''}</td>
      <td><span class="badge badge-${escapeAttr(r.type)}">${escapeHtml(r.type)}</span></td>
      <td>${place || '-'}</td>
      <td>${r.source_url ? `<a href="${escapeAttr(safeUrl(r.source_url))}" target="_blank" rel="noopener">${escapeHtml(r.source || 'sumber')}</a>` : escapeHtml(r.source || '-')}</td>
      <td>${r.misa ? '<span title="Ada jadwal misa">✓</span>' : '<span class="muted">-</span>'}</td>
      <td class="actions-cell">${actions}</td>
    </tr>`;
  }).join('');

  tableBody.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => setStatus(btn.dataset.id, btn.dataset.status));
  });
}

async function setStatus(id, status) {
  const res = await fetch(`/api/queue/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) return alert((await res.json()).error || 'Gagal mengubah status');
  // Halaman jadi kosong setelah entri terakhirnya dipindah: mundur satu halaman
  if (offset > 0 && offset >= total - 1) offset = Math.max(0, offset - PAGE_SIZE);
  loadQueue();
}

// ---------- Filters & paging ----------
let searchTimeout;
searchInput.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    filter.q = e.target.value.trim();
    offset = 0;
    loadQueue();
  }, 300);
});
filterStatus.addEventListener('change', (e) => {
  filter.status = e.target.value;
  offset = 0;
  loadQueue();
});
filterSource.addEventListener('change', (e) => {
  filter.source = e.target.value;
  offset = 0;
  loadQueue();
});
prevBtn.addEventListener('click', () => { offset = Math.max(0, offset - PAGE_SIZE); loadQueue(); });
nextBtn.addEventListener('click', () => { offset += PAGE_SIZE; loadQueue(); });

// ---------- Utils ----------
function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/`/g, '&#96;');
}
// Hanya izinkan link http(s) dari data hasil scraping
function safeUrl(url) {
  return /^https?:\/\//i.test(url) ? url : '#';
}

// ---------- Init ----------
(async function () {
  if (!(await loadUser())) return;
  searchInput.value = filter.q || '';
  filterStatus.value = filter.status || 'pending';
  loadQueue();
})();

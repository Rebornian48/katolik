/**
 * Admin dashboard: list + filter + delete.
 */

const searchInput = document.getElementById('searchInput');
const filterType = document.getElementById('filterType');
const filterProvince = document.getElementById('filterProvince');
const tableBody = document.getElementById('tableBody');
const statsEl = document.getElementById('stats');
const pagerInfo = document.getElementById('pagerInfo');
const userInfoEl = document.getElementById('userInfo');
const logoutBtn = document.getElementById('logoutBtn');
const changePassBtn = document.getElementById('changePassBtn');
const pwModal = document.getElementById('pwModal');
const pwForm = document.getElementById('pwForm');
const pwCancel = document.getElementById('pwCancel');
const pwError = document.getElementById('pwError');

let allLocations = [];
let currentSearch = '';
let currentType = '';
let currentProvince = '';

// ---------- Auth ----------
async function loadUser() {
  try {
    const res = await fetch('/admin/me');
    if (!res.ok) {
      window.location.href = '/admin/login';
      return null;
    }
    const user = await res.json();
    userInfoEl.textContent = `👤 ${user.username}`;
    return user;
  } catch (e) {
    window.location.href = '/admin/login';
    return null;
  }
}

logoutBtn.addEventListener('click', async () => {
  await fetch('/admin/logout', { method: 'POST' });
  window.location.href = '/admin/login';
});

// ---------- Change password modal ----------
changePassBtn.addEventListener('click', () => {
  pwModal.style.display = 'flex';
  pwError.style.display = 'none';
  pwForm.reset();
});
pwCancel.addEventListener('click', () => (pwModal.style.display = 'none'));

pwForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  pwError.style.display = 'none';
  const oldPassword = document.getElementById('pwOld').value;
  const newPassword = document.getElementById('pwNew').value;

  const res = await fetch('/admin/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPassword, newPassword }),
  });
  const data = await res.json();

  if (res.ok) {
    pwModal.style.display = 'none';
    alert('Password berhasil diubah.');
  } else {
    pwError.textContent = data.error || 'Gagal mengubah password';
    pwError.style.display = 'block';
  }
});

// ---------- Data ----------
async function loadQueueCount() {
  const res = await fetch('/api/queue?limit=1');
  if (!res.ok) return;
  const { counts } = await res.json();
  if (counts.pending) {
    document.getElementById('queueLink').textContent = `📋 Antrian Lokasi (${counts.pending.toLocaleString('id-ID')})`;
  }
}

async function loadMeta() {
  const res = await fetch('/api/meta');
  const meta = await res.json();

  const typeMap = Object.fromEntries(meta.byType.map((t) => [t.type, t.n]));
  const cards = [
    { label: 'Total Aktif', value: meta.total },
    { label: 'Paroki', value: typeMap.Paroki || 0 },
    { label: 'Katedral', value: typeMap.Katedral || 0 },
    { label: 'Stasi', value: typeMap.Stasi || 0 },
    { label: 'Seminari', value: typeMap.Seminari || 0 },
    { label: 'Provinsi', value: meta.provinces.length },
    { label: 'Keuskupan', value: meta.dioceses.length },
  ];
  statsEl.innerHTML = cards
    .map((c) => `<div class="stat-card"><div class="stat-label">${c.label}</div><div class="stat-value">${c.value}</div></div>`)
    .join('');

  filterProvince.innerHTML =
    '<option value="">Semua Provinsi</option>' +
    meta.provinces.map((p) => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`).join('');
}

async function loadLocations() {
  tableBody.innerHTML = '<tr><td colspan="9" class="loading-row">Memuat data...</td></tr>';
  const params = new URLSearchParams();
  if (currentSearch) params.set('q', currentSearch);
  if (currentType) params.set('type', currentType);
  if (currentProvince) params.set('province', currentProvince);

  const res = await fetch(`/api/locations?${params}`);
  const data = await res.json();
  allLocations = data.data;
  renderTable();
  pagerInfo.textContent = `Menampilkan ${data.count} dari ${data.total} lokasi`;
}

function renderTable() {
  if (allLocations.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="9" class="loading-row">Tidak ada lokasi yang cocok.</td></tr>';
    return;
  }

  tableBody.innerHTML = allLocations
    .map((loc) => {
      const badge = loc.is_active
        ? `<span class="badge badge-${loc.type}">${loc.type}</span>`
        : `<span class="badge badge-inactive">${loc.type}</span>`;
      const status = loc.is_active
        ? '<span style="color:var(--success)">● Aktif</span>'
        : '<span style="color:var(--text-secondary)">○ Nonaktif</span>';

      return `<tr>
        <td>${loc.id}</td>
        <td><strong>${escapeHtml(loc.name)}</strong>${loc.pastor ? `<br><small style="color:var(--text-secondary)">${escapeHtml(loc.pastor)}</small>` : ''}</td>
        <td>${badge}</td>
        <td>${escapeHtml(loc.city || '-')}</td>
        <td>${escapeHtml(loc.province || '-')}</td>
        <td>${escapeHtml(loc.diocese || '-')}</td>
        <td><small>${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}</small></td>
        <td>${status}</td>
        <td class="actions-cell">
          <a href="/admin/edit/${loc.id}" class="btn btn-ghost btn-sm">✏️ Edit</a>
          <button class="btn btn-danger btn-sm" data-id="${loc.id}" data-name="${escapeAttr(loc.name)}">🗑️</button>
        </td>
      </tr>`;
    })
    .join('');

  tableBody.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => handleDelete(btn.dataset.id, btn.dataset.name));
  });
}

async function handleDelete(id, name) {
  if (!confirm(`Nonaktifkan "${name}"?\n\nLokasi akan disembunyikan dari peta publik (soft delete).\nData masih bisa dipulihkan.`)) {
    return;
  }
  const res = await fetch(`/api/locations/${id}`, { method: 'DELETE' });
  if (res.ok) {
    await loadLocations();
    await loadMeta();
  } else {
    alert('Gagal menghapus lokasi');
  }
}

// ---------- Filters ----------
let searchTimeout;
searchInput.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    currentSearch = e.target.value;
    loadLocations();
  }, 300);
});
filterType.addEventListener('change', (e) => {
  currentType = e.target.value;
  loadLocations();
});
filterProvince.addEventListener('change', (e) => {
  currentProvince = e.target.value;
  loadLocations();
});

// ---------- Utils ----------
function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/`/g, '&#96;');
}

// ---------- Init ----------
(async function () {
  const user = await loadUser();
  if (!user) return;
  await loadMeta();
  await loadLocations();
  loadQueueCount();
})();

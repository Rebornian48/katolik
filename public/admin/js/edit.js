/**
 * Admin editor lokasi: tambah/edit dengan map picker.
 *
 * Mode antrian (/admin/edit?queue=ID): form diisi dari entri antrian lokasi
 * tanpa koordinat. Peta diarahkan ke kotanya, marker baru muncul setelah admin
 * memilih titik, dan setelah disimpan entri antrian ditandai selesai.
 */

const pathParts = window.location.pathname.split('/').filter(Boolean);
const editId = pathParts[2] ? parseInt(pathParts[2], 10) : null;
const queueId = parseInt(new URLSearchParams(window.location.search).get('queue'), 10) || null;

const form = document.getElementById('editForm');
const pageTitle = document.getElementById('pageTitle');
const errorEl = document.getElementById('formError');
const successEl = document.getElementById('formSuccess');
const btnDelete = document.getElementById('btnDelete');
const btnSkip = document.getElementById('btnSkip');
const btnCancel = document.getElementById('btnCancel');
const btnSaveNext = document.getElementById('btnSaveNext');
const btnUseCurrentLoc = document.getElementById('btnUseCurrentLoc');
const btnGeocode = document.getElementById('btnGeocode');
const btnGmaps = document.getElementById('btnGmaps');
const btnPaste = document.getElementById('btnPaste');
const coordPaste = document.getElementById('coordPaste');
const queueBanner = document.getElementById('queueBanner');
const logoutBtn = document.getElementById('logoutBtn');
const inpLat = form.elements.lat;
const inpLng = form.elements.lng;

const FIELDS = ['name', 'type', 'pastor', 'address', 'city', 'province', 'diocese',
  'lat', 'lng', 'phone', 'email', 'website', 'misa', 'source', 'source_url'];

// Default center: Indonesia
let map, marker;

function initMap(lat = -2.5, lng = 118, zoom = 5, { showMarker = true } = {}) {
  map = L.map('mapPicker').setView([lat, lng], zoom);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
    attribution: '© Esri',
    maxZoom: 18,
  }).addTo(map);

  marker = L.marker([lat, lng], { draggable: true });
  if (showMarker) marker.addTo(map);
  marker.on('dragend', () => {
    const pos = marker.getLatLng();
    inpLat.value = pos.lat.toFixed(7);
    inpLng.value = pos.lng.toFixed(7);
  });

  map.on('click', (e) => setPoint(e.latlng.lat, e.latlng.lng, { pan: false }));
}

/** Pasang titik lokasi: isi lat/lng, pindahkan (dan tampilkan) marker. */
function setPoint(lat, lng, { pan = true, zoom = 16 } = {}) {
  inpLat.value = lat.toFixed(7);
  inpLng.value = lng.toFixed(7);
  marker.setLatLng([lat, lng]);
  if (!map.hasLayer(marker)) marker.addTo(map);
  if (pan) map.setView([lat, lng], Math.max(map.getZoom(), zoom));
}

inpLat.addEventListener('change', updateMarkerFromInputs);
inpLng.addEventListener('change', updateMarkerFromInputs);

function updateMarkerFromInputs() {
  const lat = parseFloat(inpLat.value);
  const lng = parseFloat(inpLng.value);
  if (isFinite(lat) && isFinite(lng) && marker) setPoint(lat, lng, { zoom: 13 });
}

// ---------- Tempel koordinat / link Google Maps ----------
/**
 * Terima "-6.1754, 106.8272" atau link Google Maps
 * (.../@-6.1754,106.8272,17z  atau  ...!3d-6.1754!4d106.8272  atau  ?q=-6.17,106.82).
 */
function parseCoords(text) {
  const t = (text || '').trim();
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, // titik tempat (lebih tepat dari pusat peta)
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      let lat = parseFloat(m[1]);
      let lng = parseFloat(m[2]);
      // Urutan tertukar ("106.8272, -6.1754"): untuk Indonesia lng selalu > 90
      if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) [lat, lng] = [lng, lat];
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

function applyPastedCoords() {
  const c = parseCoords(coordPaste.value);
  if (!c) return alert('Format tidak dikenali. Contoh: -6.1754, 106.8272 atau link Google Maps yang berisi koordinat.');
  setPoint(c.lat, c.lng);
  coordPaste.value = '';
}
btnPaste.addEventListener('click', applyPastedCoords);
coordPaste.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); applyPastedCoords(); }
});

// ---------- Link pencarian Google Maps (dibuka admin secara manual) ----------
function updateGmapsLink() {
  const v = (f) => form.elements[f].value.trim();
  const query = [v('name'), v('address') || v('city'), v('address') ? '' : v('province')].filter(Boolean).join(' ');
  btnGmaps.href = query
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
    : 'https://www.google.com/maps';
}
['name', 'address', 'city', 'province'].forEach((f) => form.elements[f].addEventListener('input', updateGmapsLink));

// Use current location
btnUseCurrentLoc.addEventListener('click', () => {
  if (!navigator.geolocation) return alert('Browser tidak mendukung geolocation');
  navigator.geolocation.getCurrentPosition(
    (pos) => setPoint(pos.coords.latitude, pos.coords.longitude, { zoom: 15 }),
    () => alert('Gagal mendapatkan lokasi'),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

// ---------- Geocode (via OSM Nominatim) ----------
async function geocodeQuery(text) {
  const q = encodeURIComponent(text + ', Indonesia');
  // Nominatim rate-limit ~1 req/detik; dipanggil dari browser admin.
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=id&q=${q}`, {
    headers: { 'Accept': 'application/json' },
  });
  const results = await res.json();
  return results.length ? { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) } : null;
}

btnGeocode.addEventListener('click', async () => {
  const address = form.elements.address.value.trim() ||
                  form.elements.city.value.trim() ||
                  form.elements.name.value.trim();
  if (!address) return alert('Isi dulu alamat, kota, atau nama.');
  try {
    const hit = await geocodeQuery(address);
    if (!hit) return alert('Alamat tidak ditemukan.');
    setPoint(hit.lat, hit.lng, { zoom: 15 });
  } catch (e) {
    alert('Gagal melakukan geocoding: ' + e.message);
  }
});

// Logout
logoutBtn.addEventListener('click', async () => {
  await fetch('/admin/logout', { method: 'POST' });
  window.location.href = '/admin/login';
});

function fillForm(data) {
  for (const field of FIELDS) {
    const el = form.elements[field];
    if (el && data[field] != null) el.value = data[field];
  }
}

// ---------- Antrian ----------
function queueFilter() {
  try {
    return JSON.parse(sessionStorage.getItem('queueFilter')) || {};
  } catch (e) {
    return {};
  }
}

/** Buka entri antrian berikutnya dengan filter yang sama seperti di daftar antrian. */
async function goToNextInQueue() {
  const f = queueFilter();
  const params = new URLSearchParams({ status: 'pending', limit: 1, offset: f.offset || 0 });
  if (f.q) params.set('q', f.q);
  if (f.source) params.set('source', f.source);
  let res = await (await fetch(`/api/queue?${params}`)).json();
  if (!res.data.length && params.get('offset') !== '0') {
    params.set('offset', 0);
    res = await (await fetch(`/api/queue?${params}`)).json();
  }
  window.location.href = res.data.length ? `/admin/edit?queue=${res.data[0].id}` : '/admin/antrian';
}

async function loadQueueEntry() {
  const res = await fetch('/api/queue/' + queueId);
  if (!res.ok) {
    alert('Entri antrian tidak ditemukan');
    window.location.href = '/admin/antrian';
    return;
  }
  const entry = await res.json();
  if (entry.status === 'done') {
    alert('Entri ini sudah dijadikan lokasi.');
    window.location.href = entry.location_id ? `/admin/edit/${entry.location_id}` : '/admin/antrian';
    return;
  }

  pageTitle.textContent = 'Tentukan Lokasi (Antrian #' + queueId + ')';
  btnCancel.href = '/admin/antrian';
  btnSaveNext.style.display = 'inline-flex';
  if (entry.status === 'pending') btnSkip.style.display = 'inline-flex';
  fillForm(entry);
  form.elements.is_active.value = '1';

  queueBanner.style.display = 'block';
  queueBanner.innerHTML =
    '📍 <strong>Klik titik gereja di peta</strong>, tempel koordinat dari Google Maps, atau pakai "Cari via Alamat". ' +
    'Periksa juga nama &amp; tipe sebelum menyimpan.' +
    (entry.source_url && /^https?:\/\//i.test(entry.source_url)
      ? ` <a href="${escapeAttr(entry.source_url)}" target="_blank" rel="noopener">Lihat sumber (${escapeHtml(entry.source || 'sumber')})</a>`
      : '');

  initMap(-2.5, 118, 5, { showMarker: false });
  updateGmapsLink();

  // Arahkan peta ke kotanya (hanya tampilan; titik tetap harus dipilih admin)
  const area = [entry.city, entry.province].filter(Boolean).join(', ') || entry.diocese;
  if (area) {
    try {
      const hit = await geocodeQuery(area);
      if (hit && !inpLat.value) map.setView([hit.lat, hit.lng], 13);
    } catch (e) { /* tetap di tampilan Indonesia */ }
  }
}

btnSkip.addEventListener('click', async () => {
  const res = await fetch('/api/queue/' + queueId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'skipped' }),
  });
  if (!res.ok) return alert((await res.json()).error || 'Gagal melewati entri');
  goToNextInQueue();
});

// ---------- Load data ----------
async function loadLocation() {
  if (queueId) return loadQueueEntry();

  if (!editId) {
    pageTitle.textContent = 'Tambah Lokasi';
    initMap();
    updateGmapsLink();
    return;
  }

  pageTitle.textContent = 'Edit Lokasi #' + editId;
  btnDelete.style.display = 'inline-flex';

  const res = await fetch('/api/locations/' + editId);
  if (!res.ok) {
    alert('Lokasi tidak ditemukan');
    window.location.href = '/admin';
    return;
  }
  const loc = await res.json();
  fillForm(loc);
  form.elements.is_active.value = loc.is_active ? '1' : '0';

  initMap(loc.lat, loc.lng, 15);
  updateGmapsLink();
}

// ---------- Submit ----------
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.style.display = 'none';
  successEl.style.display = 'none';
  const saveAndNext = e.submitter === btnSaveNext;

  const formData = new FormData(form);
  const payload = {};
  formData.forEach((v, k) => { payload[k] = v; });
  payload.is_active = payload.is_active === '1';
  payload.lat = parseFloat(payload.lat);
  payload.lng = parseFloat(payload.lng);
  if (queueId) payload.queue_id = queueId;

  const method = editId ? 'PUT' : 'POST';
  const url = editId ? '/api/locations/' + editId : '/api/locations';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  if (res.ok) {
    successEl.textContent = editId ? '✓ Perubahan disimpan' : '✓ Lokasi berhasil ditambahkan';
    successEl.style.display = 'block';
    if (queueId && saveAndNext) return goToNextInQueue();
    setTimeout(() => (window.location.href = queueId ? '/admin/antrian' : '/admin'), 700);
  } else {
    errorEl.innerHTML = escapeHtml(data.error || 'Gagal menyimpan') +
      (data.details ? '<br><small>' + data.details.map(escapeHtml).join('<br>') + '</small>' : '');
    errorEl.style.display = 'block';
  }
});

// Delete
btnDelete.addEventListener('click', async () => {
  if (!editId) return;
  const nama = form.elements.name.value;
  if (!confirm(`Hapus "${nama}"?\n\n(Soft delete — data disembunyikan, bisa diaktifkan lagi lewat edit.)`)) return;

  const res = await fetch('/api/locations/' + editId, { method: 'DELETE' });
  if (res.ok) window.location.href = '/admin';
  else alert('Gagal menghapus');
});

// ---------- Utils ----------
function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/`/g, '&#96;');
}

// Init
loadLocation();

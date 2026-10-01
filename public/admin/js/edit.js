/**
 * Admin editor lokasi: tambah/edit dengan map picker.
 */

const pathParts = window.location.pathname.split('/').filter(Boolean);
const editId = pathParts[2] ? parseInt(pathParts[2], 10) : null;

const form = document.getElementById('editForm');
const pageTitle = document.getElementById('pageTitle');
const errorEl = document.getElementById('formError');
const successEl = document.getElementById('formSuccess');
const btnDelete = document.getElementById('btnDelete');
const btnUseCurrentLoc = document.getElementById('btnUseCurrentLoc');
const btnGeocode = document.getElementById('btnGeocode');
const logoutBtn = document.getElementById('logoutBtn');
const inpLat = form.querySelector('input[name="lat"]');
const inpLng = form.querySelector('input[name="lng"]');

// Default center: Indonesia
let map, marker;

function initMap(lat = -2.5, lng = 118, zoom = 5) {
  map = L.map('mapPicker').setView([lat, lng], zoom);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
    attribution: '© Esri',
    maxZoom: 18,
  }).addTo(map);

  marker = L.marker([lat, lng], { draggable: true }).addTo(map);
  marker.on('dragend', () => {
    const pos = marker.getLatLng();
    inpLat.value = pos.lat.toFixed(7);
    inpLng.value = pos.lng.toFixed(7);
  });

  map.on('click', (e) => {
    marker.setLatLng(e.latlng);
    inpLat.value = e.latlng.lat.toFixed(7);
    inpLng.value = e.latlng.lng.toFixed(7);
  });
}

inpLat.addEventListener('change', updateMarkerFromInputs);
inpLng.addEventListener('change', updateMarkerFromInputs);

function updateMarkerFromInputs() {
  const lat = parseFloat(inpLat.value);
  const lng = parseFloat(inpLng.value);
  if (isFinite(lat) && isFinite(lng) && marker) {
    marker.setLatLng([lat, lng]);
    map.setView([lat, lng], Math.max(map.getZoom(), 13));
  }
}

// Use current location
btnUseCurrentLoc.addEventListener('click', () => {
  if (!navigator.geolocation) return alert('Browser tidak mendukung geolocation');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      inpLat.value = latitude.toFixed(7);
      inpLng.value = longitude.toFixed(7);
      marker.setLatLng([latitude, longitude]);
      map.setView([latitude, longitude], 15);
    },
    () => alert('Gagal mendapatkan lokasi'),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

// Geocode (via OSM Nominatim)
btnGeocode.addEventListener('click', async () => {
  const address = form.querySelector('input[name="address"]').value.trim() ||
                  form.querySelector('input[name="city"]').value.trim() ||
                  form.querySelector('input[name="name"]').value.trim();
  if (!address) return alert('Isi dulu alamat, kota, atau nama.');

  const q = encodeURIComponent(address + ', Indonesia');
  try {
    // NOTE: kalau di production Anda pakai domain sendiri, boleh langsung ke nominatim.openstreetmap.org
    // Untuk aman, panggilan tetap dari client. Nominatim rate-limit ~1 req/sec.
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`, {
      headers: { 'Accept': 'application/json' },
    });
    const results = await res.json();
    if (!results.length) return alert('Alamat tidak ditemukan.');
    const { lat, lon } = results[0];
    inpLat.value = parseFloat(lat).toFixed(7);
    inpLng.value = parseFloat(lon).toFixed(7);
    marker.setLatLng([lat, lon]);
    map.setView([lat, lon], 15);
  } catch (e) {
    alert('Gagal melakukan geocoding: ' + e.message);
  }
});

// Logout
logoutBtn.addEventListener('click', async () => {
  await fetch('/admin/logout', { method: 'POST' });
  window.location.href = '/admin/login';
});

// Load data (kalau edit)
async function loadLocation() {
  if (!editId) {
    pageTitle.textContent = 'Tambah Lokasi';
    initMap();
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

  for (const field of ['name','type','pastor','address','city','province','diocese',
                        'lat','lng','phone','email','website','misa','source','source_url']) {
    const el = form.querySelector(`[name="${field}"]`);
    if (el && loc[field] != null) el.value = loc[field];
  }
  form.querySelector('[name="is_active"]').value = loc.is_active ? '1' : '0';

  initMap(loc.lat, loc.lng, 15);
}

// Submit
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.style.display = 'none';
  successEl.style.display = 'none';

  const formData = new FormData(form);
  const payload = {};
  formData.forEach((v, k) => { payload[k] = v; });
  payload.is_active = payload.is_active === '1';
  payload.lat = parseFloat(payload.lat);
  payload.lng = parseFloat(payload.lng);

  const method = editId ? 'PUT' : 'POST';
  const url = editId ? '/api/locations/' + editId : '/api/locations';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  if (res.ok) {
    successEl.textContent = editId ? '✓ Berubahan disimpan' : '✓ Lokasi berhasil ditambahkan';
    successEl.style.display = 'block';
    setTimeout(() => (window.location.href = '/admin'), 700);
  } else {
    errorEl.innerHTML = (data.error || 'Gagal menyimpan') +
      (data.details ? '<br><small>' + data.details.join('<br>') + '</small>' : '');
    errorEl.style.display = 'block';
  }
});

// Delete
btnDelete.addEventListener('click', async () => {
  if (!editId) return;
  const nama = form.querySelector('[name="name"]').value;
  if (!confirm(`Hapus "${nama}"?\n\n(Soft delete — data disembunyikan, bisa diaktifkan lagi lewat edit.)`)) return;

  const res = await fetch('/api/locations/' + editId, { method: 'DELETE' });
  if (res.ok) window.location.href = '/admin';
  else alert('Gagal menghapus');
});

// Init
loadLocation();

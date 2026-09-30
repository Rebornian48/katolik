/* =====================================================
   Peta Paroki - App utama (dengan radius search)
   ===================================================== */

const typeConfig = {
  Paroki:    { color: "#2563eb", icon: "⛪" },
  Stasi:     { color: "#059669", icon: "🏠" },
  Seminari:  { color: "#7c3aed", icon: "🎓" },
  Sekolah:   { color: "#d97706", icon: "📚" },
  Katedral:  { color: "#dc2626", icon: "⛪" },
  Kapel:     { color: "#f59e0b", icon: "🕯️" },
  Biara:     { color: "#6366f1", icon: "🏛️" }
};

// State
let allLocations = [];
let filteredLocations = [];
let activeFilter = 'Semua';
let activeProvince = '';
let activeItem = null;
let nearbyMode = false;
let userLocation = null;
let radiusKm = 10;
let userMarker = null;
let radiusCircle = null;
const markers = {};

// DOM
const filtersEl = document.getElementById('filters');
const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const totalCountEl = document.getElementById('totalCount');
const searchEl = document.getElementById('search');
const sidebar = document.getElementById('sidebar');
const filterProvinceEl = document.getElementById('filterProvince');
const btnNearby = document.getElementById('btnNearby');
const btnClearNearby = document.getElementById('btnClearNearby');
const radiusSliderEl = document.getElementById('radiusSlider');
const radiusRange = document.getElementById('radiusRange');
const radiusValueEl = document.getElementById('radiusValue');
const radiusInfo = document.getElementById('radiusInfo');

// ---------- Map ----------
const map = L.map('map', { zoomControl: false }).setView([-2.5, 118], 5);
L.control.zoom({ position: 'topright' }).addTo(map);

const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19,
});
const cartoLight = L.tileLayer('https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '© OSM © CARTO', maxZoom: 20,
});
const cartoDark = L.tileLayer('https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '© OSM © CARTO', maxZoom: 20,
});
const cartoVoyager = L.tileLayer('https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  attribution: '© OSM © CARTO', maxZoom: 20,
});
const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: '© Esri', maxZoom: 18,
});
const esriTopo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
  attribution: '© Esri', maxZoom: 18,
});
cartoVoyager.addTo(map);
L.control.layers({
  "🗺️ CartoDB Voyager": cartoVoyager,
  "☀️ CartoDB Terang":  cartoLight,
  "🌙 CartoDB Gelap":   cartoDark,
  "🌍 OpenStreetMap":   osm,
  "🛰️ Esri Satelit":    esriSat,
  "⛰️ Esri Topografi":  esriTopo,
}, null, { position: 'topright', collapsed: true }).addTo(map);

// ---------- Marker & popup ----------
function createIcon(type) {
  const c = typeConfig[type]?.color || '#2563eb';
  return L.divIcon({
    className: '',
    html: `<div style="width:28px;height:28px;border-radius:50%;background:${c};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:13px">${typeConfig[type]?.icon || '⛪'}</div>`,
    iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -16],
  });
}

function popupHTML(loc) {
  const cfg = typeConfig[loc.type] || typeConfig.Paroki;
  const dist = loc.distance_km != null
    ? `<div class="popup-row" style="color:var(--accent);font-weight:600">📏 ${loc.distance_km.toFixed(1)} km dari Anda</div>` : '';
  let html = `<div class="popup-card">
    <span class="popup-badge" style="background:${cfg.color}15;color:${cfg.color}">${cfg.icon} ${loc.type}</span>
    <h3>${escapeHtml(loc.name)}</h3>
    ${dist}
    ${loc.pastor ? `<div class="popup-row"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><span>${escapeHtml(loc.pastor)}</span></div>` : ''}
    ${loc.address ? `<div class="popup-row"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg><span>${escapeHtml(loc.address)}${loc.city ? ', ' + escapeHtml(loc.city) : ''}</span></div>` : ''}
    ${loc.diocese ? `<div class="popup-row" style="font-size:11px;font-style:italic"><span>🏛️ ${escapeHtml(loc.diocese)}</span></div>` : ''}`;
  if (loc.phone && loc.phone !== '-') {
    html += `<div class="popup-row"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg><span><strong>${escapeHtml(loc.phone)}</strong></span></div>`;
  }
  if (loc.email && loc.email !== '-') {
    html += `<div class="popup-row">✉️ <span>${escapeHtml(loc.email)}</span></div>`;
  }
  if (loc.misa) {
    html += `<div class="popup-misa"><div style="font-size:11px;font-weight:700;margin-bottom:3px">Jadwal Misa:</div><div style="font-size:11px;line-height:1.5">${loc.misa.split(' · ').map(escapeHtml).join('<br>')}</div></div>`;
  }
  if (loc.website && loc.website !== '-') {
    const url = loc.website.startsWith('http') ? loc.website : `https://${loc.website}`;
    html += `<div class="popup-row" style="margin-top:6px">🔗 <a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="color:var(--accent)">${escapeHtml(loc.website)}</a></div>`;
  }
  html += `<div class="popup-coords">${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}</div></div>`;
  return html;
}

function addMarker(loc) {
  if (markers[loc.id]) return markers[loc.id];
  const m = L.marker([loc.lat, loc.lng], { icon: createIcon(loc.type) })
    .bindPopup(popupHTML(loc), { maxWidth: 300 });
  markers[loc.id] = m;
  return m;
}

// ---------- Filters ----------
function renderFilters() {
  const types = [...new Set(allLocations.map(l => l.type))].sort();
  filtersEl.innerHTML = '';
  ['Semua', ...types].forEach(t => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (activeFilter === t ? ' active' : '');
    const cfg = typeConfig[t];
    chip.textContent = t === 'Semua' ? `📍 Semua` : `${cfg?.icon || ''} ${t}`;
    chip.onclick = () => { activeFilter = t; renderFilters(); applyClientFilter(); };
    filtersEl.appendChild(chip);
  });
}

// ---------- List rendering ----------
function applyClientFilter() {
  const q = searchEl.value.toLowerCase().trim();

  filteredLocations = allLocations.filter(loc => {
    const matchType = activeFilter === 'Semua' || loc.type === activeFilter;
    const matchProv = !activeProvince || loc.province === activeProvince;
    const matchSearch = !q || (
      (loc.name || '').toLowerCase().includes(q) ||
      (loc.pastor || '').toLowerCase().includes(q) ||
      (loc.address || '').toLowerCase().includes(q) ||
      (loc.city || '').toLowerCase().includes(q) ||
      (loc.diocese || '').toLowerCase().includes(q)
    );
    return matchType && matchProv && matchSearch;
  });

  renderList();
}

function renderList() {
  countEl.textContent = `Menampilkan ${filteredLocations.length} dari ${allLocations.length} lokasi`;
  listEl.innerHTML = '';

  // Show/hide markers
  const shownIds = new Set(filteredLocations.map(l => l.id));
  allLocations.forEach(loc => {
    const m = markers[loc.id];
    if (!m) return;
    if (shownIds.has(loc.id)) m.addTo(map);
    else map.removeLayer(m);
  });

  filteredLocations.slice(0, 500).forEach(loc => {
    const cfg = typeConfig[loc.type] || typeConfig.Paroki;
    const item = document.createElement('div');
    item.className = 'location-item' + (activeItem === loc.id ? ' active' : '');
    const distHtml = loc.distance_km != null
      ? `<div class="address" style="color:var(--accent);font-weight:600">📏 ${loc.distance_km.toFixed(1)} km</div>` : '';
    const phoneHtml = loc.phone && loc.phone !== '-'
      ? `<div class="address" style="color:var(--accent);font-weight:600">📞 ${escapeHtml(loc.phone)}</div>` : '';
    item.innerHTML = `
      <div class="name"><span class="dot" style="background:${cfg.color}"></span>${escapeHtml(loc.name)}</div>
      ${loc.pastor ? `<div class="pastor">${escapeHtml(loc.pastor)}</div>` : ''}
      <div class="address">${escapeHtml((loc.city || '') + (loc.province ? ' · ' + loc.province : ''))}</div>
      ${distHtml}
      ${phoneHtml}
    `;
    item.onclick = () => {
      activeItem = loc.id;
      map.flyTo([loc.lat, loc.lng], 15, { duration: 0.8 });
      if (markers[loc.id]) markers[loc.id].openPopup();
      renderList();
      if (window.innerWidth <= 768) sidebar.classList.remove('open');
    };
    listEl.appendChild(item);
  });

  if (filteredLocations.length > 500) {
    const more = document.createElement('div');
    more.className = 'count-badge';
    more.style.padding = '10px 16px';
    more.textContent = `... dan ${filteredLocations.length - 500} lainnya. Persempit pencarian untuk melihat semua.`;
    listEl.appendChild(more);
  }

  // Fit bounds untuk hasil ≤ 20 marker (kecuali nearby mode yg punya framing sendiri)
  if (!nearbyMode && filteredLocations.length > 1 && filteredLocations.length <= 20) {
    const bounds = L.latLngBounds(filteredLocations.map(l => [l.lat, l.lng]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }
}

// ---------- Radius search ----------
btnNearby.addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('Browser Anda tidak mendukung geolocation.');
    return;
  }
  btnNearby.disabled = true;
  btnNearby.textContent = '📡 Menemukan lokasi...';

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      nearbyMode = true;
      btnNearby.style.display = 'none';
      btnClearNearby.style.display = 'inline-flex';
      radiusSliderEl.style.display = 'block';
      radiusInfo.style.display = 'block';
      await runNearbyQuery();
    },
    (err) => {
      btnNearby.disabled = false;
      btnNearby.textContent = '📍 Cari Sekitar Saya';
      alert('Gagal mendapatkan lokasi: ' + err.message);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
});

btnClearNearby.addEventListener('click', () => {
  nearbyMode = false;
  userLocation = null;
  btnNearby.disabled = false;
  btnNearby.style.display = 'inline-flex';
  btnNearby.textContent = '📍 Cari Sekitar Saya';
  btnClearNearby.style.display = 'none';
  radiusSliderEl.style.display = 'none';
  radiusInfo.style.display = 'none';
  if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
  if (radiusCircle) { map.removeLayer(radiusCircle); radiusCircle = null; }
  loadAllLocations();
});

radiusRange.addEventListener('input', (e) => {
  radiusKm = parseInt(e.target.value, 10);
  radiusValueEl.textContent = radiusKm;
});
radiusRange.addEventListener('change', async () => {
  if (nearbyMode) await runNearbyQuery();
});

async function runNearbyQuery() {
  radiusInfo.textContent = 'Mencari lokasi dalam radius ' + radiusKm + ' km...';
  const params = new URLSearchParams({
    lat: userLocation.lat, lng: userLocation.lng, radius: radiusKm,
  });
  const res = await fetch('/api/locations/nearby?' + params);
  const data = await res.json();

  allLocations = data.data;

  // Remove old markers not in result
  Object.keys(markers).forEach(id => { map.removeLayer(markers[id]); });
  Object.keys(markers).forEach(id => delete markers[id]);
  allLocations.forEach(loc => addMarker(loc));

  // User marker + radius circle
  if (userMarker) map.removeLayer(userMarker);
  if (radiusCircle) map.removeLayer(radiusCircle);

  userMarker = L.marker([userLocation.lat, userLocation.lng], {
    icon: L.divIcon({
      className: '',
      html: `<div style="width:20px;height:20px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 4px rgba(37,99,235,0.3);animation:pulse 2s infinite"></div>`,
      iconSize: [20, 20], iconAnchor: [10, 10],
    }),
  }).addTo(map).bindPopup('📍 Lokasi Anda');

  radiusCircle = L.circle([userLocation.lat, userLocation.lng], {
    radius: radiusKm * 1000,
    color: '#2563eb', weight: 2, fillColor: '#2563eb', fillOpacity: 0.05,
  }).addTo(map);

  // Fit
  const bounds = radiusCircle.getBounds();
  map.fitBounds(bounds, { padding: [30, 30] });

  radiusInfo.innerHTML = `✓ <strong>${data.count}</strong> lokasi dalam radius ${radiusKm} km`;
  applyClientFilter();

  btnNearby.disabled = false;
}

// ---------- Init & data loading ----------
async function loadMeta() {
  try {
    const res = await fetch('/api/meta');
    const meta = await res.json();
    totalCountEl.textContent = meta.total;

    filterProvinceEl.innerHTML =
      '<option value="">🇮🇩 Semua Provinsi</option>' +
      meta.provinces.map(p => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`).join('');
  } catch (e) { console.warn('Gagal load meta:', e); }
}

async function loadAllLocations() {
  try {
    const res = await fetch('/api/locations');
    const data = await res.json();
    allLocations = data.data;

    // Reset markers
    Object.keys(markers).forEach(id => map.removeLayer(markers[id]));
    Object.keys(markers).forEach(id => delete markers[id]);
    allLocations.forEach(loc => addMarker(loc));

    renderFilters();
    applyClientFilter();

    if (allLocations.length > 0 && !nearbyMode) {
      const bounds = L.latLngBounds(allLocations.map(l => [l.lat, l.lng]));
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  } catch (err) {
    countEl.textContent = 'Gagal memuat data. Coba refresh halaman.';
    console.error(err);
  }
}

// ---------- Utils ----------
function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
function escapeAttr(s) { return escapeHtml(s).replace(/`/g, '&#96;'); }

// ---------- Events ----------
searchEl.addEventListener('input', applyClientFilter);
filterProvinceEl.addEventListener('change', (e) => {
  activeProvince = e.target.value;
  applyClientFilter();
});
document.getElementById('mobileToggle').onclick = () => sidebar.classList.toggle('open');

// Start
(async () => {
  await loadMeta();
  await loadAllLocations();
})();

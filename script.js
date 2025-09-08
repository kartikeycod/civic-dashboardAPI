const SUPABASE_URL = 'https://yaowdmntsglocynggnwb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlhb3dkbW50c2dsb2N5bmdnbndiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTczNTIzNjUsImV4cCI6MjA3MjkyODM2NX0.mTEACBAYPLYpRGNEJMb19Ywb_KSd7RhRzPjUhCxJUtQ';

const { createClient } = supabase;
const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------- MAP SETUP ----------------
const map = L.map('mapContainer').setView([28.6139, 77.2090], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const markers = L.layerGroup().addTo(map);
const heat = L.heatLayer([], { radius: 25, blur: 15 }).addTo(map);

const SLA_DAYS = 7;

// ---------------- LOAD REPORTS ----------------
async function loadReports() {
  markers.clearLayers();

  try {
    let { data, error } = await supa
      .from('submissions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(2000);

    if (error) throw error;

    const points = [];

    data.forEach(r => {
      if (r.latitude && r.longitude) {
        const reportedDate = new Date(r.created_at);
        const now = new Date();
        const daysPassed = Math.floor((now - reportedDate) / (1000 * 60 * 60 * 24));
        const daysRemaining = Math.max(0, SLA_DAYS - daysPassed);

        const popup = `
          <b>${r.heading || r.city}</b><br>
          ${r.description || ''}<br>
          <b>Days Remaining:</b> ${daysRemaining}<br>
          <small>Reported: ${reportedDate.toLocaleString()}</small><br>
          <small><b>User:</b> ${r.email || "N/A"}</small>
        `;

        L.marker([r.latitude, r.longitude]).bindPopup(popup).addTo(markers);
        points.push([parseFloat(r.latitude), parseFloat(r.longitude), 1]);
      }
    });

    heat.setLatLngs(points);

  } catch (e) {
    alert('Error loading reports: ' + (e.message || e));
  }
}

// ---------------- MAP CLICK ----------------
map.on('click', e => {
  document.getElementById('lat').value = e.latlng.lat.toFixed(6);
  document.getElementById('lon').value = e.latlng.lng.toFixed(6);
});

// ---------------- SUBMIT REPORT ----------------
document.getElementById('submitBtn').addEventListener('click', async () => {
  const email = document.getElementById('user_email').value.trim();
  if (!email) {
    alert('Please enter your email first!');
    return;
  }

  const lat = parseFloat(document.getElementById('lat').value);
  const lon = parseFloat(document.getElementById('lon').value);
  if (!lat || !lon) { 
    alert('Click on map or enter Lat/Lon!');
    return; 
  }

  const payload = {
    email: email,
    city: document.getElementById('city').value,
    locality: document.getElementById('locality').value,
    latitude: lat,
    longitude: lon,
    heading: document.getElementById('report_type').value,
    description: document.getElementById('description').value
  };

  const { error } = await supa.from('submissions').insert([payload]);
  if (error) { 
    alert('Insert failed: ' + error.message);
    return; 
  }

  alert('Report submitted!');
  loadReports();
});

// ---------------- RELOAD BUTTON ----------------
document.getElementById('reloadBtn').addEventListener('click', loadReports);

// ---------------- SEARCH ----------------
async function goToLocation() {
  const city = document.getElementById('city').value;
  const locality = document.getElementById('locality').value;
  if (!city && !locality) { 
    alert('Enter city or locality'); 
    return; 
  }

  const query = encodeURIComponent(`${locality}, ${city}`);
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${query}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.length > 0) {
      const { lat, lon } = data[0];
      map.setView([parseFloat(lat), parseFloat(lon)], 14);
    } else {
      alert('Location not found!');
    }
  } catch (e) { 
    alert('Geocoding error: ' + e.message); 
  }
}

// ---------------- INITIAL LOAD ----------------
loadReports();

// Supabase Config
const SUPABASE_URL = 'https://zdtmxoetngldbtwhckym.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkdG14b2V0bmdsZGJ0d2hja3ltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2MTk3MjAsImV4cCI6MjA3MzE5NTcyMH0.tlhT6JSi-rv-NZhyCzQCaSgqZjSgOdc07h7E1bwlmMM';

const BUCKET_NAME = 'The images';

const { createClient } = supabase;
const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SLA_DAYS = 7;

// Leaflet Map Setup
const map = L.map('mapContainer').setView([28.6139, 77.2090], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const markers = L.layerGroup().addTo(map);
const heat = L.heatLayer([], { radius: 25, blur: 15 }).addTo(map);

// Image Preview Logic
const reportImageInput = document.getElementById('report_image');
const imagePreview = document.getElementById('imagePreview');
reportImageInput.addEventListener('change', function(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      imagePreview.src = e.target.result;
      imagePreview.style.display = 'block';
    };
    reader.readAsDataURL(file);
  } else {
    imagePreview.src = '';
    imagePreview.style.display = 'none';
  }
});

// Unique Report Number Generator & Up-front Display
let candidateReportNumber = null;
async function generateUniqueReportNumber() {
  for (let i = 0; i < 10; i++) {
    const candidate = Math.floor(1000000000 + Math.random() * 9000000000).toString();
    const { data, error } = await supa
      .from('submissions')
      .select('report_number')
      .eq('report_number', candidate);
    if (error) throw new Error("Error checking report number uniqueness: " + error.message);
    if (!data || data.length === 0) return candidate;
  }
  throw new Error("Failed to generate unique report number after many attempts.");
}

async function setCandidateReportNumber() {
  try {
    candidateReportNumber = await generateUniqueReportNumber();
    document.getElementById('reportNumberField').value = candidateReportNumber;
  } catch (err) {
    document.getElementById('reportNumberField').value = "Error!";
  }
}
setCandidateReportNumber(); // Call on load

// Image Upload Logic
async function uploadImage(file) {
  if (!file) throw new Error('No file selected');
  const ext = file.name.split('.').pop();
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { data, error } = await supa.storage.from(BUCKET_NAME).upload(filename, file);
  if (error) throw error;
  return `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(BUCKET_NAME)}/${encodeURIComponent(filename)}`;
}

// Load Reports & Update Map + Heatmap
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
        let popup = `<b>${r.heading || r.city || 'Issue'}</b><br>
            ${r.description || ''}<br>
            <b>Days Remaining:</b> ${daysRemaining}<br>
            <small>Reported: ${reportedDate.toLocaleString()}</small><br>
            <small><b>User:</b> ${r.email || "N/A"}</small><br>
            <small><b>Report #:</b> ${r.report_number || "N/A"}</small>`;
        if (r.image_url) 
          popup += `<br><img src="${r.image_url}" style="max-width:180px;max-height:150px;margin-top:6px;border-radius:8px;box-shadow:0 0 8px #8629b395;" />`;
        L.marker([r.latitude, r.longitude]).bindPopup(popup).addTo(markers);
        points.push([parseFloat(r.latitude), parseFloat(r.longitude), 1]);
      }
    });
    heat.setLatLngs(points);
  } catch (e) {
    alert('Error loading reports: ' + (e.message || e));
  }
}

// Map Click to Fill Coordinates
map.on('click', e => {
  document.getElementById('lat').value = e.latlng.lat.toFixed(6);
  document.getElementById('lon').value = e.latlng.lng.toFixed(6);
});

// Submit Report Handler
document.getElementById('submitBtn').addEventListener('click', async () => {
  const statusDiv = document.getElementById('submitStatus');
  statusDiv.textContent = "Submitting...";
  statusDiv.style.color = "#225af7";

  const email = document.getElementById('user_email').value.trim();
  const heading = document.getElementById('report_type').value;
  const description = document.getElementById('description').value;
  const ward = document.getElementById('ward').value;
  const lat = parseFloat(document.getElementById('lat').value);
  const lon = parseFloat(document.getElementById('lon').value);
  const city = document.getElementById('city').value;
  const locality = document.getElementById('locality').value;
  const file = reportImageInput.files[0];

  if (!email || !heading || !lat || !lon) {
    statusDiv.textContent = "Please fill all the required fields!";
    statusDiv.style.color = "#e23e29";
    return;
  }

  let reportNumber = candidateReportNumber;
  try {
    // Recheck uniqueness just before submission
    if (!reportNumber) reportNumber = await generateUniqueReportNumber();
  } catch (err) {
    statusDiv.textContent = "Error generating report number! Try again.";
    statusDiv.style.color = "#e23e29";
    return;
  }

  let image_url = null;
  try {
    if (file) {
      image_url = await uploadImage(file);
    }
  } catch (error) {
    statusDiv.textContent = "Image upload failed! " + (error.message || "");
    statusDiv.style.color = "#e23e29";
    return;
  }

  const payload = {
    email,
    heading,
    description,
    ward,
    latitude: lat,
    longitude: lon,
    city,
    locality,
    image_url,
    report_number: reportNumber,
  };

  const { error } = await supa.from('submissions').insert([payload]);
  if (error) {
    statusDiv.textContent = "Database insert failed: " + error.message;
    statusDiv.style.color = "#e23e29";
    return;
  }
  statusDiv.textContent = `Report submitted! Your report number is: ${reportNumber}`;
  statusDiv.style.color = "#10bb72";

  if (image_url) {
    statusDiv.innerHTML += `<div style="margin-top:8px;">
      <img src="${image_url}" alt="Uploaded" style="max-width:180px;max-height:120px;border-radius:7px;box-shadow:0 0 8px #7334e944"/>
    </div>`;
  }

  document.getElementById('formContainer').reset();
  imagePreview.src = '';
  imagePreview.style.display = 'none';

  setCandidateReportNumber(); // Generate new for next submission
  await loadReports();
});

// Reload Reports Button
document.getElementById('reloadBtn').addEventListener('click', loadReports);

// Location Search
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

// Auto Location Capture
document.getElementById('autoLocationBtn').addEventListener('click', function() {
  const button = this;
  button.textContent = "Getting Location...";
  button.disabled = true;

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      function(position) {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        document.getElementById('lat').value = lat.toFixed(6);
        document.getElementById('lon').value = lng.toFixed(6);
        map.setView([lat, lng], 15);
        button.textContent = "📍 Auto Capture Location";
        button.disabled = false;
      },
      function(error) {
        let errorMessage = "";
        switch(error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = "Location access denied by user."; break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = "Location information unavailable."; break;
          case error.TIMEOUT:
            errorMessage = "Location request timed out."; break;
          default:
            errorMessage = "An unknown error occurred."; break;
        }
        alert("Location Error: " + errorMessage);
        button.textContent = "📍 Auto Capture Location";
        button.disabled = false;
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  } else {
    alert("Geolocation is not supported by this browser.");
    button.textContent = "📍 Auto Capture Location";
    button.disabled = false;
  } 
});

// Initial Load
loadReports();

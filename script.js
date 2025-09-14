// Full updated JS file with Roboflow validation + perceptual-hash duplicate check

// Supabase Config
const SUPABASE_URL = 'https://zdtmxoetngldbtwhckym.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkdG14b2V0bmdsZGJ0d2hja3ltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2MTk3MjAsImV4cCI6MjA3MzE5NTcyMH0.tlhT6JSi-rv-NZhyCzQCaSgqZjSgOdc07h7E1bwlmMM';

const BUCKET_NAME = 'The images';

const { createClient } = supabase;
const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SLA_DAYS = 7;

// --- Leaflet Map Setup ---
const map = L.map('mapContainer').setView([28.6139, 77.2090], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const markers = L.layerGroup().addTo(map);
const heat = L.heatLayer([], { radius: 25, blur: 15 }).addTo(map);

// --- Image Preview Logic ---
const reportImageInput = document.getElementById('report_image');
const imagePreview = document.getElementById('imagePreview');
reportImageInput.addEventListener('change', function(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      imagePreview.src = e.target.result;
      imagePreview.style.display = 'block';
      // clear any previous detected text area
      const det = document.getElementById('detectedInfo');
      if (det) det.textContent = '';
    };
    reader.readAsDataURL(file);
  } else {
    imagePreview.src = '';
    imagePreview.style.display = 'none';
    const det = document.getElementById('detectedInfo');
    if (det) det.textContent = '';
  }
});

// --- Unique Report Number Generator & Up-front Display ---
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
    const fld = document.getElementById('reportNumberField');
    if (fld) fld.value = candidateReportNumber;
  } catch (err) {
    const fld = document.getElementById('reportNumberField');
    if (fld) fld.value = "Error!";
  }
}
setCandidateReportNumber(); // Call on load

// --- Image Upload Logic ---
async function uploadImage(file) {
  if (!file) throw new Error('No file selected');
  const ext = file.name.split('.').pop();
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { data, error } = await supa.storage.from(BUCKET_NAME).upload(filename, file);
  if (error) throw error;
  return `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(BUCKET_NAME)}/${encodeURIComponent(filename)}`;
}

// --- Load Reports & Update Map + Heatmap ---
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

// --- Map Click to Fill Coordinates ---
map.on('click', e => {
  document.getElementById('lat').value = e.latlng.lat.toFixed(6);
  document.getElementById('lon').value = e.latlng.lng.toFixed(6);
});

// --------------------
// Utility: get DataURL from File (async)
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

// --------------------
// Perceptual hash (aHash) implementation (client-side).
// Produces a hex string representing bits of an 8x8 grayscale average comparison.
// Steps:
// 1) Draw image into an 8x8 canvas (preserve aspect by covering, but we will scale)
// 2) Calculate average grayscale value
// 3) For each pixel, set bit=1 if pixel>=avg else 0
// 4) Return 64-bit hex string
async function computeAHash(file, hashSize = 16) {
  // create an image element
  const dataURL = await fileToDataURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      try {
        // use hashSize x hashSize instead of fixed 8x8
        const size = hashSize;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        // draw image scaled down
        ctx.drawImage(img, 0, 0, size, size);
        const imgData = ctx.getImageData(0, 0, size, size).data;
        
        const grays = [];
        for (let i = 0; i < imgData.length; i += 4) {
          const r = imgData[i], g = imgData[i+1], b = imgData[i+2];
          const gray = Math.round(0.299*r + 0.587*g + 0.114*b); // luminance
          grays.push(gray);
        }
        
        const avg = grays.reduce((a,b)=>a+b,0) / grays.length;
        
        // build bitstring
        let bitStr = '';
        for (const g of grays) {
          bitStr += (g >= avg) ? '1' : '0';
        }
        
        // convert to hex string
        let hex = '';
        for (let i = 0; i < bitStr.length; i += 4) {
          const nibble = bitStr.slice(i, i+4);
          hex += parseInt(nibble, 2).toString(16);
        }
        
        // pad length based on hash size (e.g. 16x16 = 256 bits = 64 hex chars)
        const expectedHexLen = (size * size) / 4;
        hex = hex.padStart(expectedHexLen, '0');
        
        resolve(hex);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = (e) => reject(new Error("Image load failed for hashing"));
    img.src = dataURL;
  });
}

// --- Hamming distance for hex strings representing same-length bitstrings
function hammingDistanceHex(hex1, hex2) {
  // both hex length should be equal (pad if needed)
  const len = Math.max(hex1.length, hex2.length);
  hex1 = hex1.padStart(len, '0');
  hex2 = hex2.padStart(len, '0');
  // convert nibble by nibble
  let dist = 0;
  for (let i = 0; i < len; i++) {
    const a = parseInt(hex1[i], 16);
    const b = parseInt(hex2[i], 16);
    const x = a ^ b;
    // count bits in x (popcount)
    dist += (x.toString(2).match(/1/g) || []).length;
  }
  return dist;
}

// --------------------
// Roboflow inference helper (returns predictions array)
async function roboflowPredictBase64(base64NoPrefix) {
  // Note: Roboflow serverless model expects base64 without data: prefix in some integrations.
  // We use the project URL you provided earlier.
  const url = "https://serverless.roboflow.com/garbage-and-pothole-3suhk/4";
  const apiKey = "ibNOv59t8NJueNejZG1s";

  const resp = await axios({
    method: "POST",
    url,
    params: { api_key: apiKey },
    data: base64NoPrefix,
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });
  return resp.data?.predictions || [];
}

// --------------------
// Submit Report Handler (full flow: validation -> duplicate check -> upload -> insert)
document.getElementById('submitBtn').addEventListener('click', async () => {
  const statusDiv = document.getElementById('submitStatus');
  const detectedInfoEl = document.getElementById('detectedInfo'); // optional element to show detected class+conf
  if (detectedInfoEl) detectedInfoEl.textContent = '';
  statusDiv.textContent = "Validating...";
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

  // If heading is one of these, run model validation
  const needModel = ["Potholes", "Streetlight", "Garbage"].includes(heading);

  if (needModel) {
    if (!file) {
      statusDiv.textContent = "Please upload an image for validation!";
      statusDiv.style.color = "#e23e29";
      return;
    }

    // convert to base64 and strip prefix
    let dataURL;
    try {
      dataURL = await fileToDataURL(file);
    } catch (err) {
      statusDiv.textContent = "Failed to read image for validation.";
      statusDiv.style.color = "#e23e29";
      return;
    }
    const base64NoPrefix = dataURL.split(',')[1]; // strip data:image/...;base64,

    // call Roboflow
    let predictions = [];
    try {
      predictions = await roboflowPredictBase64(base64NoPrefix);
    } catch (err) {
      statusDiv.textContent = "Model validation error: " + (err.message || err);
      statusDiv.style.color = "#e23e29";
      return;
    }

    // find matching class prediction
    const classMap = {
      "Potholes": "pothole",
      "Streetlight": "streetlight",
      "Garbage": "garbage"
    };
    const targetClass = classMap[heading];
    let matched = null;
    for (const p of predictions) {
      if (p.class === targetClass) {
        const confPct = (p.confidence * 100);
        if (confPct >= 75) { // threshold (>= 75%)
          matched = { class: p.class, conf: confPct };
          break;
        }
      }
    }

    if (!matched) {
      // Show the best available detection for user clarity (optional)
      let bestForTarget = predictions
        .filter(p => p.class === targetClass)
        .sort((a,b) => b.confidence - a.confidence)[0];

      if (bestForTarget) {
        statusDiv.textContent = `${heading} detected but confidence too low (${(bestForTarget.confidence*100).toFixed(1)}%). Validation failed.`;
      } else {
        statusDiv.textContent = `Validation failed! No ${heading.toLowerCase()} detected with sufficient confidence.`;
      }
      statusDiv.style.color = "#e23e29";
      if (detectedInfoEl && bestForTarget) detectedInfoEl.textContent = `Detected: ${bestForTarget.class} (${(bestForTarget.confidence*100).toFixed(1)}%)`;
      return;
    }

    // success for model
    statusDiv.textContent = `Validation successful (${matched.class} detected @ ${matched.conf.toFixed(1)}%). Checking for similar reports...`;
    statusDiv.style.color = "#10bb72";
    if (detectedInfoEl) detectedInfoEl.textContent = `Detected: ${matched.class} (${matched.conf.toFixed(1)}%)`;
  }

  // -----------------------
  // STEP: Duplicate detection by perceptual hash
  // -----------------------
  // compute aHash for the uploaded file
  let newHash;
  try {
    newHash = await computeAHash(file); // hex string (16 chars)
  } catch (err) {
    statusDiv.textContent = "Failed to compute image hash: " + (err.message || "");
    statusDiv.style.color = "#e23e29";
    return;
  }

  // fetch existing hashes (only report_number and image_hash to keep payload small)
  let existing;
  try {
    const { data, error } = await supa
      .from('submissions')
      .select('report_number, image_hash');
    if (error) throw error;
    existing = data || [];
  } catch (err) {
    statusDiv.textContent = "Failed to query existing reports: " + (err.message || "");
    statusDiv.style.color = "#e23e29";
    return;
  }

  // compare with threshold
  // ADJUSTABLE: threshold bits (for 64-bit hash). Lower => stricter. 5-8 is typical for strong similarity.
  const HAMMING_THRESHOLD = 6;
  let duplicateFound = null;
  for (const row of existing) {
    if (!row.image_hash) continue;
    const dist = hammingDistanceHex(newHash, row.image_hash);
    if (dist <= HAMMING_THRESHOLD) {
      duplicateFound = { report_number: row.report_number, distance: dist };
      break;
    }
  }

  if (duplicateFound) {
  // Fetch the duplicate's details from DB
  try {
    const { data: dupDetails, error: dupErr } = await supa
      .from('submissions')
      .select('report_number, description, locality, city, latitude, longitude, image_url')
      .eq('report_number', duplicateFound.report_number)
      .single();

    if (dupErr) throw dupErr;

    // Build UI block
    let html = `<div style="color:#e23e29;font-weight:bold;">❌ Similar report already exists</div>`;
    html += `<div style="margin-top:6px;padding:6px;border:1px solid #ddd;border-radius:6px;background:#fafafa;max-width:320px;">`;
    html += `<b>Report #${dupDetails.report_number}</b><br/>`;
    if (dupDetails.description) html += `📝 <b>Description:</b> ${dupDetails.description}<br/>`;
    if (dupDetails.locality || dupDetails.city) {
      html += `📍 <b>Location:</b> ${dupDetails.locality || ''}, ${dupDetails.city || ''}<br/>`;
    }
    if (dupDetails.latitude && dupDetails.longitude) {
      html += `🌐 <b>Coords:</b> ${dupDetails.latitude.toFixed(6)}, ${dupDetails.longitude.toFixed(6)}<br/>`;
    }
    if (dupDetails.image_url) {
      html += `<img src="${dupDetails.image_url}" style="margin-top:5px;max-width:280px;border-radius:6px;box-shadow:0 0 6px #aaa;" />`;
    }
    html += `</div>`;

    statusDiv.innerHTML = html;
  } catch (err) {
    statusDiv.textContent = `Similar report already exists (Report #${duplicateFound.report_number}).`;
    statusDiv.style.color = "#e23e29";
  }
  return;
}


  // -----------------------
  // STEP: Upload image + insert record
  // -----------------------
  // generate fresh report number if needed
  let reportNumber = candidateReportNumber;
  try {
    if (!reportNumber) reportNumber = await generateUniqueReportNumber();
  } catch (err) {
    statusDiv.textContent = "Error generating report number! Try again.";
    statusDiv.style.color = "#e23e29";
    return;
  }

  // upload image
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

  // insert into DB (including image_hash)
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
    image_hash: newHash
  };

  try {
    const { error } = await supa.from('submissions').insert([payload]);
    if (error) throw error;
  } catch (err) {
    statusDiv.textContent = "Database insert failed: " + (err.message || "");
    statusDiv.style.color = "#e23e29";
    return;
  }

  statusDiv.textContent = `✅ Report submitted! Your report number is: ${reportNumber}`;
  statusDiv.style.color = "#10bb72";

  if (image_url) {
    statusDiv.innerHTML += `<div style="margin-top:8px;">
      <img src="${image_url}" alt="Uploaded" style="max-width:180px;max-height:120px;border-radius:7px;box-shadow:0 0 8px #7334e944"/>
    </div>`;
  }

  document.getElementById('formContainer').reset();
  imagePreview.src = '';
  imagePreview.style.display = 'none';

  // regenerate candidate for next submission
  setCandidateReportNumber();
  await loadReports();
});

// --- Reload Reports Button ---
document.getElementById('reloadBtn').addEventListener('click', loadReports);

// --- Location Search ---
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

// --- Auto Location Capture ---
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

// --- Initial Load ---
loadReports();

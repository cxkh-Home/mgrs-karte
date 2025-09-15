// === GLOBALE VARIABLEN ===
let currentMarker;
const map = L.map('map').setView([51.1657, 10.4515], 6); // Centered on Germany
let detectedFormat = 'unknown';
let searchTimeout;

// === KARTEN-INITIALISIERUNG ===

// --- Base Layers ---
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
});

const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri'
});

const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap'
});

osmLayer.addTo(map);

// --- MGRS Grids ---
// The L.DumbMGRS classes have a dependency on a global 'generateGZDGrids' variable.
let generateGZDGrids;

function addMgrsGrids() {
    generateGZDGrids = new L.GZD({
        showLabels: true,
        showGrids: true,
        lineStyle: { color: 'red', weight: 3, opacity: 0.5 },
    });

    const generate100kGrids = new L.MGRS100K({
        showLabels: true,
        showGrids: true,
        lineStyle: { color: 'black', weight: 2, opacity: 0.5 },
    });

    const generate1000meterGrids = new L.MGRS1000Meters({
        showLabels: true,
        showGrids: true,
        minZoom: 12,
        lineStyle: { color: 'black', weight: 1, opacity: 0.5 },
    });

    const generate100meterGrids = new L.MGRS100Meters({
        showLabels: false,
        showGrids: true,
        minZoom: 15
    });

    const baseMaps = {
        "OpenStreetMap": osmLayer,
        "Satellit": satelliteLayer,
        "Topographisch": topoLayer
    };

    const overlayMaps = {
        "GZD Gitter": generateGZDGrids,
        "100km Gitter": generate100kGrids,
        "1000m Gitter": generate1000meterGrids,
        "100m Gitter": generate100meterGrids
    };

    L.control.layers(baseMaps, overlayMaps).addTo(map);

    generateGZDGrids.addTo(map);
    generate100kGrids.addTo(map);
    generate1000meterGrids.addTo(map);
}

// --- Other Controls ---
L.control.scale({ imperial: false }).addTo(map);

const north = L.control({ position: "topright" });
north.onAdd = function(map) {
    const div = L.DomUtil.create("div", "leaflet-control-north");
    div.innerHTML = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><path d="M47.655 1.634l-35 95c-.828 2.24 1.659 4.255 3.68 2.98l33.667-21.228l33.666 21.228c2.02 1.271 4.503-.74 3.678-2.98l-35-95C51.907.514 51.163.006 50 .008c-1.163.001-1.99.65-2.345 1.626zm-.155 14.88v57.54L19.89 91.461z" fill="#000000" fill-rule="evenodd"></path></svg>';
    return div;
}
north.addTo(map);


// === PROJEKTIONEN INITIALISIEREN ===
function initProjections() {
    proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs');
    for (let zone = 1; zone <= 60; zone++) {
        proj4.defs(`EPSG:${32600 + zone}`, `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`);
        proj4.defs(`EPSG:${32700 + zone}`, `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`);
    }
}

// === EINGABE-ANALYSE ===
function analyzeInput() {
    const value = document.getElementById('universal-input').value.trim();
    if (!value) {
        hideSuggestions();
        return;
    }

    if (isMGRSFormat(value)) {
        detectedFormat = 'mgrs';
    } else if (isGPSFormat(value)) {
        detectedFormat = 'gps';
    } else if (isUTMFormat(value)) {
        detectedFormat = 'utm';
    } else if (value.length >= 2) {
        detectedFormat = 'address';
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => searchAddresses(value), 300);
    } else {
        detectedFormat = 'unknown';
        hideSuggestions();
    }
}

// === SUCHE & UMRECHNUNG ===
async function performSearch() {
    const input = document.getElementById('universal-input').value.trim();
    if (!input) return;

    let lat, lng;

    try {
        if (detectedFormat === 'gps') {
            const coords = parseGPSCoordinates(input);
            if (coords && isValidCoordinates(coords.lat, coords.lng)) {
                lat = coords.lat;
                lng = coords.lng;
            }
        } else if (detectedFormat === 'utm') {
            const utm = parseUTMCoordinates(input);
            if (utm) {
                const coords = utmToLatLng(utm.zone, utm.easting, utm.northing);
                lat = coords.lat;
                lng = coords.lng;
            }
        } else if (detectedFormat === 'mgrs') {
            const latLon = mgrs.toPoint(input);
            lng = latLon[0];
            lat = latLon[1];
        } else if (detectedFormat === 'address') {
            // Address search is handled by searchAddresses -> selectAddress
            // This button can act as a trigger for the first suggestion if one exists
             const firstSuggestion = document.querySelector('.suggestion-item');
             if(firstSuggestion) {
                firstSuggestion.click();
             } else {
                // If search was triggered but no suggestions are available after a moment
                setTimeout(() => {
                    if(document.querySelector('.suggestion-item')) return; // A late suggestion appeared
                    alert("Adresse nicht gefunden. Bitte versuchen Sie eine andere Sucheingabe.");
                }, 500);
             }
             return; // Prevent further processing
        }

        if (lat !== undefined && lng !== undefined) {
            if (isValidCoordinates(lat, lng)) {
                showOnMap(lat, lng);
                hideSuggestions();
            } else {
                alert('Ungültige Koordinaten.');
            }
        } else {
             alert('Format nicht erkannt oder ungültig. Bitte versuchen Sie die Adresssuche.');
        }

    } catch (error) {
        alert('Fehler bei der Verarbeitung der Eingabe: ' + error.message);
    }
}


async function searchAddresses(query) {
    if (query.length < 2) return;
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
        const results = await response.json();
        showSuggestions(results);
    } catch (error) {
        console.error('Address search failed:', error);
        hideSuggestions();
    }
}

function showSuggestions(results) {
    const suggestions = document.getElementById('suggestions');
    suggestions.innerHTML = '';
    if (!results || results.length === 0) {
        hideSuggestions();
        return;
    }

    results.forEach(result => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.textContent = result.display_name;
        item.onclick = () => selectAddress(result.display_name, parseFloat(result.lat), parseFloat(result.lon));
        suggestions.appendChild(item);
    });
    suggestions.style.display = 'block';
}

function hideSuggestions() {
    const suggestions = document.getElementById('suggestions');
    suggestions.innerHTML = '';
    suggestions.style.display = 'none';
}

function selectAddress(address, lat, lng) {
    document.getElementById('universal-input').value = address;
    hideSuggestions();
    showOnMap(lat, lng);
}

// === FORMAT-ERKENNUNG (von script.js) ===
function isGPSFormat(value) {
    const patterns = [
        /^-?\d+\.?\d*\s*,\s*-?\d+\.?\d*$/,
        /^-?\d+\.?\d*\s+-?\d+\.?\d*$/,
        /^-?\d+,\d+\s*[,;]\s*-?\d+,\d+$/,
        /^lat(?:itude)?:?\s*-?\d+\.?\d*\s*,?\s*lng?(?:ongitude)?:?\s*-?\d+\.?\d*$/i,
        /^\d+[°]\s*\d+['\s]*\d*\.?\d*["\s]*[NSEW]\s*,?\s*\d+[°]\s*\d+['\s]*\d*\.?\d*["\s]*[NSEW]$/i,
    ];
    return patterns.some(pattern => pattern.test(value));
}

function isMGRSFormat(value) {
    const pattern = /^\d{1,2}[A-Z]\s+[A-Z]{2}\s+\d{1,5}\s+\d{1,5}$/i;
    return pattern.test(value);
}

function isUTMFormat(value) {
    const patterns = [
        /^\d{1,2}[A-Z]\s+\d{5,7}\s+\d{6,8}$/i,
        /^zone:?\s*\d{1,2}[A-Z]\s+\d{5,7}\s+\d{6,8}$/i,
    ];
    return patterns.some(pattern => pattern.test(value));
}


// === KOORDINATEN-PARSING (von script.js) ===
function parseGPSCoordinates(value) {
    let normalized = value.trim().replace(/,/g, '.');
     // Handle case where comma is used as separator
    if (value.includes(',') && !value.includes('.')) {
         normalized = value.replace(/,/, ' ');
    }
     const parts = normalized.split(/[\s.]+/);
    if (parts.length > 2 && (normalized.match(/\./g) || []).length > 1 ) {
        // Likely "lat, lng" with comma as decimal separator
        normalized = value.replace(',', '.');
    }


    const decimalPatterns = [
        /^(-?\d+\.?\d*)\s*(-?\d+\.?\d*)$/, // Covers space and assumes the replaced comma was separator
        /^(-?\d+\.?\d*)\s+(-?\d+\.?\d*)$/,
        /^lat(?:itude)?:?\s*(-?\d+\.?\d*)\s*,?\s*lng?(?:ongitude)?:?\s*(-?\d+\.?\d*)$/i,
    ];

    for (const pattern of decimalPatterns) {
        const match = normalized.match(pattern);
        if (match) {
             // Handle swapped lat/lng if input is like "10.12345 53.12345"
            let lat = parseFloat(match[1]);
            let lng = parseFloat(match[2]);
            if (Math.abs(lat) < 90 && Math.abs(lng) > 90) { // Heuristic for swapped coords
                [lat, lng] = [lng, lat];
            }
            return { lat, lng };
        }
    }

    // DMS Format
    const dmsPattern = /^(\d+)[°]\s*(\d+)['\s]*(\d*\.?\d*)["\s]*([NSEW])\s*,?\s*(\d+)[°]\s*(\d+)['\s]*(\d*\.?\d*)["\s]*([NSEW])$/i;
    const dmsMatch = value.match(dmsPattern);
    if (dmsMatch) {
        let lat = parseInt(dmsMatch[1]) + parseInt(dmsMatch[2])/60 + parseFloat(dmsMatch[3] || 0)/3600;
        let lng = parseInt(dmsMatch[5]) + parseInt(dmsMatch[6])/60 + parseFloat(dmsMatch[7] || 0)/3600;
        if (dmsMatch[4].toUpperCase() === 'S') lat = -lat;
        if (dmsMatch[8].toUpperCase() === 'W') lng = -lng;
        return { lat, lng };
    }

    return null;
}

function parseUTMCoordinates(value) {
    const match = value.match(/^(\d{1,2})([A-Z])\s+(\d{5,7})\s+(\d{6,8})$/i);
    if (match) {
        return {
            zone: match[1] + match[2].toUpperCase(),
            easting: parseInt(match[3]),
            northing: parseInt(match[4])
        };
    }
    return null;
}

// === KOORDINATEN-UMRECHNUNG (von script.js) ===
function utmToLatLng(zone, easting, northing) {
    const zoneNum = parseInt(zone.slice(0, -1));
    const band = zone.slice(-1);
    const isNorthern = band >= 'N';
    const epsgCode = isNorthern ? `EPSG:${32600 + zoneNum}` : `EPSG:${32700 + zoneNum}`;
    const gpsCoords = proj4(epsgCode, 'EPSG:4326', [easting, northing]);
    return { lat: gpsCoords[1], lng: gpsCoords[0] };
}

// === KARTEN-FUNKTIONEN ===
function showOnMap(lat, lng) {
    if (!isValidCoordinates(lat, lng)) return;

    if (currentMarker) {
        map.removeLayer(currentMarker);
    }

    const mgrsCoords = mgrs.forward([lng, lat]);

    currentMarker = L.marker([lat, lng]).addTo(map);
    currentMarker.bindPopup(`
        <strong>GPS:</strong> ${lat.toFixed(6)}, ${lng.toFixed(6)}<br>
        <strong>MGRS:</strong> ${mgrsCoords}
    `).openPopup();

    map.setView([lat, lng], 15);
}

function updateLocationDisplay() {
    const center = map.getCenter();
    const lat = center.lat;
    const lng = center.lng;
    const mgrsCoords = mgrs.forward([lng, lat], 5);

    const display = document.getElementById('location-display');
    display.innerHTML = `
        <strong>Kartenmitte:</strong><br>
        <strong>GPS:</strong> ${lat.toFixed(5)}, ${lng.toFixed(5)}<br>
        <strong>MGRS:</strong> ${mgrsCoords}
    `;
}

// === HILFSFUNKTIONEN ===
function isValidCoordinates(lat, lng) {
    return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// === EVENT LISTENERS & INITIALISIERUNG ===
document.addEventListener('DOMContentLoaded', function() {
    initProjections();
    addMgrsGrids();
    updateLocationDisplay();

    map.on('move', updateLocationDisplay);

    map.on('click', function(e) {
        showOnMap(e.latlng.lat, e.latlng.lng);
    });

    // Hide suggestions when clicking outside
    document.addEventListener('click', function(e) {
        const container = document.querySelector('.search-container');
        if (!container.contains(e.target)) {
            hideSuggestions();
        }
    });

    // Search on Enter key
    document.getElementById('universal-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            performSearch();
        }
    });

    // Print button event listener
    document.getElementById('print-button').addEventListener('click', printMap);
});

// === DRUCKFUNKTION ===
async function printMap() {
    const printContainer = document.getElementById('print-container');
    const mapElement = document.getElementById('map');

    // Show a loading message
    document.body.classList.add('printing');
    printContainer.innerHTML = '<h2>Druckvorschau wird erstellt...</h2>';
    printContainer.style.display = 'block';

    try {
        // Use html2canvas to capture the map
        const canvas = await html2canvas(mapElement, {
            useCORS: true, // Important for external tile layers
            logging: false,
            onclone: (doc) => {
                // We need to find the north arrow SVG in the cloned document and make it visible
                // because the original might be hidden or styled differently.
                // For simplicity in this step, we will add it manually later.
            }
        });

        const mapImageUrl = canvas.toDataURL('image/png');

        // Get coordinates
        const center = map.getCenter();
        let coordsInfo = `<strong>Kartenmitte:</strong><br>
                          GPS: ${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}<br>
                          MGRS: ${mgrs.forward([center.lng, center.lat], 5)}`;
        if (currentMarker) {
            const markerLatLng = currentMarker.getLatLng();
            coordsInfo = `<strong>Markierte Position:</strong><br>
                          GPS: ${markerLatLng.lat.toFixed(6)}, ${markerLatLng.lng.toFixed(6)}<br>
                          MGRS: ${mgrs.forward([markerLatLng.lng, markerLatLng.lat])}`;
        }

        // Get scale information
        const scaleLabel = document.querySelector('.leaflet-control-scale-line').innerText;
        const scaleWidth = document.querySelector('.leaflet-control-scale-line').style.width;

        // Get North Arrow SVG
        const northArrowSvg = document.querySelector('.leaflet-control-north').innerHTML;


        // Construct printable HTML
        printContainer.innerHTML = `
            <h1>Kartenausdruck</h1>
            <div class="print-map-wrapper">
                <img id="print-map-image" src="${mapImageUrl}" />
                <div id="print-north-arrow">${northArrowSvg}</div>
                <div id="print-scale-bar" style="width: ${scaleWidth};">${scaleLabel}</div>
            </div>
            <div class="print-info">
                <h2>Informationen</h2>
                <p>${coordsInfo}</p>
                <p>Gedruckt am: ${new Date().toLocaleString('de-DE')}</p>
            </div>
        `;

        // Wait a moment for the image to render, then print
        setTimeout(() => {
            window.print();
            document.body.classList.remove('printing');
            // Hide the container again after printing
             setTimeout(() => {
                printContainer.style.display = 'none';
            }, 500);
        }, 500);

    } catch (error) {
        console.error('Printing failed:', error);
        printContainer.innerHTML = '<h2>Fehler beim Erstellen der Druckvorschau.</h2>';
        document.body.classList.remove('printing');
    }
}

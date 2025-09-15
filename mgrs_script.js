let currentMarker;
let map;
let editableLayers;

// --- Base Layers ---
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
});


const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
	attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
});

// As mentioned in a previous step, the MGRS100K and MGRS1000Meters classes
// have a dependency on a global 'generateGZDGrids' variable. I will define it here.
let generateGZDGrids;
let generate100meterGrids;
let overlayMaps;

// Add MGRS Grids
function addMgrsGrids() {
    // Grid Zone Designator (1 million by 1 million meters)
    generateGZDGrids = new L.GZD({
        showLabels: true,
        showGrids: true,
        lineStyle: {
            color: 'black',
            weight: 2,
            opacity: 1,
        },
    });

    // 100K Meter Grids
    const generate100kGrids = new L.MGRS100K({
        showLabels: true,
        showGrids: true,
        lineStyle: {
            color: 'black',
            weight: 1,
            opacity: 1,
        },
    });

    // 1000 Meter Grids
    const generate1000meterGrids = new L.MGRS1000Meters({
        showLabels: true,
        showGrids: true,
        minZoom: 12, // Only show at higher zoom levels
        lineStyle: {
            color: 'black',
            weight: 0.5,
            opacity: 1,
        },
    });

    // --- Layer Control ---
    const baseMaps = {
        "OpenStreetMap": osmLayer,
        "Topographisch": topoLayer
    };

    generate100meterGrids = new L.MGRS100Meters({
        showLabels: false, // Labels at this level are too cluttered
        showGrids: true,
        minZoom: 15,
        lineStyle: {
            color: 'black',
            weight: 0.5,
            opacity: 1,
        },
    });

    overlayMaps = {
        "GZD Gitter": generateGZDGrids,
        "100km Gitter": generate100kGrids,
        "1000m Gitter": generate1000meterGrids,
        "100m Gitter": generate100meterGrids
    };

    L.control.layers(baseMaps, overlayMaps).addTo(map);

    // Add grids to the map by default
    generateGZDGrids.addTo(map);
    generate100kGrids.addTo(map);
    generate1000meterGrids.addTo(map);

    // --- Scale Control ---
    L.control.scale({ imperial: false }).addTo(map);

    // --- North Arrow Control ---
    const north = L.control({ position: "topright" });
    north.onAdd = function(map) {
        const div = L.DomUtil.create("div", "leaflet-control-north");
        div.innerHTML = '<?xml version="1.0" encoding="utf-8"?><svg width="800px" height="800px" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true" role="img" class="iconify iconify--gis" preserveAspectRatio="xMidYMid meet"><path d="M47.655 1.634l-35 95c-.828 2.24 1.659 4.255 3.68 2.98l33.667-21.228l33.666 21.228c2.02 1.271 4.503-.74 3.678-2.98l-35-95C51.907.514 51.163.006 50 .008c-1.163.001-1.99.65-2.345 1.626zm-.155 14.88v57.54L19.89 91.461z" fill="#000000" fill-rule="evenodd"></path></svg>';
        return div;
    }
    north.addTo(map);
}

// === PROJEKTIONEN INITIALISIEREN ===
function initProjections() {
    proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs');
    for (let zone = 1; zone <= 60; zone++) {
        proj4.defs(`EPSG:${32600 + zone}`, `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`);
        proj4.defs(`EPSG:${32700 + zone}`, `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`);
    }
}

// === EINGABE-ANALYSE ===
let searchTimeout;
let detectedFormat = 'unknown';

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
             const firstSuggestion = document.querySelector('.suggestion-item');
             if(firstSuggestion) {
                firstSuggestion.click();
             } else {
                setTimeout(() => {
                    if(document.querySelector('.suggestion-item')) return;
                    alert("Adresse nicht gefunden. Bitte versuchen Sie eine andere Sucheingabe.");
                }, 500);
             }
             return;
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
    if (suggestions) {
        suggestions.innerHTML = '';
        suggestions.style.display = 'none';
    }
}

function selectAddress(address, lat, lng) {
    document.getElementById('universal-input').value = address;
    hideSuggestions();
    showOnMap(lat, lng);
}

// Functions like isGPSFormat, parseGPSCoordinates, etc., are now in shared_utils.js

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

function handleUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const lat = urlParams.get('lat');
    const lng = urlParams.get('lng');

    if (lat && lng) {
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lng);
        if (!isNaN(latitude) && !isNaN(longitude)) {
            map.setView([latitude, longitude], 15);
            if (currentMarker) {
                map.removeLayer(currentMarker);
            }
            currentMarker = L.marker([latitude, longitude]).addTo(map);
        }
    }
}

function updateLocationDisplay() {
    const center = map.getCenter();
    const lat = center.lat;
    const lng = center.lng;
    const mgrsCoords = mgrs.forward([lng, lat], 5); // 5-digit precision

    const display = document.getElementById('location-display');
    display.innerHTML = `
        <strong>Kartenmitte:</strong><br>
        <strong>GPS:</strong> ${lat.toFixed(5)}, ${lng.toFixed(5)}<br>
        <strong>MGRS:</strong> ${mgrsCoords}
    `;
}

document.addEventListener('DOMContentLoaded', function() {
    // Initialize the map
    map = L.map('map').setView([51.1657, 10.4515], 6);
    osmLayer.addTo(map);

    // Set up event listeners that depend on the map
    map.on('move', updateLocationDisplay);
    // Remove the old click handler to avoid conflict with drawing tools
    // map.on('click', (e) => showOnMap(e.latlng.lat, e.latlng.lng));

    // Initialize Geoman Drawing Tools
    editableLayers = new L.FeatureGroup();
    map.addLayer(editableLayers);

    map.pm.addControls({
        position: 'topleft',
        drawCircle: false,
        drawCircleMarker: false,
    });

    map.on('pm:create', (e) => {
        editableLayers.addLayer(e.layer);
    });

    // Custom Controls for Import/Export/Text
    const customToolbar = L.Control.extend({
        options: {
            position: 'topleft'
        },
        onAdd: function () {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');

            // Add Text Button
            const textButton = L.DomUtil.create('a', 'leaflet-control-button', container);
            textButton.innerHTML = 'T';
            textButton.title = 'Add Text';
            L.DomEvent.on(textButton, 'click', () => {
                map.pm.enableDraw('Text', {
                    snappable: true,
                    snapDistance: 20,
                });
            });

            // Import Button
            const importButton = L.DomUtil.create('a', 'leaflet-control-button', container);
            importButton.innerHTML = '&#x2191;'; // Up arrow
            importButton.title = 'Import GPX/KML';
            L.DomEvent.on(importButton, 'click', () => {
                document.getElementById('file-input').click();
            });

            // Export GeoJSON Button
            const exportButton = L.DomUtil.create('a', 'leaflet-control-button', container);
            exportButton.innerHTML = '&#x2913;'; // Down arrow to bar
            exportButton.title = 'Export GeoJSON';
            L.DomEvent.on(exportButton, 'click', exportGeoJSON);

            // Save Image Button
            const imageButton = L.DomUtil.create('a', 'leaflet-control-button', container);
            imageButton.innerHTML = '&#x1F4BE;'; // Floppy disk
            imageButton.title = 'Save as Image';
            L.DomEvent.on(imageButton, 'click', saveAsImage);

            return container;
        }
    });
    map.addControl(new customToolbar());

    // Hidden file input for the import button
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'file-input';
    fileInput.accept = '.gpx, .kml';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
    fileInput.addEventListener('change', function(e) {
        if (e.target.files.length === 0) return;
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = function(event) {
            const content = event.target.result;
            const customLayer = omnivore.run.parse(content);
            customLayer.eachLayer(layer => editableLayers.addLayer(layer));
            map.fitBounds(customLayer.getBounds());
        };
        reader.readAsText(file);
    });


    // Initialize other components
    initProjections();
    addMgrsGrids();
    handleUrlParameters();
    updateLocationDisplay();

    // Set up UI event listeners
    document.addEventListener('click', function(e) {
        const container = document.querySelector('.search-container');
        if (container && !container.contains(e.target)) {
            hideSuggestions();
        }
    });

    // Search on Enter key
    const input = document.getElementById('universal-input');
    if (input) {
        input.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                performSearch();
            }
        });
    }

    const printButton = document.getElementById('print-button');
    if (printButton) {
        printButton.addEventListener('click', printMap);
    }

    const exportGeoJSONButton = document.getElementById('export-geojson-button');
    if (exportGeoJSONButton) {
        exportGeoJSONButton.addEventListener('click', exportGeoJSON);
    }

    const saveImageButton = document.getElementById('save-image-button');
    if (saveImageButton) {
        saveImageButton.addEventListener('click', saveAsImage);
    }

    const addTextButton = document.getElementById('add-text-button');
    if (addTextButton) {
        addTextButton.addEventListener('click', () => {
            // Enter text-adding mode
            L.DomUtil.addClass(map._container, 'crosshair-cursor');
            map.once('click', (e) => {
                const text = prompt("Enter annotation text:");
                if (text) {
                    const textIcon = L.divIcon({
                        className: 'text-annotation',
                        html: `<div>${text}</div>`,
                        iconSize: [150, 20]
                    });
                    const textMarker = L.marker(e.latlng, { icon: textIcon });
                    editableLayers.addLayer(textMarker);
                }
                L.DomUtil.removeClass(map._container, 'crosshair-cursor');
            });
        });
    }

    const fileInput = document.getElementById('file-input');
    if (fileInput) {
        fileInput.addEventListener('change', function(e) {
            if (e.target.files.length === 0) {
                return;
            }
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = function(event) {
                const content = event.target.result;
                // Use omnivore to parse and add to map
                const customLayer = omnivore.run.parse(content);
                // Add to the editable layers group so it can be exported/deleted
                customLayer.eachLayer(layer => editableLayers.addLayer(layer));
                map.fitBounds(customLayer.getBounds());
            };
            reader.readAsText(file);
        });
    }
});

// === EXPORTFUNKTIONEN ===
function exportGeoJSON() {
    const data = editableLayers.toGeoJSON();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lagekarte.geojson';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function saveAsImage() {
    // Temporarily hide controls for a clean screenshot
    document.querySelector('.leaflet-control-container').style.display = 'none';

    try {
        const canvas = await html2canvas(document.getElementById('map'), {
            useCORS: true,
            logging: false,
            scale: 3,
        });
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = 'lagekarte.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } catch (error) {
        console.error('Image export failed:', error);
        alert('Fehler beim Speichern des Bildes.');
    } finally {
        // Always show the controls again
        document.querySelector('.leaflet-control-container').style.display = '';
    }
}


// === DRUCKFUNKTION ===
async function printMap() {
    const printContainer = document.getElementById('print-container');
    const mapElement = document.getElementById('map');
    const paperSize = document.getElementById('paper-size-select').value;
    const printClass = `print-${paperSize}`;

    document.body.classList.add('printing', printClass);

    try {
        // Force a redraw of the map and all its current layers
        map.invalidateSize();
        map.fire('moveend');

        // Wait for a fixed timeout to allow all layers to render.
        console.log("Waiting for layers to render...");
        await new Promise(resolve => setTimeout(resolve, 3000));
        console.log("Wait finished, generating canvas...");

        const canvas = await html2canvas(mapElement, {
            useCORS: true,
            logging: false,
            scale: 3,
        });
        const mapImageUrl = canvas.toDataURL('image/png');

        let coordsInfo = '';
        const center = map.getCenter();
        if (currentMarker) {
            const markerLatLng = currentMarker.getLatLng();
            coordsInfo = `<strong>Markierte Position:</strong><br>GPS: ${markerLatLng.lat.toFixed(6)}, ${markerLatLng.lng.toFixed(6)}<br>MGRS: ${mgrs.forward([markerLatLng.lng, markerLatLng.lat])}`;
        } else {
            coordsInfo = `<strong>Kartenmitte:</strong><br>GPS: ${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}<br>MGRS: ${mgrs.forward([center.lng, center.lat], 5)}`;
        }

        const scaleLabel = document.querySelector('.leaflet-control-scale-line').innerText;
        const scaleWidth = document.querySelector('.leaflet-control-scale-line').style.width;
        const northArrowSvg = document.querySelector('.leaflet-control-north').innerHTML;

        printContainer.innerHTML = `
            <div class="print-map-wrapper">
                <img id="print-map-image" src="${mapImageUrl}" />
                <div id="print-north-arrow">${northArrowSvg}</div>
                <div id="print-scale-bar" style="width: ${scaleWidth};">
                    <div class="scale-bar-segment"></div><div class="scale-bar-segment"></div>
                    <div class="scale-bar-label">${scaleLabel}</div>
                </div>
            </div>
            <div class="print-footer">
                <div class="print-info"><p>${coordsInfo}</p><p>Gedruckt am: ${new Date().toLocaleString('de-DE')}</p></div>
            </div>`;

        printContainer.style.display = 'block';

        setTimeout(() => {
            window.print();
        }, 500);

    } catch (error) {
        console.error('Printing failed:', error);
        alert('Fehler beim Erstellen der Druckvorschau.');
    } finally {
        document.body.classList.remove('printing', printClass);
        printContainer.style.display = 'none';
    }
}

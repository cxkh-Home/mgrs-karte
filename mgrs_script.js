let currentMarker;
// Initialize the map
const map = L.map('map').setView([51.1657, 10.4515], 6); // Centered on Germany

// --- Base Layers ---
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
});

const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
	attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
});

const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
	attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
});

// Add default layer to map
osmLayer.addTo(map);

// As mentioned in a previous step, the MGRS100K and MGRS1000Meters classes
// have a dependency on a global 'generateGZDGrids' variable. I will define it here.
let generateGZDGrids;

// Add MGRS Grids
function addMgrsGrids() {
    // Grid Zone Designator (1 million by 1 million meters)
    generateGZDGrids = new L.GZD({
        showLabels: true,
        showGrids: true,
        lineStyle: {
            color: 'red',
            weight: 3,
            opacity: 0.5,
        },
    });

    // 100K Meter Grids
    const generate100kGrids = new L.MGRS100K({
        showLabels: true,
        showGrids: true,
        lineStyle: {
            color: 'black',
            weight: 2,
            opacity: 0.5,
        },
    });

    // 1000 Meter Grids
    const generate1000meterGrids = new L.MGRS1000Meters({
        showLabels: true,
        showGrids: true,
        minZoom: 12, // Only show at higher zoom levels
        lineStyle: {
            color: 'black',
            weight: 1,
            opacity: 0.5,
        },
    });

    // --- Layer Control ---
    const baseMaps = {
        "OpenStreetMap": osmLayer,
        "Satellit": satelliteLayer,
        "Topographisch": topoLayer
    };

    const generate100meterGrids = new L.MGRS100Meters({
        showLabels: false, // Labels at this level are too cluttered
        showGrids: true,
        minZoom: 15
    });

    const overlayMaps = {
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

    // --- Search Control ---
    const search = new GeoSearch.GeoSearchControl({
        provider: new GeoSearch.OpenStreetMapProvider(),
        style: 'bar',
        showMarker: true,
        marker: {
            icon: new L.Icon.Default(),
            draggable: false,
        },
        autoClose: true,
        searchLabel: 'Adresse oder Ort suchen',
    });
    map.addControl(search);

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

    // --- Print Control ---
    L.easyPrint({
        title: 'Karte drucken',
        position: 'topleft',
        sizeModes: ['A4Portrait', 'A4Landscape', 'Current'],
        exportOnly: false,
        hideClasses: ['leaflet-control-layers'], // Hide the layer control in the print
        hideControlContainer: true
    }).addTo(map);
}

map.on('click', function(e) {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;

    if (currentMarker) {
        map.removeLayer(currentMarker);
    }

    const mgrsCoords = mgrs.forward([lng, lat]);

    currentMarker = L.marker([lat, lng]).addTo(map);
    currentMarker.bindPopup(`
        <div style="text-align: center; padding: 5px;">
            <h3 style="margin-bottom: 5px; font-size: 16px;">Ausgewählte Position</h3>
            <div style="font-size: 13px;">
                <strong>GPS:</strong> ${lat.toFixed(6)}, ${lng.toFixed(6)}<br>
                <strong>MGRS:</strong> ${mgrsCoords}
            </div>
        </div>
    `).openPopup();
});

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

map.on('move', updateLocationDisplay);

addMgrsGrids();
handleUrlParameters();
updateLocationDisplay(); // Initial call

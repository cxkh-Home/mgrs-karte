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

    const overlayMaps = {
        "GZD Gitter": generateGZDGrids,
        "100km Gitter": generate100kGrids,
        "1000m Gitter": generate1000meterGrids
    };

    L.control.layers(baseMaps, overlayMaps).addTo(map);

    // Add grids to the map by default
    generateGZDGrids.addTo(map);
    generate100kGrids.addTo(map);
    generate1000meterGrids.addTo(map);

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

addMgrsGrids();

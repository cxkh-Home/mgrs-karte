// === GLOBALE VARIABLEN ===
let map;
let currentMarker;
let detectedFormat = 'unknown';
let searchTimeout;

// === INITIALISIERUNG ===
function initProjections() {
    proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs');

    for (let zone = 1; zone <= 60; zone++) {
        proj4.defs(`EPSG:${32600 + zone}`, `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`);
        proj4.defs(`EPSG:${32700 + zone}`, `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`);
    }
}

function initMap() {
    map = L.map('map').setView([51.1657, 10.4515], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    map.on('click', function(e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;

        if (currentMarker) map.removeLayer(currentMarker);
        currentMarker = L.marker([lat, lng]).addTo(map);

        const utmCoords = latLngToUTM(lat, lng);
        currentMarker.bindPopup(`
            <div class="text-center p-3">
                <h3 class="font-bold mb-2 text-gray-800">📍 Angeklickte Position</h3>
                <div class="text-sm mb-3">
                    <strong>GPS:</strong> ${lat.toFixed(6)}, ${lng.toFixed(6)}<br>
                    <strong>UTM:</strong> ${utmCoords}
                </div>
                <button onclick="loadClickedCoordinates(${lat}, ${lng})"
                        class="w-full bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded text-sm">
                    📋 Koordinaten laden
                </button>
            </div>
        `).openPopup();
    });
}

// === EINGABE-ANALYSE ===
function analyzeInput() {
    const input = document.getElementById('universal-input');
    const value = input.value.trim();

    if (!value) {
        updateFormatIndicator('unknown', '❓', 'Eingabe wird erkannt...');
        hideValidation();
        hideSuggestions();
        return;
    }

    if (isMGRSFormat(value)) {
        handleMGRSInput(value);
    } else if (isGPSFormat(value)) {
        handleGPSInput(value);
    } else if (isUTMFormat(value)) {
        handleUTMInput(value);
    } else if (value.length >= 2) {
        handleAddressInput(value);
    } else {
        updateFormatIndicator('unknown', '❓', 'Format nicht erkannt');
        hideValidation();
        hideSuggestions();
    }
}

function handleGPSInput(value) {
    detectedFormat = 'gps';
    updateFormatIndicator('gps', '🛰️', 'GPS-Koordinaten erkannt');

    const coords = parseGPSCoordinates(value);
    if (coords && isValidCoordinates(coords.lat, coords.lng)) {
        showValidation(`✅ Gültige GPS-Koordinaten: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`, 'success');
        showOnMapInstant(coords.lat, coords.lng);
    } else {
        showValidation('❌ Ungültiges GPS-Format', 'error');
    }
    hideSuggestions();
}

        function handleMGRSInput(value) {
            detectedFormat = 'mgrs';
            updateFormatIndicator('mgrs', '🌐', 'MGRS-Koordinaten erkannt');
            try {
                // Pre-validate by attempting a conversion
                const latLon = mgrs.toPoint(value);
                if (isValidCoordinates(latLon[1], latLon[0])) {
                     showValidation(`✅ Gültige MGRS-Koordinaten`, 'success');
                     showOnMapInstant(latLon[1], latLon[0]);
                } else {
                    throw new Error("Koordinaten außerhalb des gültigen Bereichs");
                }
            } catch (error) {
                showValidation(`❌ Ungültiges MGRS-Format: ${error.message}`, 'error');
            }
    hideSuggestions();
}

function handleUTMInput(value) {
    detectedFormat = 'utm';
    updateFormatIndicator('utm', '📐', 'UTM-Koordinaten erkannt');

    const utm = parseUTMCoordinates(value);
    if (utm && utm.zone && utm.easting && utm.northing) {
        try {
            const coords = utmToLatLng(utm.zone, utm.easting, utm.northing);
            if (coords && isValidCoordinates(coords.lat, coords.lng)) {
                showValidation(`✅ Gültige UTM-Koordinaten: ${utm.zone} ${utm.easting} ${utm.northing}`, 'success');
                showOnMapInstant(coords.lat, coords.lng);
            }
        } catch (error) {
            showValidation('❌ Fehler bei UTM-Umrechnung', 'error');
        }
    } else {
        showValidation('❌ Ungültiges UTM-Format', 'error');
    }
    hideSuggestions();
}

function handleAddressInput(value) {
    detectedFormat = 'address';
    updateFormatIndicator('address', '🏠', 'Adresse erkannt');

    if (value.length < 2) {
        showValidation('💡 Mindestens 2 Zeichen für Adresssuche', 'warning');
        hideSuggestions();
    } else {
        showValidation('🔍 Bereit für Suche...', 'success');

        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            searchAddresses(value);
        }, 300);
    }
}

// === WELTWEITE ADRESSSUCHE ===
let searchCache = new Map();
let currentSearchController = null;

async function searchAddresses(query) {
    if (query.length < 2) return;

    // Cache check
    const cacheKey = query.toLowerCase().trim();
    if (searchCache.has(cacheKey)) {
        const cachedResults = searchCache.get(cacheKey);
        if (cachedResults.length > 0) {
            showSuggestions(cachedResults);
            showValidation(`⚡ ${cachedResults.length} Ergebnisse (Cache)`, 'success');
        } else {
            showNoResults(query);
            showValidation('❌ Keine Ergebnisse gefunden', 'error');
        }
        return;
    }

    // Cancel previous search
    if (currentSearchController) {
        currentSearchController.abort();
    }
    currentSearchController = new AbortController();

    try {
        showValidation('🌍 Weltweite Suche läuft...', 'success');

        // Multi-provider search for better global coverage
        const results = await performGlobalSearch(query, currentSearchController.signal);

        if (results && results.length > 0) {
            // Cache results
            searchCache.set(cacheKey, results);
            if (searchCache.size > 100) {
                const firstKey = searchCache.keys().next().value;
                searchCache.delete(firstKey);
            }

            showSuggestions(results);
            showValidation(`✅ ${results.length} Ergebnisse gefunden`, 'success');
        } else {
            searchCache.set(cacheKey, []);
            showNoResults(query);
            showValidation('❌ Keine Ergebnisse gefunden', 'error');
        }

    } catch (error) {
        if (error.name === 'AbortError') return;

        console.error('Search error:', error);
        showValidation('⚠️ Suchfehler - Versuche Fallback...', 'warning');

        // Fallback search
        try {
            const fallbackResults = await performFallbackSearch(query);
            if (fallbackResults && fallbackResults.length > 0) {
                showSuggestions(fallbackResults);
                showValidation(`✅ ${fallbackResults.length} Ergebnisse (Fallback)`, 'success');
            } else {
                showNoResults(query);
                showValidation('❌ Keine Ergebnisse gefunden', 'error');
            }
        } catch (fallbackError) {
            showNoResults(query);
            showValidation('❌ Suche fehlgeschlagen', 'error');
        }
    }
}

async function performGlobalSearch(query, signal) {
    const searchProviders = [
        {
            name: 'Nominatim OSM',
            search: () => searchNominatim(query, signal)
        },
        {
            name: 'Photon Komoot',
            search: () => searchPhoton(query, signal)
        }
    ];

    // Try providers in parallel for speed
    const searchPromises = searchProviders.map(async (provider) => {
        try {
            return await provider.search();
        } catch (error) {
            console.warn(`${provider.name} failed:`, error.message);
            return [];
        }
    });

    const results = await Promise.allSettled(searchPromises);

    // Combine and deduplicate results
    const allResults = [];
    for (const result of results) {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
            allResults.push(...result.value);
        }
    }

    return deduplicateResults(allResults).slice(0, 10);
}

async function searchNominatim(query, signal) {
    try {
        const searchParams = new URLSearchParams({
            format: 'json',
            q: query,
            limit: '10',
            addressdetails: '1',
            dedupe: '1',
            'accept-language': 'de,en'
        });

        const response = await fetch(`https://nominatim.openstreetmap.org/search?${searchParams}`, {
            headers: {
                'User-Agent': 'UniversalCoordinateCalculator/1.0',
                'Accept': 'application/json'
            },
            signal: signal,
            timeout: 8000
        });

        if (!response.ok) {
            throw new Error(`Nominatim HTTP ${response.status}`);
        }

        const results = await response.json();

        return results.filter(r => r.lat && r.lon).map(r => ({
            lat: r.lat,
            lon: r.lon,
            display_name: r.display_name,
            type: r.type || 'place',
            importance: parseFloat(r.importance) || 0.5,
            source: 'nominatim'
        }));

    } catch (error) {
        console.warn('Nominatim search failed:', error.message);
        return [];
    }
}

async function searchPhoton(query, signal) {
    try {
        const searchParams = new URLSearchParams({
            q: query,
            limit: '8',
            lang: 'de'
        });

        const response = await fetch(`https://photon.komoot.io/api?${searchParams}`, {
            headers: {
                'User-Agent': 'UniversalCoordinateCalculator/1.0',
                'Accept': 'application/json'
            },
            signal: signal,
            timeout: 6000
        });

        if (!response.ok) {
            throw new Error(`Photon HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!data.features || !Array.isArray(data.features)) {
            return [];
        }

        return data.features
            .filter(feature =>
                feature.geometry &&
                feature.geometry.coordinates &&
                feature.geometry.coordinates.length >= 2
            )
            .map(feature => ({
                lat: feature.geometry.coordinates[1],
                lon: feature.geometry.coordinates[0],
                display_name: buildDisplayName(feature.properties),
                type: feature.properties.osm_value || feature.properties.type || 'place',
                importance: parseFloat(feature.properties.importance) || 0.4,
                source: 'photon'
            }));

    } catch (error) {
        console.warn('Photon search failed:', error.message);
        return [];
    }
}

function buildDisplayName(props) {
    const parts = [];
    if (props.name) parts.push(props.name);
    if (props.street) parts.push(props.street);
    if (props.housenumber) parts[parts.length - 1] += ` ${props.housenumber}`;
    if (props.city) parts.push(props.city);
    if (props.state) parts.push(props.state);
    if (props.country) parts.push(props.country);
    return parts.join(', ');
}

async function performFallbackSearch(query) {
    try {
        // Einfache Fallback-Suche mit Nominatim
        const searchParams = new URLSearchParams({
            format: 'json',
            q: query,
            limit: '5',
            addressdetails: '0'
        });

        const response = await fetch(`https://nominatim.openstreetmap.org/search?${searchParams}`, {
            headers: {
                'User-Agent': 'UniversalCoordinateCalculator/1.0',
                'Accept': 'application/json'
            },
            timeout: 10000
        });

        if (!response.ok) {
            throw new Error(`Fallback HTTP ${response.status}`);
        }

        const results = await response.json();

        return results.filter(r => r.lat && r.lon && r.display_name).map(r => ({
            lat: r.lat,
            lon: r.lon,
            display_name: r.display_name,
            type: r.type || 'place',
            importance: parseFloat(r.importance) || 0.3,
            source: 'fallback'
        }));

    } catch (error) {
        console.warn('Fallback search failed:', error.message);
        return [];
    }
}

function deduplicateResults(results) {
    const seen = new Map();
    const filtered = [];

    for (const result of results) {
        const lat = Math.round(parseFloat(result.lat) * 1000) / 1000;
        const lon = Math.round(parseFloat(result.lon) * 1000) / 1000;
        const key = `${lat},${lon}`;

        if (!seen.has(key)) {
            seen.set(key, true);
            filtered.push(result);
        }
    }

    return filtered.sort((a, b) => (b.importance || 0.5) - (a.importance || 0.5));
}

function showSuggestions(results) {
    const suggestions = document.getElementById('suggestions');

    suggestions.innerHTML = results.map((result) => {
        const address = result.display_name;
        const lat = parseFloat(result.lat);
        const lng = parseFloat(result.lon);
        const type = result.type || '';

        // Einfache Icon-Zuordnung
        let icon = '📍';
        if (type.includes('city') || type.includes('town') || type.includes('village')) {
            icon = '🏘️';
        } else if (type.includes('house') || type.includes('building')) {
            icon = '🏠';
        } else if (type.includes('road') || type.includes('street')) {
            icon = '🛣️';
        } else if (type.includes('railway') || type.includes('station')) {
            icon = '🚉';
        } else if (type.includes('tourism')) {
            icon = '🎯';
        }

        // Adresse intelligent kürzen
        const shortAddress = address.length > 60 ?
            address.split(',').slice(0, 2).join(', ') + '...' :
            address;

        return `
            <div class="p-3 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors"
                 onclick="selectAddress('${address.replace(/'/g, "\\'")}', ${lat}, ${lng})"
                 title="${address}">
                <div class="flex items-center gap-3">
                    <span class="text-lg flex-shrink-0">${icon}</span>
                    <div class="flex-1 min-w-0">
                        <div class="font-medium text-sm text-gray-900 truncate">${shortAddress}</div>
                        <div class="text-xs text-gray-500 mt-1">
                            📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}
                        </div>
                    </div>
                    <div class="text-gray-400">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                        </svg>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    suggestions.classList.remove('hidden');
}

function showNoResults(query) {
    const suggestions = document.getElementById('suggestions');

    const tips = [
        '💡 Versuchen Sie nur den Ortsnamen ohne Details',
        '🔤 Prüfen Sie die Schreibweise',
        '🌍 Fügen Sie das Land hinzu (z.B. "' + query + ', Deutschland")'
    ];

    const popularExamples = [
        'Berlin Brandenburger Tor',
        'München Marienplatz',
        'Hamburg Rathaus',
        'Köln Dom'
    ];

    suggestions.innerHTML = `
        <div class="p-4 bg-yellow-50 border-b border-yellow-200">
            <h3 class="font-bold text-yellow-800 mb-2">🔍 Keine Ergebnisse für "${query}"</h3>
            <div class="text-sm text-yellow-700 space-y-1">
                ${tips.map(tip => `<div>${tip}</div>`).join('')}
            </div>
        </div>

        <div class="p-3 bg-blue-50">
            <h4 class="font-medium text-blue-800 mb-2">🌟 Beliebte Beispiele:</h4>
            <div class="grid grid-cols-1 gap-1 text-sm">
                ${popularExamples.map(example =>
                    `<div class="text-blue-600 cursor-pointer hover:bg-blue-100 p-1 rounded" onclick="useExample('${example}')">${example}</div>`
                ).join('')}
            </div>
        </div>
    `;

    suggestions.classList.remove('hidden');
}

function selectAddress(address, lat, lng) {
    document.getElementById('universal-input').value = address;
    hideSuggestions();
    showOnMapInstant(lat, lng);
    setTimeout(() => convertCoordinates(), 100);
}

// === FORMAT-ERKENNUNG ===
function isGPSFormat(value) {
    const patterns = [
        /^-?\d+\.?\d*\s*,\s*-?\d+\.?\d*$/,
        /^-?\d+\.?\d*\s+-?\d+\.?\d*$/,
        /^-?\d+,\d+\s*[,;]\s*-?\d+,\d+$/,
        /^lat(?:itude)?:?\s*-?\d+\.?\d*\s*,?\s*lng?(?:ongitude)?:?\s*-?\d+\.?\d*$/i,
        /^GPS:?\s*-?\d+\.?\d*\s*,?\s*-?\d+\.?\d*$/i,
        /^\d+[°]\s*\d+['\s]*\d*\.?\d*["\s]*[NSEW]\s*,?\s*\d+[°]\s*\d+['\s]*\d*\.?\d*["\s]*[NSEW]$/i,
        /^緯度:?\s*-?\d+\.?\d*\s*,?\s*経度:?\s*-?\d+\.?\d*$/
    ];
    return patterns.some(pattern => pattern.test(value));
}

        function isMGRSFormat(value) {
            // e.g., 32U MV 12345 67890
            const pattern = /^\d{1,2}[A-Z]\s+[A-Z]{2}\s+\d{1,5}\s+\d{1,5}$/i;
            return pattern.test(value);
        }

function isUTMFormat(value) {
    const patterns = [
        /^\d{1,2}[A-Z]\s+\d{5,7}\s+\d{6,8}$/i,
        /^zone:?\s*\d{1,2}[A-Z]\s+\d{5,7}\s+\d{6,8}$/i,
        /^utm:?\s*\d{1,2}[A-Z]\s+\d{5,7}\s+\d{6,8}$/i,
        /^\d{1,2}[A-Z]\s+E:?\s*\d{5,7}\s+N:?\s*\d{6,8}$/i
    ];
    return patterns.some(pattern => pattern.test(value));
}

// === KOORDINATEN-PARSING ===
function parseGPSCoordinates(value) {
    let normalized = value.trim();
    normalized = normalized.replace(/(\d),(\d)/g, '$1.$2');

    const decimalPatterns = [
        /^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/,
        /^(-?\d+\.?\d*)\s+(-?\d+\.?\d*)$/,
        /^lat(?:itude)?:?\s*(-?\d+\.?\d*)\s*,?\s*lng?(?:ongitude)?:?\s*(-?\d+\.?\d*)$/i,
        /^GPS:?\s*(-?\d+\.?\d*)\s*,?\s*(-?\d+\.?\d*)$/i,
        /^緯度:?\s*(-?\d+\.?\d*)\s*,?\s*経度:?\s*(-?\d+\.?\d*)$/
    ];

    for (const pattern of decimalPatterns) {
        const match = normalized.match(pattern);
        if (match) {
            return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
        }
    }

    // DMS Format
    const dmsPattern = /^(\d+)[°]\s*(\d+)['\s]*(\d*\.?\d*)["\s]*([NSEW])\s*,?\s*(\d+)[°]\s*(\d+)['\s]*(\d*\.?\d*)["\s]*([NSEW])$/i;
    const dmsMatch = normalized.match(dmsPattern);
    if (dmsMatch) {
        const lat1 = parseInt(dmsMatch[1]);
        const lat2 = parseInt(dmsMatch[2]);
        const lat3 = parseFloat(dmsMatch[3] || 0);
        const latDir = dmsMatch[4].toUpperCase();

        const lng1 = parseInt(dmsMatch[5]);
        const lng2 = parseInt(dmsMatch[6]);
        const lng3 = parseFloat(dmsMatch[7] || 0);
        const lngDir = dmsMatch[8].toUpperCase();

        let lat = lat1 + lat2/60 + lat3/3600;
        let lng = lng1 + lng2/60 + lng3/3600;

        if (latDir === 'S') lat = -lat;
        if (lngDir === 'W') lng = -lng;

        return { lat, lng };
    }

    return null;
}

function parseUTMCoordinates(value) {
    let normalized = value.trim();

    const patterns = [
        /^(\d{1,2})([A-Z])\s+(\d{5,7})\s+(\d{6,8})$/i,
        /^zone:?\s*(\d{1,2})([A-Z])\s+(\d{5,7})\s+(\d{6,8})$/i,
        /^utm:?\s*(\d{1,2})([A-Z])\s+(\d{5,7})\s+(\d{6,8})$/i,
        /^(\d{1,2})([A-Z])\s+E:?\s*(\d{5,7})\s+N:?\s*(\d{6,8})$/i
    ];

    for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (match) {
            const zone = match[1] + match[2].toUpperCase();
            const easting = parseInt(match[3]);
            const northing = parseInt(match[4]);

            return { zone, easting, northing };
        }
    }

    return null;
}

// === KOORDINATEN-UMRECHNUNG ===
function latLngToUTM(lat, lng) {
    try {
        const zone = Math.floor((lng + 180) / 6) + 1;
        const isNorthern = lat >= 0;
        const epsgCode = isNorthern ? `EPSG:${32600 + zone}` : `EPSG:${32700 + zone}`;

        const utmCoords = proj4('EPSG:4326', epsgCode, [lng, lat]);
        const easting = Math.round(utmCoords[0]);
        const northing = Math.round(utmCoords[1]);
        const band = getUTMBand(lat);

        return `${zone}${band} ${easting} ${northing}`;
    } catch (error) {
        return 'Fehler bei UTM-Umrechnung';
    }
}

function utmToLatLng(zone, easting, northing) {
    const zonePattern = /^(\d{1,2})([A-Z])$/;
    const match = zone.match(zonePattern);
    if (!match) throw new Error('Ungültiges UTM-Zonenformat');

    const zoneNum = parseInt(match[1]);
    const band = match[2];
    const isNorthern = band >= 'N';
    const epsgCode = isNorthern ? `EPSG:${32600 + zoneNum}` : `EPSG:${32700 + zoneNum}`;

    const gpsCoords = proj4(epsgCode, 'EPSG:4326', [easting, northing]);

    return { lat: gpsCoords[1], lng: gpsCoords[0] };
}

function getUTMBand(lat) {
    if (lat >= 84) return 'X';
    if (lat >= 72) return 'X';
    if (lat >= 64) return 'W';
    if (lat >= 56) return 'V';
    if (lat >= 48) return 'U';
    if (lat >= 40) return 'T';
    if (lat >= 32) return 'S';
    if (lat >= 24) return 'R';
    if (lat >= 16) return 'P';
    if (lat >= 8) return 'Q';
    if (lat >= 0) return 'N';
    if (lat >= -8) return 'M';
    if (lat >= -16) return 'L';
    if (lat >= -24) return 'K';
    if (lat >= -32) return 'J';
    if (lat >= -40) return 'H';
    if (lat >= -48) return 'G';
    if (lat >= -56) return 'F';
    if (lat >= -64) return 'E';
    if (lat >= -72) return 'D';
    return 'C';
}

// === HAUPTFUNKTION ===
async function convertCoordinates() {
    const input = document.getElementById('universal-input').value.trim();

    if (!input) {
        showMessage('Bitte geben Sie Koordinaten oder eine Adresse ein!', 'error');
        return;
    }

    let lat, lng, inputType = '';

    try {
        if (detectedFormat === 'gps') {
            const coords = parseGPSCoordinates(input);
            if (coords && isValidCoordinates(coords.lat, coords.lng)) {
                lat = coords.lat;
                lng = coords.lng;
                inputType = 'GPS';
            } else {
                throw new Error('Ungültiges GPS-Format');
            }

        } else if (detectedFormat === 'utm') {
            const utm = parseUTMCoordinates(input);
            if (utm && utm.zone && utm.easting && utm.northing) {
                const coords = utmToLatLng(utm.zone, utm.easting, utm.northing);
                lat = coords.lat;
                lng = coords.lng;
                inputType = 'UTM';
            } else {
                throw new Error('Ungültiges UTM-Format');
            }

        } else if (detectedFormat === 'mgrs') {
            const latLon = mgrs.toPoint(input);
            lng = latLon[0];
            lat = latLon[1];
            inputType = 'MGRS';
        } else if (detectedFormat === 'address') {
            if (currentMarker) {
                const markerPos = currentMarker.getLatLng();
                lat = markerPos.lat;
                lng = markerPos.lng;
                inputType = 'Adresse';
            } else {
                const coords = await geocodeAddress(input);
                if (coords) {
                    lat = coords.lat;
                    lng = coords.lng;
                    inputType = 'Adresse';
                } else {
                    throw new Error('Adresse nicht gefunden');
                }
            }
        } else {
            throw new Error('Format nicht erkannt');
        }

        if (lat !== undefined && lng !== undefined) {
            // Automatisch nächste Adresse ermitteln bei GPS/UTM/MGRS-Eingabe
            let nearestAddress = null;
            if (inputType === 'GPS' || inputType === 'UTM' || inputType === 'MGRS') {
                try {
                    showMessage('Ermittle nächste Adresse...', 'success');
                    nearestAddress = await reverseGeocode(lat, lng);
                } catch (error) {
                    console.warn('Reverse geocoding failed:', error);
                }
            }

            showResults(lat, lng, inputType, nearestAddress);
            showOnMap(lat, lng, inputType);
            showMessage(`${inputType}-Koordinaten erfolgreich umgerechnet!`, 'success');
        }

    } catch (error) {
        showMessage('Fehler: ' + error.message, 'error');
    }
}

// === KARTEN-FUNKTIONEN ===
function showOnMapInstant(lat, lng) {
    if (!isValidCoordinates(lat, lng)) return;

    if (currentMarker) map.removeLayer(currentMarker);
    currentMarker = L.marker([lat, lng]).addTo(map);

    const currentCenter = map.getCenter();
    const distance = map.distance(currentCenter, [lat, lng]);

    if (distance > 1000) {
        map.setView([lat, lng], Math.max(map.getZoom(), 12));
    } else {
        map.panTo([lat, lng]);
    }
}

function showOnMap(lat, lng, inputType = '') {
    if (!isValidCoordinates(lat, lng)) return;

    if (currentMarker) map.removeLayer(currentMarker);
    currentMarker = L.marker([lat, lng]).addTo(map);

    const utmCoords = latLngToUTM(lat, lng);
    const title = inputType ? `📍 ${inputType}-Position` : '📍 Umgerechnete Position';

    currentMarker.bindPopup(`
        <div class="text-center p-3">
            <h3 class="font-bold mb-2 text-gray-800">${title}</h3>
            <div class="text-sm">
                <strong>GPS:</strong> ${lat.toFixed(6)}, ${lng.toFixed(6)}<br>
                <strong>UTM:</strong> ${utmCoords}
            </div>
        </div>
    `).openPopup();

    map.setView([lat, lng], 15);
}

function clearMap() {
    if (currentMarker) map.removeLayer(currentMarker);
    currentMarker = null;
    document.getElementById('results-section').classList.add('hidden');
}

// === ERGEBNISSE ANZEIGEN ===
function showResults(lat, lng, inputType = '', nearestAddress = null) {
    const utmCoords = latLngToUTM(lat, lng);
    const dmsCoords = decimalToDMS(lat, lng);
    const gpsDecimal = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

    const gpsHighlight = inputType === 'GPS' ? 'ring-2 ring-blue-400' : '';
    const utmHighlight = inputType === 'UTM' ? 'ring-2 ring-purple-400' : '';
    const mgrsHighlight = inputType === 'MGRS' ? 'ring-2 ring-red-400' : '';
    const addressHighlight = inputType === 'Adresse' ? 'ring-2 ring-orange-400' : '';

    const mgrsCoords = mgrs.forward([lng, lat]);

    let addressSection = '';

    // Zeige Eingabe-Adresse bei Adress-Eingabe
    if (inputType === 'Adresse') {
        addressSection = `
            <div class="bg-orange-50 border border-orange-200 rounded-lg p-3 sm:p-4 hover:shadow-md transition-shadow sm:col-span-2 ${addressHighlight}">
                <h3 class="font-bold text-orange-800 mb-2 text-sm sm:text-base">🏠 Adresse (Eingabe)</h3>
                <div class="text-orange-700 text-sm">${document.getElementById('universal-input').value}</div>
            </div>
        `;
    }

    // Zeige nächste Adresse bei GPS/UTM-Eingabe
    if ((inputType === 'GPS' || inputType === 'UTM') && nearestAddress) {
        addressSection = `
            <div class="bg-teal-50 border border-teal-200 rounded-lg p-3 sm:p-4 hover:shadow-md transition-shadow sm:col-span-2">
                <h3 class="font-bold text-teal-800 mb-2 text-sm sm:text-base">🏠 Nächste Adresse</h3>
                <div class="text-teal-700 text-sm">${nearestAddress}</div>
                <div class="text-xs text-teal-600 mt-1">Automatisch ermittelt basierend auf den Koordinaten</div>
            </div>
        `;
    }

    const resultsHTML = `
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4 hover:shadow-md transition-shadow ${gpsHighlight}">
            <h3 class="font-bold text-blue-800 mb-2 text-sm sm:text-base">🛰️ GPS Dezimal ${inputType === 'GPS' ? '(Eingabe)' : ''}</h3>
            <div class="coordinate-display text-blue-700">${gpsDecimal}</div>
        </div>

        <div class="bg-green-50 border border-green-200 rounded-lg p-3 sm:p-4 hover:shadow-md transition-shadow">
            <h3 class="font-bold text-green-800 mb-2 text-sm sm:text-base">🛰️ GPS Grad/Min/Sek</h3>
            <div class="coordinate-display text-green-700 text-xs sm:text-sm">${dmsCoords}</div>
        </div>

        <div class="bg-purple-50 border border-purple-200 rounded-lg p-3 sm:p-4 hover:shadow-md transition-shadow ${utmHighlight}">
            <h3 class="font-bold text-purple-800 mb-2 text-sm sm:text-base">📐 UTM ${inputType === 'UTM' ? '(Eingabe)' : ''}</h3>
            <div class="coordinate-display text-purple-700">${utmCoords}</div>
        </div>

        <div class="bg-gray-50 border border-gray-200 rounded-lg p-3 sm:p-4 hover:shadow-md transition-shadow">
            <h3 class="font-bold text-gray-800 mb-2 text-sm sm:text-base">📱 Google Maps</h3>
            <a href="https://maps.google.com/?q=${lat},${lng}" target="_blank"
               class="block text-blue-600 hover:text-blue-800 text-sm underline break-all">
                🗺️ In Google Maps öffnen
            </a>
        </div>

        <div class="bg-red-50 border border-red-200 rounded-lg p-3 sm:p-4 hover:shadow-md transition-shadow ${mgrsHighlight}">
            <h3 class="font-bold text-red-800 mb-2 text-sm sm:text-base">🌐 MGRS ${inputType === 'MGRS' ? '(Eingabe)' : ''}</h3>
            <div class="coordinate-display text-red-700">${mgrsCoords}</div>
        </div>

        ${addressSection}
    `;

    document.getElementById('conversion-results').innerHTML = resultsHTML;
    const resultsSection = document.getElementById('results-section');
    resultsSection.classList.remove('hidden');
    resultsSection.classList.add('fade-in');
}

// === HILFSFUNKTIONEN ===
function updateFormatIndicator(format, iconText, statusText) {
    const indicator = document.getElementById('format-indicator');
    const icon = document.getElementById('format-icon');
    const text = document.getElementById('format-text');

    indicator.classList.remove('format-gps', 'format-utm', 'format-address', 'format-unknown');
    indicator.classList.add(`format-${format}`);

    icon.textContent = iconText;
    text.textContent = statusText;
}

function showValidation(message, type) {
    const validation = document.getElementById('input-validation');
    const input = document.getElementById('universal-input');

    validation.textContent = message;
    validation.classList.remove('hidden', 'text-red-600', 'text-green-600', 'text-yellow-600');
    input.classList.remove('border-red-500', 'border-green-500', 'border-yellow-500');

    if (type === 'error') {
        validation.classList.add('text-red-600');
        input.classList.add('border-red-500');
    } else if (type === 'success') {
        validation.classList.add('text-green-600');
        input.classList.add('border-green-500');
    } else if (type === 'warning') {
        validation.classList.add('text-yellow-600');
        input.classList.add('border-yellow-500');
    }

    validation.classList.remove('hidden');
}

function hideValidation() {
    const validation = document.getElementById('input-validation');
    const input = document.getElementById('universal-input');

    validation.classList.add('hidden');
    input.classList.remove('border-red-500', 'border-green-500', 'border-yellow-500');
}

function hideSuggestions() {
    document.getElementById('suggestions').classList.add('hidden');
}

function showMessage(message, type) {
    // Entferne alte Nachrichten
    const oldMessages = document.querySelectorAll('[id$="-message"]');
    oldMessages.forEach(msg => msg.remove());

    // Erstelle neue Nachricht
    const messageDiv = document.createElement('div');
    messageDiv.id = `${type}-message-${Date.now()}`;
    messageDiv.className = `fixed top-4 right-4 z-50 max-w-sm bg-${type === 'error' ? 'red' : 'green'}-50 border border-${type === 'error' ? 'red' : 'green'}-200 rounded-lg p-4 shadow-lg`;

    const icon = type === 'error' ? '❌' : '✅';
    const title = type === 'error' ? 'Fehler' : 'Erfolgreich';
    const colorClass = type === 'error' ? 'red' : 'green';

    messageDiv.innerHTML = `
        <div class="flex items-center">
            <span class="text-${colorClass}-600 text-xl mr-3">${icon}</span>
            <div class="flex-1">
                <h3 class="font-bold text-${colorClass}-800 text-sm">${title}</h3>
                <p class="text-${colorClass}-700 text-sm">${message}</p>
            </div>
            <button onclick="this.parentElement.parentElement.remove()" class="ml-2 text-${colorClass}-400 hover:text-${colorClass}-600">✕</button>
        </div>
    `;

    document.body.appendChild(messageDiv);

    // Auto-remove nach 5 Sekunden
    setTimeout(() => {
        if (messageDiv.parentNode) {
            messageDiv.remove();
        }
    }, 5000);
}

function isValidCoordinates(lat, lng) {
    return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function decimalToDMS(lat, lng) {
    function toDMS(coord, isLat) {
        const absolute = Math.abs(coord);
        const degrees = Math.floor(absolute);
        const minutesFloat = (absolute - degrees) * 60;
        const minutes = Math.floor(minutesFloat);
        const seconds = ((minutesFloat - minutes) * 60).toFixed(1);
        const direction = isLat ? (coord >= 0 ? 'N' : 'S') : (coord >= 0 ? 'E' : 'W');
        return `${degrees}°${minutes}'${seconds}"${direction}`;
    }
    return `${toDMS(lat, true)}, ${toDMS(lng, false)}`;
}

async function geocodeAddress(address) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`);
        const data = await response.json();

        if (data && data.length > 0) {
            return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        }
        return null;
    } catch (error) {
        console.error('Geocoding error:', error);
        return null;
    }
}

function loadClickedCoordinates(lat, lng) {
    document.getElementById('universal-input').value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    map.closePopup();
    analyzeInput();
    setTimeout(() => convertCoordinates(), 100);
}

// === BEISPIEL-FUNKTIONEN ===
function toggleExamples(type) {
    const allExamples = ['gps-examples', 'utm-examples', 'address-examples', 'mgrs-examples'];
    if (!type) { // a falsy type means close all
        allExamples.forEach(id => document.getElementById(id).classList.add('hidden'));
        return;
    }

    const targetExample = type + '-examples';

    // Alle anderen schließen
    allExamples.forEach(id => {
        if (id !== targetExample) {
            document.getElementById(id).classList.add('hidden');
        }
    });

    // Gewähltes ein-/ausblenden
    const target = document.getElementById(targetExample);
    if (target) {
        target.classList.toggle('hidden');
    }
}

function useExample(example) {
    const input = document.getElementById('universal-input');
    input.value = example;
    input.focus();

    // Alle Beispiele schließen
    ['gps-examples', 'utm-examples', 'address-examples'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });

    // Eingabe analysieren
    analyzeInput();
}

// === DRUCKFUNKTIONEN ===
async function printCoordinates() {
    if (!currentMarker) {
        showMessage('Bitte zuerst eine Position auf der Karte markieren!', 'error');
        return;
    }

    const markerPos = currentMarker.getLatLng();
    const lat = markerPos.lat;
    const lng = markerPos.lng;
    const utmCoords = latLngToUTM(lat, lng);
    const dmsCoords = decimalToDMS(lat, lng);
            const mgrsCoords = mgrs.forward([lng, lat]);
    const currentDate = new Date().toLocaleDateString('de-DE');
    const currentTime = new Date().toLocaleTimeString('de-DE');

    showMessage('Karten werden für den Druck vorbereitet...', 'success');

    // Adresse ermitteln falls GPS/UTM eingegeben wurde
    let addressInfo = '';
    const inputValue = document.getElementById('universal-input').value.trim();

    if (detectedFormat === 'gps' || detectedFormat === 'utm') {
        showMessage('Ermittle nächste Adresse...', 'success');
        try {
            const nearestAddress = await reverseGeocode(lat, lng);
            if (nearestAddress) {
                addressInfo = `
                    <tr>
                        <td class="label-cell">Nächste Adresse:</td>
                        <td class="value-cell">${nearestAddress}</td>
                    </tr>
                `;
            }
        } catch (error) {
            console.warn('Reverse geocoding failed:', error);
        }
    } else if (detectedFormat === 'address') {
        addressInfo = `
            <tr>
                <td class="label-cell">Eingabe-Adresse:</td>
                <td class="value-cell">${inputValue}</td>
            </tr>
        `;
    }

    const printContent = document.getElementById('print-content');
    printContent.innerHTML = `
        <div class="print-header">
            <h1>🌍 Koordinaten-Übersicht</h1>
            <p>Erstellt am: ${currentDate} um ${currentTime} • Position: ${lat.toFixed(6)}, ${lng.toFixed(6)}</p>
        </div>

        <div class="print-section">
            <h2>📊 Koordinaten & QR-Code</h2>
            <div style="display: flex; gap: 15px; align-items: flex-start;">
                <div style="flex: 1;">
                    <div class="print-coordinates-box">
                        <table class="print-coordinates-table">
                            <tr>
                                <td class="label-cell">GPS Dezimal:</td>
                                <td class="value-cell">${lat.toFixed(6)}, ${lng.toFixed(6)}</td>
                            </tr>
                            <tr>
                                <td class="label-cell">GPS Grad/Min/Sek:</td>
                                <td class="value-cell">${dmsCoords}</td>
                            </tr>
                            <tr>
                                <td class="label-cell">UTM:</td>
                                <td class="value-cell">${utmCoords}</td>
                            </tr>
                                    <tr>
                                        <td class="label-cell">MGRS:</td>
                                        <td class="value-cell">${mgrsCoords}</td>
                                    </tr>
                            ${addressInfo}
                        </table>
                    </div>
                </div>
                <div class="print-qr-container">
                    <div style="text-align: center;">
                        <div style="font-weight: bold; font-size: 11px; margin-bottom: 5px;">📱 Mobile Navigation</div>
                        <div style="background: white; padding: 8px; border: 1px solid #333; border-radius: 4px; display: inline-block;">
                            <canvas id="qr-canvas" width="100" height="100" style="display: block;"></canvas>
                        </div>
                        <div style="font-size: 9px; margin-top: 5px; color: #666; max-width: 120px;">
                            QR-Code scannen für Karten-App
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="print-section">
            <h2>🗺️ Kartenansichten - Verschiedene Zoom-Stufen & Kartentypen</h2>

            <!-- Erste Zeile: Übersicht (volle Breite) -->
            <div class="print-maps-grid">
                <div class="print-map-container full-width">
                    <img id="print-map-overview" class="print-map" src="" alt="Übersicht wird geladen..." style="object-fit: cover;">
                    <div class="print-center-point"></div>
                    <div class="print-map-label">🌍 Übersicht (800m Radius) - Standard Karte</div>
                    <div class="loading-spinner" id="spinner-overview"></div>
                </div>

                <!-- Zweite Zeile: Nahbereich und Detail -->
                <div class="print-map-container">
                    <img id="print-map-medium" class="print-map" src="" alt="Nahbereich wird geladen..." style="object-fit: cover;">
                    <div class="print-center-point"></div>
                    <div class="print-map-label">🔍 Nahbereich (200m)</div>
                    <div class="loading-spinner" id="spinner-medium"></div>
                </div>

                <div class="print-map-container">
                    <img id="print-map-detail" class="print-map" src="" alt="Detail wird geladen..." style="object-fit: cover;">
                    <div class="print-center-point"></div>
                    <div class="print-map-label">🎯 Detail (50m)</div>
                    <div class="loading-spinner" id="spinner-detail"></div>
                </div>

                <!-- Dritte Zeile: Satellit und Topographie -->
                <div class="print-map-container">
                    <img id="print-map-satellite" class="print-map" src="" alt="Satellitenansicht wird geladen..." style="object-fit: cover;">
                    <div class="print-center-point"></div>
                    <div class="print-map-label">🛰️ Satellitenansicht</div>
                    <div class="loading-spinner" id="spinner-satellite"></div>
                </div>

                <div class="print-map-container">
                    <img id="print-map-topo" class="print-map" src="" alt="Topographische Ansicht wird geladen..." style="object-fit: cover;">
                    <div class="print-center-point"></div>
                    <div class="print-map-label">⛰️ Topographische Karte</div>
                    <div class="loading-spinner" id="spinner-topo"></div>
                </div>
            </div>
        </div>


    `;

    // Print-Content anzeigen
    printContent.style.display = 'block';

    try {
        const size = 640; // Höhere Auflösung für bessere Druckqualität

        // Fünf Kartenansichten mit verschiedenen Zoom-Stufen und Typen
        const zoomLevels = [
            { id: 'overview', zoom: 13, type: 'osm', label: 'Übersicht (800m)' },
            { id: 'medium', zoom: 15, type: 'osm', label: 'Nahbereich (200m)' },
            { id: 'detail', zoom: 17, type: 'osm', label: 'Detail (50m)' },
            { id: 'satellite', zoom: 18, type: 'satellite', label: 'Satellitenansicht (200m)' },
            { id: 'topo', zoom: 15, type: 'topo', label: 'Topographische Ansicht (200m)' }
        ];

        // Karten parallel laden für bessere Performance
        const mapPromises = zoomLevels.map(async (level) => {
            try {
                const mapUrl = await generateStaticMapUrl(lat, lng, level.zoom, size, level.type);
                const imgElement = document.getElementById(`print-map-${level.id}`);
                const spinnerElement = document.getElementById(`spinner-${level.id}`);

                return new Promise((resolve, reject) => {
                    imgElement.onload = () => {
                        if (spinnerElement) spinnerElement.style.display = 'none';
                        resolve();
                    };
                    imgElement.onerror = () => {
                        if (spinnerElement) spinnerElement.style.display = 'none';
                        console.warn(`Fehler beim Laden der ${level.label}`);
                        resolve(); // Trotzdem weitermachen
                    };
                    imgElement.src = mapUrl;

                    // Timeout nach 10 Sekunden
                    setTimeout(() => {
                        if (spinnerElement) spinnerElement.style.display = 'none';
                        resolve();
                    }, 10000);
                });
            } catch (error) {
                console.warn(`Fehler bei ${level.label}:`, error);
                const spinnerElement = document.getElementById(`spinner-${level.id}`);
                if (spinnerElement) spinnerElement.style.display = 'none';
            }
        });

        // Warten bis alle Karten geladen sind
        await Promise.allSettled(mapPromises);

        // QR-Code generieren (kleinere Größe für A4-Optimierung)
        generateQRCodeForPrint(lat, lng);

        showMessage('Alle Karten und QR-Codes erfolgreich geladen! Druckvorschau wird geöffnet...', 'success');

        // Drucken nach kurzer Verzögerung
        setTimeout(() => {
            window.print();
        }, 1000);

    } catch (error) {
        console.error('Fehler beim Laden der Karten:', error);
        showMessage('Fehler beim Laden der Karten. Drucke trotzdem...', 'error');
        setTimeout(() => {
            window.print();
        }, 500);
    }
}

// Reverse Geocoding für nächste Adresse
async function reverseGeocode(lat, lng) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=de,en`,
            {
                headers: {
                    'User-Agent': 'UniversalCoordinateCalculator/1.0',
                    'Accept': 'application/json'
                },
                timeout: 8000
            }
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data && data.display_name) {
            return data.display_name;
        } else if (data && data.address) {
            // Fallback: Adresse aus Komponenten zusammenbauen
            const addr = data.address;
            const parts = [];

            if (addr.house_number && addr.road) {
                parts.push(`${addr.road} ${addr.house_number}`);
            } else if (addr.road) {
                parts.push(addr.road);
            }

            if (addr.postcode && addr.city) {
                parts.push(`${addr.postcode} ${addr.city}`);
            } else if (addr.city || addr.town || addr.village) {
                parts.push(addr.city || addr.town || addr.village);
            }

            if (addr.country) {
                parts.push(addr.country);
            }

            return parts.length > 0 ? parts.join(', ') : 'Adresse nicht verfügbar';
        }

        return 'Adresse nicht verfügbar';

    } catch (error) {
        console.warn('Reverse geocoding failed:', error);
        return 'Adresse konnte nicht ermittelt werden';
    }
}

// === FUNKTIONIERENDER QR-CODE GENERATOR ===
function generateQRCode(lat, lng) {
    try {
        // Erstelle universellen geo: URI - funktioniert mit allen Karten-Apps
        const geoUri = `geo:${lat.toFixed(6)},${lng.toFixed(6)}`;

        const canvas = document.getElementById('qr-canvas');
        if (!canvas) {
            console.error('QR-Canvas nicht gefunden');
            return;
        }

        // Verwende qrcode-generator Bibliothek (funktioniert garantiert)
        const qr = qrcode(0, 'M'); // Type 0 (auto), Error correction level M
        qr.addData(geoUri);
        qr.make();

        // Zeichne QR-Code auf Canvas
        const ctx = canvas.getContext('2d');
        const moduleCount = qr.getModuleCount();
        const cellSize = Math.floor(150 / moduleCount);
        const margin = Math.floor((150 - (cellSize * moduleCount)) / 2);

        // Weißer Hintergrund
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, 150, 150);

        // Schwarze Module
        ctx.fillStyle = '#000000';
        for (let row = 0; row < moduleCount; row++) {
            for (let col = 0; col < moduleCount; col++) {
                if (qr.isDark(row, col)) {
                    ctx.fillRect(
                        margin + col * cellSize,
                        margin + row * cellSize,
                        cellSize,
                        cellSize
                    );
                }
            }
        }

        console.log('QR-Code erfolgreich generiert:', geoUri);

    } catch (error) {
        console.error('Fehler beim Generieren des QR-Codes:', error);

        // Fallback: Zeige Fehlermeldung
        const canvas = document.getElementById('qr-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#f8f9fa';
            ctx.fillRect(0, 0, 150, 150);
            ctx.fillStyle = '#666';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('QR-Code', 75, 70);
            ctx.fillText('Fehler', 75, 85);
        }
    }
}

// === QR-CODE GENERATOR FÜR DRUCK (OPTIMIERT) ===
function generateQRCodeForPrint(lat, lng) {
    try {
        // Erstelle universellen geo: URI - funktioniert mit allen Karten-Apps
        const geoUri = `geo:${lat.toFixed(6)},${lng.toFixed(6)}?z=18`;

        const canvas = document.getElementById('qr-canvas');
        if (!canvas) {
            console.error('QR-Canvas nicht gefunden');
            return;
        }

        // Verwende qrcode-generator Bibliothek (funktioniert garantiert)
        const qr = qrcode(0, 'M'); // Type 0 (auto), Error correction level M
        qr.addData(geoUri);
        qr.make();

        // Zeichne QR-Code auf Canvas (100x100 für Druck optimiert)
        const ctx = canvas.getContext('2d');
        const moduleCount = qr.getModuleCount();
        const cellSize = Math.floor(100 / moduleCount);
        const margin = Math.floor((100 - (cellSize * moduleCount)) / 2);

        // Weißer Hintergrund
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, 100, 100);

        // Schwarze Module
        ctx.fillStyle = '#000000';
        for (let row = 0; row < moduleCount; row++) {
            for (let col = 0; col < moduleCount; col++) {
                if (qr.isDark(row, col)) {
                    ctx.fillRect(
                        margin + col * cellSize,
                        margin + row * cellSize,
                        cellSize,
                        cellSize
                    );
                }
            }
        }

        console.log('QR-Code für Druck erfolgreich generiert:', geoUri);

    } catch (error) {
        console.error('Fehler beim Generieren des QR-Codes für Druck:', error);

        // Fallback: Zeige Fehlermeldung
        const canvas = document.getElementById('qr-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#f8f9fa';
            ctx.fillRect(0, 0, 100, 100);
            ctx.fillStyle = '#666';
            ctx.font = '10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('QR-Code', 50, 45);
            ctx.fillText('Fehler', 50, 60);
        }
    }
}

// Statische Karten-URL generieren mit präziser Zentrierung
async function generateStaticMapUrl(lat, lng, zoom, size, type) {
    // Verwende MapProxy für präzise statische Karten mit Marker
    const bbox = calculateBoundingBox(lat, lng, zoom, size);

    let tileServer;
    switch (type) {
        case 'satellite':
            // Esri World Imagery - Hochauflösend
            tileServer = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
            break;
        case 'topo':
            // OpenTopoMap
            tileServer = 'https://tile.opentopomap.org/{z}/{x}/{y}.png';
            break;
        case 'osm':
        default:
            // Standard OpenStreetMap
            tileServer = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
            break;
    }

    // Erstelle statische Karte mit präziser Zentrierung
    return await createStaticMap(lat, lng, zoom, size, tileServer);
}

function calculateBoundingBox(lat, lng, zoom, size) {
    // Berechne die Bounding Box für die gewünschte Kartengröße
    const earthRadius = 6378137; // Erdradius in Metern
    const metersPerPixel = (2 * Math.PI * earthRadius) / (256 * Math.pow(2, zoom));

    const halfWidth = (size / 2) * metersPerPixel;
    const halfHeight = (size / 2) * metersPerPixel;

    const deltaLat = halfHeight / earthRadius * (180 / Math.PI);
    const deltaLng = halfWidth / (earthRadius * Math.cos(lat * Math.PI / 180)) * (180 / Math.PI);

    return {
        north: lat + deltaLat,
        south: lat - deltaLat,
        east: lng + deltaLng,
        west: lng - deltaLng
    };
}

async function createStaticMap(lat, lng, zoom, size, tileServer) {
    // Erstelle Canvas für präzise Kartenpositionierung
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Berechne Tile-Koordinaten für exakte Zentrierung
    const tileSize = 256;
    const scale = Math.pow(2, zoom);
    const worldCoordX = (lng + 180) / 360 * scale;
    const worldCoordY = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * scale;

    // Berechne welche Tiles benötigt werden
    const centerTileX = Math.floor(worldCoordX);
    const centerTileY = Math.floor(worldCoordY);

    // Pixel-Offset innerhalb des Center-Tiles
    const offsetX = (worldCoordX - centerTileX) * tileSize;
    const offsetY = (worldCoordY - centerTileY) * tileSize;

    // Berechne Start-Position für Tiles
    const startX = Math.floor(size / 2 - offsetX);
    const startY = Math.floor(size / 2 - offsetY);

    // Lade und zeichne Tiles
    const tilesNeeded = Math.ceil(size / tileSize) + 1;
    const tilePromises = [];

    for (let x = -1; x <= tilesNeeded; x++) {
        for (let y = -1; y <= tilesNeeded; y++) {
            const tileX = centerTileX + x;
            const tileY = centerTileY + y;

            if (tileX >= 0 && tileY >= 0 && tileX < scale && tileY < scale) {
                const tileUrl = tileServer
                    .replace('{z}', zoom)
                    .replace('{x}', tileX)
                    .replace('{y}', tileY);

                tilePromises.push(loadTileImage(tileUrl, startX + x * tileSize, startY + y * tileSize));
            }
        }
    }

    try {
        const tileImages = await Promise.all(tilePromises);

        // Zeichne alle Tiles auf Canvas
        tileImages.forEach(({ img, x, y }) => {
            if (img && img.complete) {
                ctx.drawImage(img, x, y, tileSize, tileSize);
            }
        });

        // Konvertiere Canvas zu Data URL
        return canvas.toDataURL('image/png');

    } catch (error) {
        console.warn('Fehler beim Erstellen der statischen Karte:', error);
        // Fallback: Verwende einzelnes Tile
        return createFallbackMap(lat, lng, zoom, size, tileServer);
    }
}

function loadTileImage(url, x, y) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve({ img, x, y });
        img.onerror = () => resolve({ img: null, x, y });
        img.src = url;

        // Timeout nach 5 Sekunden
        setTimeout(() => resolve({ img: null, x, y }), 5000);
    });
}

async function createFallbackMap(lat, lng, zoom, size, tileServer) {
    // Einfacher Fallback: Verwende einzelnes zentrales Tile
    const scale = Math.pow(2, zoom);
    const tileX = Math.floor((lng + 180) / 360 * scale);
    const tileY = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * scale);

    const tileUrl = tileServer
        .replace('{z}', zoom)
        .replace('{x}', tileX)
        .replace('{y}', tileY);

    return tileUrl;
}







// === EVENT LISTENERS ===
document.addEventListener('DOMContentLoaded', function() {
    initProjections();
    setTimeout(initMap, 100);

    document.addEventListener('click', function(e) {
        const suggestions = document.getElementById('suggestions');
        const input = document.getElementById('universal-input');

        if (!suggestions.contains(e.target) && e.target !== input) {
            hideSuggestions();
        }
    });

    // Setzt das aktuelle Jahr in den Footer
    document.getElementById('current-year').textContent = new Date().getFullYear();
});

document.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        const activeElement = document.activeElement;
        if (activeElement && activeElement.id === 'universal-input') {
            convertCoordinates();
        }
    }
});

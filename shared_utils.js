// =================================================================================
// == Shared Utility Functions for Universal Coordinate Calculator and MGRS Map ==
// =================================================================================

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
        /^\d{1,2}[A-Z]\s+E:?\s*(\d{5,7})\s+N:?\s*\d{6,8}$/i
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


// === HILFSFUNKTIONEN ===

function isValidCoordinates(lat, lng) {
    return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

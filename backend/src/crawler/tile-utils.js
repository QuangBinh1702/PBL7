/**
 * Convert lat/lon to slippy map tile coordinates at a given zoom level.
 * Reference: https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
 */

function lonToTileX(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function latToTileY(lat, zoom) {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      Math.pow(2, zoom)
  );
}

/**
 * Convert bbox [minLon, minLat, maxLon, maxLat] to list of tile {z, x, y}
 */
function bboxToTiles(bbox, zoom) {
  const [minLon, minLat, maxLon, maxLat] = bbox;

  const xMin = lonToTileX(minLon, zoom);
  const xMax = lonToTileX(maxLon, zoom);
  const yMin = latToTileY(maxLat, zoom); // Note: y is inverted
  const yMax = latToTileY(minLat, zoom);

  const tiles = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      tiles.push({ z: zoom, x, y });
    }
  }
  return tiles;
}

/**
 * Convert tile pixel coordinates to lon/lat (for MVT feature extraction)
 */
function tileCoordsToLonLat(tileX, tileY, zoom, pixelX, pixelY, extent) {
  const n = Math.pow(2, zoom);
  const lon = ((tileX + pixelX / extent) / n) * 360 - 180;
  const latRad = Math.atan(
    Math.sinh(Math.PI * (1 - (2 * (tileY + pixelY / extent)) / n))
  );
  const lat = (latRad * 180) / Math.PI;
  return { lon, lat };
}

module.exports = { bboxToTiles, tileCoordsToLonLat, lonToTileX, latToTileY };

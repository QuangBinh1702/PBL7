const express = require('express');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');
require('dotenv').config({ path: __dirname + '/../../.env' });

const app = express();
const PORT = process.env.API_PORT || 3000;

// CORS for frontend
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept');
  next();
});

// Serve downloaded thumbnails
app.use('/thumbs', express.static(path.join(__dirname, '../../storage/thumbs'), {
  maxAge: '30d',
  immutable: true,
}));
app.use('/thumbs_1024', express.static(path.join(__dirname, '../../storage/thumbs_1024'), {
  maxAge: '30d',
  immutable: true,
}));

function getThumbUrl(providerImageId, status) {
  if (status !== 'downloaded') return null;
  const hash = crypto.createHash('md5').update(providerImageId).digest('hex');
  return `/thumbs/${hash.substring(0, 2)}/${hash.substring(2, 4)}/${providerImageId}.jpg`;
}

// ====== GET /api/v1/images?bbox=minLon,minLat,maxLon,maxLat&limit=100 ======
app.get('/api/v1/images', async (req, res) => {
  try {
    const { bbox, limit = 100, cursor } = req.query;

    if (!bbox) {
      return res.status(400).json({ error: 'bbox parameter required (minLon,minLat,maxLon,maxLat)' });
    }

    const [minLon, minLat, maxLon, maxLat] = bbox.split(',').map(Number);
    if ([minLon, minLat, maxLon, maxLat].some(isNaN)) {
      return res.status(400).json({ error: 'Invalid bbox format' });
    }

    const safeLimit = Math.min(Math.max(parseInt(limit) || 100, 1), 5000);

    const result = await pool.query(
      `SELECT i.id, i.provider_image_id, i.lat, i.lon, i.captured_at, i.compass_angle, i.is_pano, i.tile_key, i.status,
              s.provider_sequence_id as sequence_id
       FROM images i
       LEFT JOIN sequences s ON i.sequence_id = s.id
       WHERE i.geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
         AND ($5::bigint IS NULL OR i.id > $5)
       ORDER BY i.captured_at, i.id
       LIMIT $6`,
      [minLon, minLat, maxLon, maxLat, cursor || null, safeLimit]
    );

    const data = result.rows.map((r) => ({
      id: r.id,
      provider_image_id: r.provider_image_id,
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      captured_at: r.captured_at,
      compass_angle: r.compass_angle,
      is_pano: r.is_pano,
      tile_key: r.tile_key,
      sequence_id: r.sequence_id,
      thumb_256_url: getThumbUrl(r.provider_image_id, r.status),
    }));

    const nextCursor = data.length === safeLimit ? data[data.length - 1].id : null;

    res.json({ data, cursor: nextCursor, count: data.length });
  } catch (err) {
    console.error('Error in /api/v1/images:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ====== GET /api/v1/images/nearby?lat=...&lon=...&radius=500&limit=20 ======
app.get('/api/v1/images/nearby', async (req, res) => {
  try {
    const { lat, lon, radius = 500, limit = 20 } = req.query;

    if (!lat || !lon) {
      return res.status(400).json({ error: 'lat and lon parameters required' });
    }

    const safeLimit = Math.min(Math.max(parseInt(limit) || 20, 1), 200);
    const safeRadius = Math.min(Math.max(parseFloat(radius) || 500, 1), 5000);

    const result = await pool.query(
      `SELECT id, provider_image_id, lat, lon, captured_at, compass_angle, is_pano, status,
              ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) as distance_m
       FROM images
       WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
       ORDER BY distance_m
       LIMIT $4`,
      [parseFloat(lat), parseFloat(lon), safeRadius, safeLimit]
    );

    const data = result.rows.map((r) => ({
      id: r.id,
      provider_image_id: r.provider_image_id,
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      captured_at: r.captured_at,
      compass_angle: r.compass_angle,
      is_pano: r.is_pano,
      distance_m: Math.round(parseFloat(r.distance_m)),
      thumb_256_url: getThumbUrl(r.provider_image_id, r.status),
    }));

    res.json({ data, count: data.length });
  } catch (err) {
    console.error('Error in /api/v1/images/nearby:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ====== GET /api/v1/images/provider/:providerImageId ======
app.get('/api/v1/images/provider/:providerImageId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, provider_image_id, lat, lon, captured_at, compass_angle, is_pano, status, width, height
       FROM images WHERE provider_image_id = $1`,
      [req.params.providerImageId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Image not found' });
    }
    const r = result.rows[0];
    res.json({
      data: {
        id: r.id,
        provider_image_id: r.provider_image_id,
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
        captured_at: r.captured_at,
        compass_angle: r.compass_angle,
        is_pano: r.is_pano,
        width: r.width,
        height: r.height,
        thumb_256_url: getThumbUrl(r.provider_image_id, r.status),
      }
    });
  } catch (err) {
    console.error('Error in /api/v1/images/provider/:providerImageId:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ====== GET /api/v1/images/:id ======
app.get('/api/v1/images/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, provider, provider_image_id, lat, lon, captured_at,
              compass_angle, is_pano, status, created_at
       FROM images WHERE id = $1`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Image not found' });
    }

    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error('Error in /api/v1/images/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ====== GET /api/v1/stats ======
app.get('/api/v1/stats', async (req, res) => {
  try {
    const [imgRes, seqRes, tileRes, boundsRes, featRes] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM images'),
      pool.query('SELECT COUNT(*) as count FROM sequences'),
      pool.query("SELECT COUNT(*) as count FROM crawl_jobs WHERE status = 'done'"),
      pool.query('SELECT MIN(lat) as min_lat, MAX(lat) as max_lat, MIN(lon) as min_lon, MAX(lon) as max_lon FROM images'),
      pool.query('SELECT feature_kind, COUNT(*) as count FROM map_features GROUP BY feature_kind'),
    ]);

    const map_features = {};
    featRes.rows.forEach(r => { map_features[r.feature_kind] = parseInt(r.count); });

    res.json({
      images: parseInt(imgRes.rows[0].count),
      sequences: parseInt(seqRes.rows[0].count),
      tiles_crawled: parseInt(tileRes.rows[0].count),
      bounds: boundsRes.rows[0],
      map_features,
    });
  } catch (err) {
    console.error('Error in /api/v1/stats:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ====== GET /api/v1/map-features/:providerFeatureId/detections ======
// Serves ONLY from pre-crawled cache — zero Mapillary calls at runtime
app.get('/api/v1/map-features/:providerFeatureId/detections', async (req, res) => {
  try {
    const { providerFeatureId } = req.params;

    const cached = await pool.query(
      'SELECT detections_json, fetched_at FROM map_feature_detection_cache WHERE provider_feature_id = $1',
      [providerFeatureId]
    );

    if (cached.rowCount === 0) {
      return res.json({ data: [], cache: { hit: false, message: 'Not yet crawled. Run: npm run crawl:detections' } });
    }

    res.json({ data: cached.rows[0].detections_json, cache: { hit: true, fetched_at: cached.rows[0].fetched_at } });
  } catch (err) {
    console.error('Error in /api/v1/map-features/:providerFeatureId/detections:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ====== MVT TILE: Map Feature Points ======
app.get('/api/v1/tiles/map-features/:z/:x/:y.mvt', async (req, res) => {
  try {
    const { z, x, y } = req.params;
    const result = await pool.query(
      `WITH bounds AS (
        SELECT ST_TileEnvelope($1::int, $2::int, $3::int) AS geom_3857
      )
      SELECT ST_AsMVT(tile, 'point', 4096, 'geom') AS mvt
      FROM (
        SELECT
          f.provider_feature_id AS id,
          f.value,
          ST_AsMVTGeom(
            ST_Transform(f.geom, 3857),
            b.geom_3857,
            4096, 64, true
          ) AS geom
        FROM map_features f, bounds b
        WHERE f.feature_kind = 'point'
          AND f.geom && ST_Transform(b.geom_3857, 4326)
      ) AS tile`,
      [parseInt(z), parseInt(x), parseInt(y)]
    );

    const mvt = result.rows[0]?.mvt;
    if (!mvt || mvt.length === 0) {
      res.status(204).end();
      return;
    }
    res.set('Content-Type', 'application/vnd.mapbox-vector-tile');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(mvt);
  } catch (err) {
    console.error('Error in MVT map-features:', err);
    res.status(500).end();
  }
});

// ====== MVT TILE: Traffic Signs ======
app.get('/api/v1/tiles/traffic-signs/:z/:x/:y.mvt', async (req, res) => {
  try {
    const { z, x, y } = req.params;
    const result = await pool.query(
      `WITH bounds AS (
        SELECT ST_TileEnvelope($1::int, $2::int, $3::int) AS geom_3857
      )
      SELECT ST_AsMVT(tile, 'traffic_sign', 4096, 'geom') AS mvt
      FROM (
        SELECT
          f.provider_feature_id AS id,
          f.value,
          ST_AsMVTGeom(
            ST_Transform(f.geom, 3857),
            b.geom_3857,
            4096, 64, true
          ) AS geom
        FROM map_features f, bounds b
        WHERE f.feature_kind = 'traffic_sign'
          AND f.geom && ST_Transform(b.geom_3857, 4326)
      ) AS tile`,
      [parseInt(z), parseInt(x), parseInt(y)]
    );

    const mvt = result.rows[0]?.mvt;
    if (!mvt || mvt.length === 0) {
      res.status(204).end();
      return;
    }
    res.set('Content-Type', 'application/vnd.mapbox-vector-tile');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(mvt);
  } catch (err) {
    console.error('Error in MVT traffic-signs:', err);
    res.status(500).end();
  }
});

// ====== START ======
app.listen(PORT, () => {
  console.log(`🚀 API server running at http://localhost:${PORT}`);
  console.log(`📍 Try: http://localhost:${PORT}/api/v1/images?bbox=107.9,15.95,108.35,16.15&limit=10`);
  console.log(`📍 Try: http://localhost:${PORT}/api/v1/images/nearby?lat=16.074&lon=108.149&radius=500`);
  console.log(`📍 Try: http://localhost:${PORT}/api/v1/stats`);
});

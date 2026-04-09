const express = require('express');
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
      `SELECT i.id, i.provider_image_id, i.lat, i.lon, i.captured_at, i.compass_angle, i.is_pano, i.tile_key,
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
      `SELECT id, provider_image_id, lat, lon, captured_at, compass_angle, is_pano,
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
    }));

    res.json({ data, count: data.length });
  } catch (err) {
    console.error('Error in /api/v1/images/nearby:', err);
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
    const [imgRes, seqRes, tileRes, boundsRes] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM images'),
      pool.query('SELECT COUNT(*) as count FROM sequences'),
      pool.query("SELECT COUNT(*) as count FROM crawl_jobs WHERE status = 'done'"),
      pool.query('SELECT MIN(lat) as min_lat, MAX(lat) as max_lat, MIN(lon) as min_lon, MAX(lon) as max_lon FROM images'),
    ]);

    res.json({
      images: parseInt(imgRes.rows[0].count),
      sequences: parseInt(seqRes.rows[0].count),
      tiles_crawled: parseInt(tileRes.rows[0].count),
      bounds: boundsRes.rows[0],
    });
  } catch (err) {
    console.error('Error in /api/v1/stats:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ====== START ======
app.listen(PORT, () => {
  console.log(`🚀 API server running at http://localhost:${PORT}`);
  console.log(`📍 Try: http://localhost:${PORT}/api/v1/images?bbox=107.9,15.95,108.35,16.15&limit=10`);
  console.log(`📍 Try: http://localhost:${PORT}/api/v1/images/nearby?lat=16.074&lon=108.149&radius=500`);
  console.log(`📍 Try: http://localhost:${PORT}/api/v1/stats`);
});

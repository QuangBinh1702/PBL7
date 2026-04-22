const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');
require('dotenv').config({ path: __dirname + '/../../.env' });

const app = express();
const PORT = process.env.API_PORT || 3000;
const DEFAULT_SEARCH_RADIUS_M = 50;
const DEFAULT_SEARCH_LIMIT = 50;
const GEOCODER_SUGGEST_URL = 'https://photon.komoot.io/api/';
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const CAPTION_API_URL = 'https://ttnt-diffusion--qwen3-vl-caption-server-fastapi-app-dev.modal.run/caption';
const DANANG_BBOX = {
  minLon: 107.9,
  minLat: 15.95,
  maxLon: 108.35,
  maxLat: 16.15,
};

// CORS for frontend
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept');
  next();
});
app.use(express.json({ limit: '15mb' }));

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

function getThumbFilePath(providerImageId, sizeDir = 'thumbs_1024') {
  const hash = crypto.createHash('md5').update(providerImageId).digest('hex');
  return path.join(__dirname, `../../storage/${sizeDir}/${hash.substring(0, 2)}/${hash.substring(2, 4)}/${providerImageId}.jpg`);
}

function buildMockAnalysis(providerImageId) {
  const suffix = providerImageId ? ` (ảnh ${providerImageId})` : '';
  return {
    scene_text: `[SCENE] Khu phố cũ${suffix}, vỉa hè xuống cấp nghiêm trọng, có rác và nhiều đoạn bong tróc.`,
    road_text: '[ROAD] Mặt đường nhựa bị nứt, vỉa hè hư hỏng, xuất hiện rác và các khu vực bị phá vỡ.',
    vehicle_text: '[VEHICLE] Có xe máy và ô tô, mật độ thấp, di chuyển chậm; có người điều khiển xe máy.',
    sign_text: '[SIGN] Thiếu biển báo giao thông rõ ràng, chủ yếu là biển hiệu cửa hàng.',
    safety_text: '[SAFETY] Giao thông tiềm ẩn rủi ro, thiếu vạch kẻ đường và hệ thống chỉ dẫn, nguy cơ tai nạn cao.',
  };
}

function parseCaptionResponse(text, providerImageId) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\d+\.\s*/, '').trim());

  if (lines.length < 5) {
    return null;
  }

  const normalized = lines.slice(0, 5).map((line, index) => {
    const tags = ['[SCENE]', '[ROAD]', '[VEHICLE]', '[SIGN]', '[SAFETY]'];
    return line.startsWith('[') ? line : `${tags[index]} ${line}`;
  });

  return {
    provider_image_id: providerImageId,
    scene_text: normalized[0],
    road_text: normalized[1],
    vehicle_text: normalized[2],
    sign_text: normalized[3],
    safety_text: normalized[4],
    source: 'ai',
  };
}

async function generateAiAnalysis(providerImageId) {
  const candidatePaths = [
    getThumbFilePath(providerImageId, 'thumbs_1024'),
    getThumbFilePath(providerImageId, 'thumbs'),
  ];

  const imagePath = candidatePaths.find((candidate) => fs.existsSync(candidate));
  if (!imagePath) {
    console.warn(`[analysis] No local thumbnail found for ${providerImageId}`);
    return null;
  }

  console.log(`[analysis] Using local image for ${providerImageId}: ${imagePath}`);

  const buffer = await fs.promises.readFile(imagePath);
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'image/jpeg' }), `${providerImageId}.jpg`);

  console.log(`[analysis] Calling caption API for ${providerImageId}`);
  const response = await fetch(CAPTION_API_URL, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Caption API failed with ${response.status}`);
  }

  const text = await response.text();
  console.log(`[analysis] Caption API success for ${providerImageId}`);
  return parseCaptionResponse(text, providerImageId);
}

async function generateAiAnalysisFromBase64(providerImageId, imageBase64) {
  const match = String(imageBase64 || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid image_base64 format');
  }

  const mimeType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), `${providerImageId}.${ext}`);

  console.log(`[analysis] Calling caption API from viewer snapshot for ${providerImageId}`);
  const response = await fetch(CAPTION_API_URL, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Caption API failed with ${response.status}`);
  }

  const text = await response.text();
  console.log(`[analysis] Snapshot caption success for ${providerImageId}`);
  return parseCaptionResponse(text, providerImageId);
}

async function upsertImageAnalysis(analysis) {
  await pool.query(
    `INSERT INTO image_analyses (
      provider_image_id, scene_text, road_text, vehicle_text, sign_text, safety_text, source
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (provider_image_id) DO UPDATE SET
      scene_text = EXCLUDED.scene_text,
      road_text = EXCLUDED.road_text,
      vehicle_text = EXCLUDED.vehicle_text,
      sign_text = EXCLUDED.sign_text,
      safety_text = EXCLUDED.safety_text,
      source = EXCLUDED.source,
      updated_at = now()`,
    [
      analysis.provider_image_id,
      analysis.scene_text,
      analysis.road_text,
      analysis.vehicle_text,
      analysis.sign_text,
      analysis.safety_text,
      analysis.source,
    ]
  );
}

function parseNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizePositiveInt(value, fallback, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 1), max);
}

function parseBiasParams(query) {
  const lat = parseNumber(query.lat);
  const lon = parseNumber(query.lon);
  const zoom = parseNumber(query.zoom);
  return {
    lat,
    lon,
    zoom: zoom !== null ? Math.min(Math.max(zoom, 8), 18) : 16,
    hasBias: lat !== null && lon !== null,
  };
}

function buildViewboxFromBias(bias) {
  if (!bias?.hasBias) {
    return `${DANANG_BBOX.minLon},${DANANG_BBOX.maxLat},${DANANG_BBOX.maxLon},${DANANG_BBOX.minLat}`;
  }

  const lonDelta = 0.12;
  const latDelta = 0.09;
  return [
    (bias.lon - lonDelta).toFixed(6),
    (bias.lat + latDelta).toFixed(6),
    (bias.lon + lonDelta).toFixed(6),
    (bias.lat - latDelta).toFixed(6),
  ].join(',');
}

function scoreGeocodeResult(item, bias) {
  let score = 0;
  const label = String(item.label || '').toLowerCase();
  const raw = item.raw || {};

  if ((raw.countrycode || '').toLowerCase() === 'vn') score += 40;
  if (label.includes('đà nẵng') || label.includes('da nang')) score += 80;
  if (label.includes('hòa minh') || label.includes('hoa minh')) score += 40;
  if (label.includes('hòa khánh') || label.includes('hoa khanh')) score += 30;

  const lat = parseNumber(item.lat);
  const lon = parseNumber(item.lon);
  if (lat !== null && lon !== null) {
    const inDanang =
      lon >= DANANG_BBOX.minLon &&
      lon <= DANANG_BBOX.maxLon &&
      lat >= DANANG_BBOX.minLat &&
      lat <= DANANG_BBOX.maxLat;
    if (inDanang) score += 120;

    if (bias?.hasBias) {
      const distance = Math.hypot(lat - bias.lat, lon - bias.lon);
      score += Math.max(0, 60 - distance * 400);
    }
  }

  return score;
}

function buildPhotonLabel(feature) {
  const props = feature?.properties || {};
  const parts = [
    props.name,
    props.street,
    props.housenumber,
    props.district,
    props.suburb,
    props.city,
    props.state,
    props.country,
  ].filter(Boolean);
  return [...new Set(parts)].join(', ');
}

function buildNominatimLabel(item) {
  return item?.display_name || '';
}

function normalizePhotonFeatures(features) {
  return (Array.isArray(features) ? features : []).map((feature) => ({
    label: buildPhotonLabel(feature),
    lat: feature.geometry?.coordinates?.[1],
    lon: feature.geometry?.coordinates?.[0],
    raw: feature.properties || {},
    source: 'photon',
  })).filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon) && item.label);
}

function normalizeNominatimResults(results) {
  return (Array.isArray(results) ? results : []).map((item) => ({
    label: buildNominatimLabel(item),
    lat: parseNumber(item.lat),
    lon: parseNumber(item.lon),
    raw: item,
    source: 'nominatim',
  })).filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon) && item.label);
}

async function geocodeText(query, limit = 1, bias = {}) {
  const photonUrl = new URL(GEOCODER_SUGGEST_URL);
  photonUrl.searchParams.set('q', query);
  photonUrl.searchParams.set('limit', String(limit));
  photonUrl.searchParams.set('lang', 'vi');
  photonUrl.searchParams.set('location_bias_scale', '0.6');
  photonUrl.searchParams.set('bbox', buildViewboxFromBias(bias));
  photonUrl.searchParams.set('countrycode', 'VN');
  if (bias?.hasBias) {
    photonUrl.searchParams.set('lat', String(bias.lat));
    photonUrl.searchParams.set('lon', String(bias.lon));
    photonUrl.searchParams.set('zoom', String(bias.zoom || 16));
  }

  try {
    const photonResponse = await fetch(photonUrl, {
      headers: {
        'User-Agent': 'MapillaryExplorer/1.0 (+http://localhost:3000)',
        'Accept': 'application/json',
      },
    });

    if (photonResponse.ok) {
      const photonJson = await photonResponse.json();
      const photonItems = normalizePhotonFeatures(photonJson.features)
        .sort((a, b) => scoreGeocodeResult(b, bias) - scoreGeocodeResult(a, bias))
        .slice(0, limit);
      if (photonItems.length > 0) return photonItems;
    } else {
      console.warn(`Photon geocoder returned ${photonResponse.status} for query: ${query}`);
    }
  } catch (err) {
    console.warn('Photon geocoder failed:', err.message);
  }

  const nominatimUrl = new URL(NOMINATIM_SEARCH_URL);
  nominatimUrl.searchParams.set('q', query);
  nominatimUrl.searchParams.set('format', 'jsonv2');
  nominatimUrl.searchParams.set('addressdetails', '1');
  nominatimUrl.searchParams.set('limit', String(limit));
  nominatimUrl.searchParams.set('accept-language', 'vi');
  nominatimUrl.searchParams.set('countrycodes', 'vn');
  nominatimUrl.searchParams.set('viewbox', buildViewboxFromBias(bias));

  const nominatimResponse = await fetch(nominatimUrl, {
    headers: {
      'User-Agent': 'MapillaryExplorer/1.0 (+http://localhost:3000)',
      'Accept': 'application/json',
    },
  });

  if (!nominatimResponse.ok) {
    throw new Error(`Nominatim geocoder failed with ${nominatimResponse.status}`);
  }

  const nominatimJson = await nominatimResponse.json();
  return normalizeNominatimResults(nominatimJson)
    .sort((a, b) => scoreGeocodeResult(b, bias) - scoreGeocodeResult(a, bias))
    .slice(0, limit);
}

async function ensureImageAnalysis(providerImageId) {
  const existing = await pool.query(
    'SELECT provider_image_id, source FROM image_analyses WHERE provider_image_id = $1',
    [providerImageId]
  );

  if (existing.rowCount > 0 && existing.rows[0].source === 'ai') {
    console.log(`[analysis] Reusing cached AI analysis for ${providerImageId}`);
    return;
  }

  try {
    console.log(`[analysis] Trying AI analysis for ${providerImageId}`);
    const aiAnalysis = await generateAiAnalysis(providerImageId);
    if (aiAnalysis) {
      await upsertImageAnalysis(aiAnalysis);
      console.log(`[analysis] Saved AI analysis for ${providerImageId}`);
      return;
    }
  } catch (err) {
    console.warn(`AI analysis failed for ${providerImageId}:`, err.message);
  }

  if (existing.rowCount > 0) {
    console.log(`[analysis] Keeping existing ${existing.rows[0].source} analysis for ${providerImageId}`);
    return;
  }

  const mock = buildMockAnalysis(providerImageId);
  await upsertImageAnalysis({
    provider_image_id: providerImageId,
    scene_text: mock.scene_text,
    road_text: mock.road_text,
    vehicle_text: mock.vehicle_text,
    sign_text: mock.sign_text,
    safety_text: mock.safety_text,
    source: 'mock',
  });
  console.log(`[analysis] Fallback to mock analysis for ${providerImageId}`);
}

// ====== GET /api/v1/geocode/suggest?q=... ======
app.get('/api/v1/geocode/suggest', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = normalizePositiveInt(req.query.limit, 5, 10);
    const bias = parseBiasParams(req.query);

    if (q.length < 2) {
      return res.json({ data: [], count: 0 });
    }

    const data = await geocodeText(q, limit, bias);

    res.json({ data, count: data.length });
  } catch (err) {
    console.error('Error in /api/v1/geocode/suggest:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ====== GET /api/v1/search/images?q=...&radius=50&limit=50 ======
app.get('/api/v1/search/images', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const bias = parseBiasParams(req.query);
    if (!q) {
      return res.status(400).json({ error: 'q parameter required' });
    }

    const radius = normalizePositiveInt(req.query.radius, DEFAULT_SEARCH_RADIUS_M, 50);
    const limit = normalizePositiveInt(req.query.limit, DEFAULT_SEARCH_LIMIT, 100);
    const features = await geocodeText(q, 1, bias);
    const selected = features[0];

    if (!selected) {
      return res.status(404).json({ error: 'Address not found' });
    }

    const lon = parseNumber(selected.lon);
    const lat = parseNumber(selected.lat);

    if (lat === null || lon === null) {
      return res.status(400).json({ error: 'Invalid geocoding result' });
    }

    const result = await pool.query(
      `SELECT id, provider_image_id, lat, lon, captured_at, compass_angle, is_pano, status,
              ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) as distance_m
       FROM images
       WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
       ORDER BY distance_m
       LIMIT $4`,
      [lat, lon, radius, limit]
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

    res.json({
      query: q,
      selected_address: selected.label,
      center: { lat, lon },
      radius_m: radius,
      count: data.length,
      data,
    });
  } catch (err) {
    console.error('Error in /api/v1/search/images:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
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

// ====== GET /api/v1/images/provider/:providerImageId/analysis ======
app.get('/api/v1/images/provider/:providerImageId/analysis', async (req, res) => {
  try {
    const { providerImageId } = req.params;
    if (!providerImageId) {
      return res.status(400).json({ error: 'providerImageId parameter required' });
    }

    await ensureImageAnalysis(providerImageId);

    const result = await pool.query(
      `SELECT provider_image_id, scene_text, road_text, vehicle_text, sign_text, safety_text, source, created_at, updated_at
       FROM image_analyses
       WHERE provider_image_id = $1`,
      [providerImageId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error('Error in /api/v1/images/provider/:providerImageId/analysis:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ====== POST /api/v1/images/provider/:providerImageId/analysis ======
app.post('/api/v1/images/provider/:providerImageId/analysis', async (req, res) => {
  try {
    const { providerImageId } = req.params;
    const { image_base64 } = req.body || {};

    if (!providerImageId) {
      return res.status(400).json({ error: 'providerImageId parameter required' });
    }

    if (!image_base64) {
      return res.status(400).json({ error: 'image_base64 field required' });
    }

    const aiAnalysis = await generateAiAnalysisFromBase64(providerImageId, image_base64);
    if (!aiAnalysis) {
      return res.status(422).json({ error: 'Could not parse caption response' });
    }

    await upsertImageAnalysis(aiAnalysis);

    const result = await pool.query(
      `SELECT provider_image_id, scene_text, road_text, vehicle_text, sign_text, safety_text, source, created_at, updated_at
       FROM image_analyses
       WHERE provider_image_id = $1`,
      [providerImageId]
    );

    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error('Error in POST /api/v1/images/provider/:providerImageId/analysis:', err);
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

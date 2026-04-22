const { VectorTile } = require('@mapbox/vector-tile');
const Pbf = require('pbf').default || require('pbf');
const pool = require('../config/db');
const { bboxToTiles, tileCoordsToLonLat } = require('./tile-utils');
require('dotenv').config({ path: __dirname + '/../../.env' });

// ====== CONFIG ======
const TOKEN = process.env.MAPILLARY_TOKEN;
const ZOOM = 14;
const RATE_LIMIT_MS = 150;
const MAX_RETRIES = 3;
const BATCH_SIZE = 500; // 8 params per row → 4000 params per batch

const DATASETS = {
  points: {
    source: 'mapillary_feature_points',
    tileType: 'mly_map_feature_point',
    layerName: 'point',
    featureKind: 'point',
  },
  signs: {
    source: 'mapillary_traffic_signs',
    tileType: 'mly_map_feature_traffic_sign',
    layerName: 'traffic_sign',
    featureKind: 'traffic_sign',
  },
};

// Bounding boxes
const BBOXES = {
  danang:      [107.9, 15.95, 108.35, 16.15],
  hoakhanh:    [108.13, 16.05, 108.17, 16.09],
  haichau:     [108.19, 16.03, 108.23, 16.08],
  thanhkhe:    [108.17, 16.06, 108.21, 16.09],
  sontra:      [108.22, 16.06, 108.34, 16.14],
  nguhanhson:  [108.23, 15.99, 108.28, 16.05],
  lienchieu:   [108.10, 16.05, 108.18, 16.13],
  camle:       [108.17, 15.99, 108.23, 16.04],
  hoavang:     [107.90, 15.95, 108.15, 16.10],
};

// ====== MAIN ======
async function main() {
  if (!TOKEN) {
    console.error('❌ Set MAPILLARY_TOKEN in .env file');
    process.exit(1);
  }

  const region = process.argv[2] || 'danang';
  const bbox = BBOXES[region];
  if (!bbox) {
    console.error(`❌ Unknown region: ${region}`);
    console.error(`   Available: ${Object.keys(BBOXES).join(', ')}`);
    process.exit(1);
  }

  // Determine which datasets to crawl
  const datasetArg = process.argv[3];
  let datasetKeys;
  if (datasetArg) {
    if (!DATASETS[datasetArg]) {
      console.error(`❌ Unknown dataset: ${datasetArg}`);
      console.error(`   Available: ${Object.keys(DATASETS).join(', ')}`);
      process.exit(1);
    }
    datasetKeys = [datasetArg];
  } else {
    datasetKeys = Object.keys(DATASETS);
  }

  console.log(`🚀 Starting map feature crawl for: ${region.toUpperCase()}`);
  console.log(`📍 Bbox: [${bbox.join(', ')}]`);
  console.log(`📋 Datasets: ${datasetKeys.join(', ')}`);
  console.log('');

  const tiles = bboxToTiles(bbox, ZOOM);
  const totalStats = {};

  for (const key of datasetKeys) {
    const dataset = DATASETS[key];
    console.log(`\n====== Crawling: ${key.toUpperCase()} (${dataset.source}) ======`);

    const stats = await crawlDataset(tiles, dataset);
    totalStats[key] = stats;
  }

  // Print summary
  console.log('');
  console.log('========== CRAWL COMPLETE ==========');
  for (const key of datasetKeys) {
    const s = totalStats[key];
    console.log(`📦 ${key}: ${s.totalFeatures} features inserted, ${s.tilesDone} tiles done, ${s.tilesFailed} failed`);
  }

  // DB totals
  const dbCount = await pool.query('SELECT COUNT(*) as count FROM map_features');
  console.log(`📊 Total map_features in DB: ${parseInt(dbCount.rows[0].count)}`);

  await pool.end();
}

// ====== CRAWL ONE DATASET ======
async function crawlDataset(tiles, dataset) {
  const { source, tileType, layerName, featureKind } = dataset;

  console.log(`📦 Total tiles: ${tiles.length}`);

  const doneTiles = await getDoneTiles(source);
  const pendingTiles = tiles.filter(
    (t) => !doneTiles.has(`${t.z}/${t.x}/${t.y}`)
  );
  console.log(`⏭️  Already done: ${tiles.length - pendingTiles.length}`);
  console.log(`🔄 Remaining: ${pendingTiles.length}`);

  let totalFeatures = 0;
  let tilesDone = 0;
  let tilesFailed = 0;

  for (let i = 0; i < pendingTiles.length; i++) {
    const tile = pendingTiles[i];
    const tileKey = `${tile.z}/${tile.x}/${tile.y}`;
    const progress = `[${i + 1}/${pendingTiles.length}]`;

    try {
      await upsertCrawlJob(tileKey, source, 'running');

      const features = await fetchAndParseTile(tile, tileType, layerName, featureKind);

      if (features.length > 0) {
        const count = await upsertMapFeatures(features, tileKey);
        totalFeatures += count;
        console.log(`${progress} ✅ ${tileKey} → ${count} features`);
      } else {
        console.log(`${progress} ⬜ ${tileKey} → empty`);
      }

      await upsertCrawlJob(tileKey, source, 'done', features.length);
      tilesDone++;
    } catch (err) {
      tilesFailed++;
      console.error(`${progress} ❌ ${tileKey} → ${err.message}`);
      await upsertCrawlJob(tileKey, source, 'failed', 0, err.message);
    }

    await sleep(RATE_LIMIT_MS);
  }

  return { totalFeatures, tilesDone, tilesFailed };
}

// ====== FETCH & PARSE TILE ======
async function fetchAndParseTile(tile, tileType, layerName, featureKind) {
  const url = `https://tiles.mapillary.com/maps/vtp/${tileType}/2/${tile.z}/${tile.x}/${tile.y}?access_token=${TOKEN}`;

  let response;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await fetch(url);

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '5');
        console.log(`  ⏳ Rate limited, waiting ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      break;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 10000);
      console.log(`  🔄 Retry ${attempt}/${MAX_RETRIES} in ${Math.round(delay)}ms...`);
      await sleep(delay);
    }
  }

  const buffer = await response.arrayBuffer();

  if (buffer.byteLength === 0) {
    return [];
  }

  const pbf = new Pbf(new Uint8Array(buffer));
  const vt = new VectorTile(pbf);

  const features = [];

  if (vt.layers[layerName]) {
    const layer = vt.layers[layerName];
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      const props = feature.properties;
      const geom = feature.loadGeometry()[0][0];

      const { lon, lat } = tileCoordsToLonLat(
        tile.x, tile.y, tile.z,
        geom.x, geom.y,
        layer.extent
      );

      features.push({
        providerFeatureId: String(props.id),
        featureKind,
        value: props.value || null,
        lon,
        lat,
        firstSeenAt: props.first_seen_at ? new Date(props.first_seen_at) : null,
        lastSeenAt: props.last_seen_at ? new Date(props.last_seen_at) : null,
      });
    }
  }

  return features;
}

// ====== DATABASE OPERATIONS ======

async function getDoneTiles(source) {
  const result = await pool.query(
    "SELECT tile_key FROM crawl_jobs WHERE status = 'done' AND source = $1",
    [source]
  );
  return new Set(result.rows.map((r) => r.tile_key));
}

async function upsertCrawlJob(tileKey, source, status, imagesFound = 0, errorMessage = null) {
  await pool.query(
    `INSERT INTO crawl_jobs (tile_key, source, status, images_found, error_message, completed_at)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $3 IN ('done','failed') THEN now() ELSE NULL END)
     ON CONFLICT (tile_key, source)
     DO UPDATE SET status = $3, images_found = $4, error_message = $5,
                   completed_at = CASE WHEN $3 IN ('done','failed') THEN now() ELSE crawl_jobs.completed_at END`,
    [tileKey, source, status, imagesFound, errorMessage]
  );
}

async function upsertMapFeatures(features, tileKey) {
  if (features.length === 0) return 0;

  let totalInserted = 0;

  for (let start = 0; start < features.length; start += BATCH_SIZE) {
    const batch = features.slice(start, start + BATCH_SIZE);
    const params = [];
    const valueRows = [];
    let paramIdx = 1;

    for (const f of batch) {
      valueRows.push(
        `('mapillary', $${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, ` +
          `ST_SetSRID(ST_MakePoint($${paramIdx + 3}, $${paramIdx + 4}), 4326), ` +
          `$${paramIdx + 4}, $${paramIdx + 3}, ` +
          `$${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7})`
      );

      params.push(
        f.providerFeatureId, // $1 provider_feature_id
        f.featureKind,       // $2 feature_kind
        f.value,             // $3 value
        f.lon,               // $4 lon → ST_MakePoint(lon, lat)
        f.lat,               // $5 lat
        f.firstSeenAt,       // $6 first_seen_at
        f.lastSeenAt,        // $7 last_seen_at
        tileKey              // $8 tile_key
      );
      paramIdx += 8;
    }

    const query = `
      INSERT INTO map_features (provider, provider_feature_id, feature_kind, value, geom, lat, lon,
                                first_seen_at, last_seen_at, tile_key)
      VALUES ${valueRows.join(',\n           ')}
      ON CONFLICT (provider, provider_feature_id)
      DO UPDATE SET
        value = EXCLUDED.value,
        geom = EXCLUDED.geom,
        lat = EXCLUDED.lat,
        lon = EXCLUDED.lon,
        first_seen_at = LEAST(map_features.first_seen_at, EXCLUDED.first_seen_at),
        last_seen_at = GREATEST(map_features.last_seen_at, EXCLUDED.last_seen_at),
        tile_key = EXCLUDED.tile_key,
        updated_at = now()
    `;

    const result = await pool.query(query, params);
    totalInserted += result.rowCount;
  }

  return totalInserted;
}

// ====== UTILS ======
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ====== RUN ======
main().catch((err) => {
  console.error('💀 Fatal error:', err);
  process.exit(1);
});

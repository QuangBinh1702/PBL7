const { VectorTile } = require('@mapbox/vector-tile');
const Pbf = require('pbf').default || require('pbf');
const pool = require('../config/db');
const { bboxToTiles, tileCoordsToLonLat } = require('./tile-utils');
require('dotenv').config({ path: __dirname + '/../../.env' });

// ====== CONFIG ======
const TOKEN = process.env.MAPILLARY_TOKEN;
const TILE_URL = 'https://tiles.mapillary.com/maps/vtp/mly1_public/2';
const ZOOM = 14;
const RATE_LIMIT_MS = 150; // ~6-7 requests/sec (safe for Mapillary)
const MAX_RETRIES = 3;

// Bounding boxes
const BBOXES = {
  danang:   [107.9, 15.95, 108.35, 16.15],
  hoakhanh: [108.13, 16.05, 108.17, 16.09],
};

// ====== MAIN ======
async function main() {
  if (!TOKEN) {
    console.error('❌ Set MAPILLARY_TOKEN in .env file');
    process.exit(1);
  }

  // Chọn khu vực từ argument: npm run crawl -- hoakhanh
  const region = process.argv[2] || 'danang';
  const bbox = BBOXES[region];
  if (!bbox) {
    console.error(`❌ Unknown region: ${region}`);
    console.error(`   Available: ${Object.keys(BBOXES).join(', ')}`);
    process.exit(1);
  }

  console.log(`🚀 Starting metadata crawl for: ${region.toUpperCase()}`);
  console.log(`📍 Bbox: [${bbox.join(', ')}]`);

  const tiles = bboxToTiles(bbox, ZOOM);
  console.log(`📦 Total tiles to crawl: ${tiles.length}`);

  // Check which tiles are already done
  const doneTiles = await getDoneTiles();
  const pendingTiles = tiles.filter(
    (t) => !doneTiles.has(`${t.z}/${t.x}/${t.y}`)
  );
  console.log(`⏭️  Already done: ${tiles.length - pendingTiles.length}`);
  console.log(`🔄 Remaining: ${pendingTiles.length}`);
  console.log('');

  let totalImages = 0;
  let totalSequences = 0;
  let failedTiles = 0;

  for (let i = 0; i < pendingTiles.length; i++) {
    const tile = pendingTiles[i];
    const tileKey = `${tile.z}/${tile.x}/${tile.y}`;
    const progress = `[${i + 1}/${pendingTiles.length}]`;

    try {
      // Create/update crawl job
      await upsertCrawlJob(tileKey, 'running');

      // Fetch & parse tile
      const { images, sequences } = await fetchAndParseTile(tile);

      if (images.length > 0) {
        // Batch insert sequences
        const seqCount = await upsertSequences(sequences);
        totalSequences += seqCount;

        // Batch insert images
        const imgCount = await upsertImages(images, tileKey);
        totalImages += imgCount;

        console.log(
          `${progress} ✅ ${tileKey} → ${imgCount} new images, ${seqCount} new sequences`
        );
      } else {
        console.log(`${progress} ⬜ ${tileKey} → empty (no coverage)`);
      }

      await upsertCrawlJob(tileKey, 'done', images.length);
    } catch (err) {
      failedTiles++;
      console.error(`${progress} ❌ ${tileKey} → ${err.message}`);
      await upsertCrawlJob(tileKey, 'failed', 0, err.message);
    }

    // Rate limit
    await sleep(RATE_LIMIT_MS);
  }

  console.log('');
  console.log('========== CRAWL COMPLETE ==========');
  console.log(`📸 New images inserted: ${totalImages}`);
  console.log(`🔗 New sequences inserted: ${totalSequences}`);
  console.log(`❌ Failed tiles: ${failedTiles}`);

  // Final stats
  const stats = await getStats();
  console.log(`📊 Total images in DB: ${stats.totalImages}`);
  console.log(`📊 Total sequences in DB: ${stats.totalSequences}`);
  console.log(`📊 Total tiles crawled: ${stats.totalTilesDone}`);

  await pool.end();
}

// ====== FETCH & PARSE TILE ======
async function fetchAndParseTile(tile) {
  const url = `${TILE_URL}/${tile.z}/${tile.x}/${tile.y}?access_token=${TOKEN}`;

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

  // Empty tile
  if (buffer.byteLength === 0) {
    return { images: [], sequences: [] };
  }

  // Parse MVT
  const pbf = new Pbf(new Uint8Array(buffer));
  const vt = new VectorTile(pbf);

  const images = [];
  const sequenceIds = new Set();

  // Extract "image" layer (individual photo points)
  if (vt.layers.image) {
    const layer = vt.layers.image;
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      const props = feature.properties;
      const geom = feature.loadGeometry()[0][0]; // Point geometry

      const { lon, lat } = tileCoordsToLonLat(
        tile.x, tile.y, tile.z,
        geom.x, geom.y,
        layer.extent
      );

      images.push({
        providerId: String(props.id),
        lon,
        lat,
        capturedAt: props.captured_at ? new Date(props.captured_at) : null,
        compassAngle: props.compass_angle ?? null,
        isPano: props.is_pano === 1 || props.is_pano === true,
        sequenceId: props.sequence_id ? String(props.sequence_id) : null,
      });

      if (props.sequence_id) {
        sequenceIds.add(String(props.sequence_id));
      }
    }
  }

  // Also extract from "sequence" layer for coverage areas without image-level data
  if (vt.layers.sequence && images.length === 0) {
    const layer = vt.layers.sequence;
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      const props = feature.properties;
      if (props.image_id) {
        const geom = feature.loadGeometry()[0][0];
        const { lon, lat } = tileCoordsToLonLat(
          tile.x, tile.y, tile.z,
          geom.x, geom.y,
          layer.extent
        );

        images.push({
          providerId: String(props.image_id),
          lon,
          lat,
          capturedAt: props.captured_at ? new Date(props.captured_at) : null,
          compassAngle: null,
          isPano: props.is_pano === 1 || props.is_pano === true,
          sequenceId: props.id ? String(props.id) : null,
        });

        if (props.id) sequenceIds.add(String(props.id));
      }
    }
  }

  return { images, sequences: [...sequenceIds] };
}

// ====== DATABASE OPERATIONS ======

async function getDoneTiles() {
  const result = await pool.query(
    "SELECT tile_key FROM crawl_jobs WHERE status = 'done' AND source = 'mapillary'"
  );
  return new Set(result.rows.map((r) => r.tile_key));
}

async function upsertCrawlJob(tileKey, status, imagesFound = 0, errorMessage = null) {
  await pool.query(
    `INSERT INTO crawl_jobs (tile_key, source, status, images_found, error_message, completed_at)
     VALUES ($1, 'mapillary', $2, $3, $4, CASE WHEN $2 IN ('done','failed') THEN now() ELSE NULL END)
     ON CONFLICT (tile_key, source)
     DO UPDATE SET status = $2, images_found = $3, error_message = $4,
                   completed_at = CASE WHEN $2 IN ('done','failed') THEN now() ELSE crawl_jobs.completed_at END`,
    [tileKey, status, imagesFound, errorMessage]
  );
}

async function upsertSequences(sequenceIds) {
  if (sequenceIds.length === 0) return 0;

  // Batch insert with ON CONFLICT
  const values = sequenceIds
    .map((_, i) => `('mapillary', $${i + 1})`)
    .join(', ');

  const result = await pool.query(
    `INSERT INTO sequences (provider, provider_sequence_id)
     VALUES ${values}
     ON CONFLICT (provider, provider_sequence_id) DO NOTHING`,
    sequenceIds
  );

  return result.rowCount;
}

async function upsertImages(images, tileKey) {
  if (images.length === 0) return 0;

  let totalInserted = 0;
  const BATCH_SIZE = 500; // PostgreSQL has ~65535 param limit, 8 params × 500 = 4000

  for (let start = 0; start < images.length; start += BATCH_SIZE) {
    const batch = images.slice(start, start + BATCH_SIZE);
    const params = [];
    const valueRows = [];
    let paramIdx = 1;

    for (const img of batch) {
      valueRows.push(
        `('mapillary', $${paramIdx}, $${paramIdx + 1}, ` +
          `ST_SetSRID(ST_MakePoint($${paramIdx + 2}, $${paramIdx + 3}), 4326), ` +
          `$${paramIdx + 3}, $${paramIdx + 2}, ` +
          `$${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7})`
      );

      params.push(
        img.providerId,             // provider_image_id
        null,                       // sequence_id (will link later)
        img.lon,                    // lon → ST_MakePoint
        img.lat,                    // lat → ST_MakePoint
        img.capturedAt,             // captured_at
        img.compassAngle,           // compass_angle
        img.isPano,                 // is_pano
        tileKey                     // tile_key
      );
      paramIdx += 8;
    }

    const query = `
      INSERT INTO images (provider, provider_image_id, sequence_id, geom, lat, lon,
                          captured_at, compass_angle, is_pano, tile_key)
      VALUES ${valueRows.join(',\n           ')}
      ON CONFLICT (provider, provider_image_id) DO NOTHING
    `;

    const result = await pool.query(query, params);
    totalInserted += result.rowCount;
  }

  return totalInserted;
}

async function getStats() {
  const [imgRes, seqRes, tileRes] = await Promise.all([
    pool.query('SELECT COUNT(*) as count FROM images'),
    pool.query('SELECT COUNT(*) as count FROM sequences'),
    pool.query("SELECT COUNT(*) as count FROM crawl_jobs WHERE status = 'done'"),
  ]);

  return {
    totalImages: parseInt(imgRes.rows[0].count),
    totalSequences: parseInt(seqRes.rows[0].count),
    totalTilesDone: parseInt(tileRes.rows[0].count),
  };
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

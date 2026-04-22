/**
 * Pre-crawl detections + thumbnails for all map features in DB.
 * After this, the API serves everything from cache — ZERO Mapillary calls at runtime.
 *
 * Usage:
 *   npm run crawl:detections                    # All uncached features
 *   npm run crawl:detections -- 500             # Limit to 500 features
 *   npm run crawl:detections -- --kind=point    # Only point features
 *   npm run crawl:detections -- --kind=traffic_sign
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');
require('dotenv').config({ path: __dirname + '/../../.env' });

const TOKEN = process.env.MAPILLARY_TOKEN;
const RATE_LIMIT_MS = 200; // ~5 req/sec (safe)
const MAX_RETRIES = 3;
const THUMBS_1024_DIR = path.join(__dirname, '../../storage/thumbs_1024');

fs.mkdirSync(THUMBS_1024_DIR, { recursive: true });

// Bounding boxes — same as other crawlers
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
    console.error('❌ Set MAPILLARY_TOKEN in .env');
    process.exit(1);
  }

  // Parse args
  let limit = null;
  let kindFilter = null;
  let region = null;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--kind=')) {
      kindFilter = arg.replace('--kind=', '');
    } else if (BBOXES[arg]) {
      region = arg;
    } else if (!arg.startsWith('-')) {
      limit = parseInt(arg) || null;
    }
  }

  // Get features that are NOT yet cached
  let query = `
    SELECT f.provider_feature_id, f.feature_kind, f.value
    FROM map_features f
    LEFT JOIN map_feature_detection_cache c ON f.provider_feature_id = c.provider_feature_id
    WHERE c.provider_feature_id IS NULL
  `;
  const params = [];
  if (region) {
    const bbox = BBOXES[region];
    params.push(bbox[0], bbox[1], bbox[2], bbox[3]);
    query += ` AND f.geom && ST_MakeEnvelope($${params.length-3}, $${params.length-2}, $${params.length-1}, $${params.length}, 4326)`;
  }
  if (kindFilter) {
    params.push(kindFilter);
    query += ` AND f.feature_kind = $${params.length}`;
  }
  query += ' ORDER BY f.id';
  if (limit) {
    params.push(limit);
    query += ` LIMIT $${params.length}`;
  }

  const result = await pool.query(query, params);
  const features = result.rows;

  console.log(`🚀 Crawling detections for ${features.length} features`);
  if (region) console.log(`📍 Region: ${region} [${BBOXES[region].join(', ')}]`);
  if (kindFilter) console.log(`📋 Filter: ${kindFilter}`);
  if (limit) console.log(`📋 Limit: ${limit}`);

  const estMin = Math.ceil(features.length * RATE_LIMIT_MS / 60000);
  console.log(`⏱️  Estimated: ~${estMin} minutes\n`);

  let success = 0;
  let empty = 0;
  let failed = 0;
  let thumbsDownloaded = 0;

  for (let i = 0; i < features.length; i++) {
    const feat = features[i];
    const progress = `[${i + 1}/${features.length}]`;

    try {
      // 1. Fetch detections from Mapillary
      const detections = await fetchDetections(feat.provider_feature_id);

      if (detections.length === 0) {
        // Cache empty result too (so we don't re-fetch)
        await cacheDetections(feat.provider_feature_id, []);
        empty++;
        if ((i + 1) % 100 === 0) console.log(`${progress} ⬜ ${feat.value} → 0 detections`);
        await sleep(RATE_LIMIT_MS);
        continue;
      }

      // 2. Fetch thumb_1024 for each unique image + download locally
      const imageIds = [...new Set(detections.map(d => d.image?.id).filter(Boolean))];

      for (const imgId of imageIds) {
        try {
          await sleep(RATE_LIMIT_MS);
          const thumbData = await fetchWithRetry(
            `https://graph.mapillary.com/${imgId}?fields=thumb_1024_url,width,height`,
            { headers: { Authorization: `OAuth ${TOKEN}` } }
          );

          if (thumbData?.thumb_1024_url) {
            // Download thumb image locally
            const localPath = await downloadThumb(imgId, thumbData.thumb_1024_url);

            // Attach to all detections with this image
            detections.forEach(d => {
              if (String(d.image?.id) === String(imgId)) {
                d._thumb = {
                  thumb_1024_url: localPath,
                  width: thumbData.width || null,
                  height: thumbData.height || null,
                };
              }
            });
            thumbsDownloaded++;
          }
        } catch (e) {
          // Skip thumb errors, detection data is still valid
        }
      }

      // 3. Cache enriched detections
      await cacheDetections(feat.provider_feature_id, detections);
      success++;

      if ((i + 1) % 50 === 0 || detections.length > 5) {
        console.log(`${progress} ✅ ${feat.value} → ${detections.length} detections, ${imageIds.length} images`);
      }
    } catch (err) {
      failed++;
      if ((i + 1) % 100 === 0) {
        console.error(`${progress} ❌ ${feat.provider_feature_id} → ${err.message}`);
      }
    }

    await sleep(RATE_LIMIT_MS);
  }

  console.log('\n========== CRAWL COMPLETE ==========');
  console.log(`✅ Success: ${success}`);
  console.log(`⬜ Empty (no detections): ${empty}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📸 Thumbs downloaded: ${thumbsDownloaded}`);

  const cacheCount = await pool.query('SELECT COUNT(*) as c FROM map_feature_detection_cache');
  console.log(`📊 Total cached detections: ${cacheCount.rows[0].c}`);

  await pool.end();
}

// ====== FETCH DETECTIONS ======
async function fetchDetections(featureId) {
  const data = await fetchWithRetry(
    `https://graph.mapillary.com/${featureId}/detections?fields=geometry,image,value`,
    { headers: { Authorization: `OAuth ${TOKEN}` } }
  );
  return data?.data || [];
}

// ====== FETCH WITH RETRY ======
async function fetchWithRetry(url, opts) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, opts);

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '10');
        console.log(`  ⏳ Rate limited, waiting ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!res.ok) {
        if (attempt === MAX_RETRIES) return null;
        await sleep(1000 * attempt);
        continue;
      }

      return await res.json();
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
  return null;
}

// ====== DOWNLOAD THUMB ======
async function downloadThumb(imageId, url) {
  const hash = crypto.createHash('md5').update(String(imageId)).digest('hex');
  const sub1 = hash.substring(0, 2);
  const sub2 = hash.substring(2, 4);
  const dir = path.join(THUMBS_1024_DIR, sub1, sub2);
  const filePath = path.join(dir, `${imageId}.jpg`);
  const urlPath = `/thumbs_1024/${sub1}/${sub2}/${imageId}.jpg`;

  // Skip if already downloaded
  if (fs.existsSync(filePath)) return urlPath;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, buffer);

  return urlPath;
}

// ====== CACHE TO DB ======
async function cacheDetections(featureId, detections) {
  await pool.query(
    `INSERT INTO map_feature_detection_cache (provider_feature_id, detections_json, fetched_at)
     VALUES ($1, $2, now())
     ON CONFLICT (provider_feature_id) DO UPDATE SET detections_json = $2, fetched_at = now()`,
    [featureId, JSON.stringify(detections)]
  );
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

main().catch(err => {
  console.error('💀 Fatal:', err);
  process.exit(1);
});

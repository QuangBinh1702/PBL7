/**
 * Fix existing images: link them to sequences using Mapillary tile data.
 * 
 * This re-fetches tile data for all crawled tiles to get the sequence_id
 * for each image, then updates the images table.
 * 
 * Usage: node backend/src/db/fix-sequence-links.js
 */

const { VectorTile } = require('@mapbox/vector-tile');
const Pbf = require('pbf').default || require('pbf');
const pool = require('../config/db');
require('dotenv').config({ path: __dirname + '/../../.env' });

const TOKEN = process.env.MAPILLARY_TOKEN;
const TILE_URL = 'https://tiles.mapillary.com/maps/vtp/mly1_public/2';
const RATE_LIMIT_MS = 150;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  if (!TOKEN) {
    console.error('❌ Set MAPILLARY_TOKEN in .env file');
    process.exit(1);
  }

  // Get count of images without sequence_id
  const countRes = await pool.query('SELECT COUNT(*) as cnt FROM images WHERE sequence_id IS NULL');
  console.log(`📊 Images without sequence_id: ${countRes.rows[0].cnt}`);

  // Get all done tiles
  const tilesRes = await pool.query(
    "SELECT tile_key FROM crawl_jobs WHERE status = 'done' AND source = 'mapillary'"
  );
  const tiles = tilesRes.rows.map(r => {
    const [z, x, y] = r.tile_key.split('/').map(Number);
    return { z, x, y, key: r.tile_key };
  });
  console.log(`📦 Tiles to process: ${tiles.length}`);

  let totalUpdated = 0;

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const progress = `[${i + 1}/${tiles.length}]`;

    try {
      const url = `${TILE_URL}/${tile.z}/${tile.x}/${tile.y}?access_token=${TOKEN}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`${progress} ⚠️ ${tile.key} → HTTP ${res.status}`);
        await sleep(RATE_LIMIT_MS);
        continue;
      }

      const buf = await res.arrayBuffer();
      const vt = new VectorTile(new Pbf(buf));

      // Build map: provider_image_id → sequence_id
      const imageSeqMap = {};

      if (vt.layers.image) {
        const layer = vt.layers.image;
        for (let j = 0; j < layer.length; j++) {
          const feature = layer.feature(j);
          const props = feature.properties;
          if (props.id && props.sequence_id) {
            imageSeqMap[String(props.id)] = String(props.sequence_id);
          }
        }
      }

      if (vt.layers.sequence) {
        const layer = vt.layers.sequence;
        for (let j = 0; j < layer.length; j++) {
          const feature = layer.feature(j);
          const props = feature.properties;
          if (props.image_id && props.id) {
            imageSeqMap[String(props.image_id)] = String(props.id);
          }
        }
      }

      const entries = Object.entries(imageSeqMap);
      if (entries.length === 0) {
        console.log(`${progress} ⬜ ${tile.key} → no image-sequence mappings`);
        await sleep(RATE_LIMIT_MS);
        continue;
      }

      // Batch update images
      let updated = 0;
      const BATCH = 500;
      for (let b = 0; b < entries.length; b += BATCH) {
        const batch = entries.slice(b, b + BATCH);
        // Build a VALUES list for the update
        const values = batch.map(([imgId, seqId], idx) =>
          `($${idx * 2 + 1}, $${idx * 2 + 2})`
        ).join(', ');
        const params = batch.flatMap(([imgId, seqId]) => [imgId, seqId]);

        const updateResult = await pool.query(`
          UPDATE images i
          SET sequence_id = s.id
          FROM (VALUES ${values}) AS v(provider_image_id, provider_sequence_id)
          JOIN sequences s ON s.provider = 'mapillary' AND s.provider_sequence_id = v.provider_sequence_id
          WHERE i.provider = 'mapillary'
            AND i.provider_image_id = v.provider_image_id
            AND i.sequence_id IS NULL
        `, params);

        updated += updateResult.rowCount;
      }

      totalUpdated += updated;
      if (updated > 0) {
        console.log(`${progress} ✅ ${tile.key} → updated ${updated} images`);
      } else {
        console.log(`${progress} ⬜ ${tile.key} → 0 updates (already linked or no match)`);
      }
    } catch (err) {
      console.error(`${progress} ❌ ${tile.key} → ${err.message}`);
    }

    await sleep(RATE_LIMIT_MS);
  }

  // Final stats
  const finalRes = await pool.query('SELECT COUNT(*) as cnt FROM images WHERE sequence_id IS NULL');
  console.log('');
  console.log('========== FIX COMPLETE ==========');
  console.log(`✅ Total images updated: ${totalUpdated}`);
  console.log(`⚠️ Images still without sequence: ${finalRes.rows[0].cnt}`);

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });

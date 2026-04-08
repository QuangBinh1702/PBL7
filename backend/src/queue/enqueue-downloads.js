/**
 * Đẩy ảnh chưa tải vào hàng đợi download
 * Chạy: npm run enqueue [limit]
 *        npm run enqueue -- --bbox=108.13,16.05,108.17,16.09
 */
const pool = require('../config/db');
const { downloadQueue } = require('./queues');
require('dotenv').config({ path: __dirname + '/../../.env' });

const BATCH_SIZE = 500;

async function main() {
  // Parse args
  let limit = 1000;
  let bbox = null;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--bbox=')) {
      bbox = arg.replace('--bbox=', '').split(',').map(Number);
    } else if (!arg.startsWith('-')) {
      limit = parseInt(arg) || 1000;
    }
  }

  if (bbox) {
    console.log(`📨 Enqueuing images in bbox [${bbox.join(', ')}] (limit ${limit})...\n`);
  } else {
    console.log(`📨 Enqueuing up to ${limit} images for thumbnail download...\n`);
  }

  // Lấy ảnh chưa tải
  let result;
  if (bbox) {
    result = await pool.query(
      `SELECT id, provider_image_id FROM images
       WHERE status = 'metadata_only'
         AND geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
       ORDER BY id
       LIMIT $5`,
      [bbox[0], bbox[1], bbox[2], bbox[3], limit]
    );
  } else {
    result = await pool.query(
      `SELECT id, provider_image_id FROM images
       WHERE status = 'metadata_only'
       ORDER BY id
       LIMIT $1`,
      [limit]
    );
  }

  const images = result.rows;
  console.log(`📋 Found ${images.length} images to download`);

  if (images.length === 0) {
    console.log('✅ Nothing to enqueue');
    await cleanup();
    return;
  }

  // Ước tính
  const estMB = (images.length * 20 / 1024).toFixed(0);
  const estMin = (images.length / 120).toFixed(0);
  console.log(`⏱️  Ước tính: ~${estMB} MB, ~${estMin} phút\n`);

  // Thêm vào queue theo batch
  let enqueued = 0;
  for (let i = 0; i < images.length; i += BATCH_SIZE) {
    const batch = images.slice(i, i + BATCH_SIZE);
    const jobs = batch.map(img => ({
      name: 'download-thumb',
      data: {
        imageId: img.id,
        providerImageId: img.provider_image_id,
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    }));

    await downloadQueue.addBulk(jobs);
    enqueued += batch.length;
    console.log(`  📦 Enqueued batch: ${enqueued}/${images.length}`);
  }

  // Cập nhật status
  const ids = images.map(i => i.id);
  for (let i = 0; i < ids.length; i += 5000) {
    const chunk = ids.slice(i, i + 5000);
    await pool.query(
      `UPDATE images SET status = 'queued', updated_at = now()
       WHERE id = ANY($1::bigint[])`,
      [chunk]
    );
  }

  console.log(`\n✅ Enqueued ${enqueued} jobs`);
  console.log('👉 Run: npm run worker    ← để bắt đầu tải');

  await cleanup();
}

async function cleanup() {
  await downloadQueue.close();
  await pool.end();
}

main().catch(err => {
  console.error('💀 Error:', err);
  process.exit(1);
});

/**
 * Worker tải thumbnail 256px từ Mapillary, lưu vào storage/thumbs/
 * Chạy: npm run worker
 */
const { Worker } = require('bullmq');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');
const { redisConnection } = require('../config/redis');
require('dotenv').config({ path: __dirname + '/../../.env' });

const TOKEN = process.env.MAPILLARY_TOKEN;
const THUMBS_DIR = path.join(__dirname, '../../storage/thumbs');
const RATE_LIMIT_MS = 100; // 10 requests/sec

// Đảm bảo thư mục tồn tại
fs.mkdirSync(THUMBS_DIR, { recursive: true });

let downloadCount = 0;
let failCount = 0;
let skipCount = 0;
const startTime = Date.now();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function processJob(job) {
  const { imageId, providerImageId } = job.data;

  // Kiểm tra đã tải chưa (idempotent)
  const thumbPath = getThumbPath(providerImageId);
  if (fs.existsSync(thumbPath)) {
    skipCount++;
    await pool.query(
      "UPDATE images SET status = 'downloaded', updated_at = now() WHERE id = $1",
      [imageId]
    );
    return { status: 'skipped', imageId };
  }

  // Rate limit
  await sleep(RATE_LIMIT_MS);

  // Bước 1: Lấy thumbnail URL từ Mapillary Graph API
  const metaRes = await fetch(
    `https://graph.mapillary.com/${providerImageId}?fields=thumb_256_url`,
    { headers: { Authorization: `OAuth ${TOKEN}` } }
  );

  if (metaRes.status === 429) {
    const retryAfter = parseInt(metaRes.headers.get('retry-after') || '10');
    throw new Error(`Rate limited, retry after ${retryAfter}s`);
  }

  if (!metaRes.ok) {
    throw new Error(`Graph API ${metaRes.status}`);
  }

  const meta = await metaRes.json();
  if (!meta.thumb_256_url) {
    // Không có thumbnail — đánh dấu và bỏ qua
    await pool.query(
      "UPDATE images SET status = 'no_thumb', updated_at = now() WHERE id = $1",
      [imageId]
    );
    return { status: 'no_thumb', imageId };
  }

  // Bước 2: Tải ảnh + tính hash
  const imgRes = await fetch(meta.thumb_256_url);
  if (!imgRes.ok) {
    throw new Error(`Image download ${imgRes.status}`);
  }

  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const md5 = crypto.createHash('md5').update(buffer).digest('hex');

  // Bước 3: Lưu file
  const dir = path.dirname(thumbPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(thumbPath, buffer);

  // Bước 4: Cập nhật DB
  await pool.query(
    `UPDATE images SET status = 'downloaded', updated_at = now() WHERE id = $1`,
    [imageId]
  );

  downloadCount++;

  // Log tiến độ mỗi 50 ảnh
  if (downloadCount % 50 === 0) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (downloadCount / (elapsed / 60)).toFixed(0);
    console.log(
      `📸 Downloaded: ${downloadCount} | Failed: ${failCount} | Skipped: ${skipCount} | ` +
      `${rate} imgs/min | ${elapsed}s elapsed`
    );
  }

  return { status: 'downloaded', imageId, size: buffer.length, md5 };
}

// Tạo đường dẫn: storage/thumbs/ab/cd/abcdef1234.jpg (chia folder theo hash prefix)
function getThumbPath(providerImageId) {
  const hash = crypto.createHash('md5').update(providerImageId).digest('hex');
  const sub1 = hash.substring(0, 2);
  const sub2 = hash.substring(2, 4);
  return path.join(THUMBS_DIR, sub1, sub2, `${providerImageId}.jpg`);
}

// ===== START WORKER =====
console.log('🔧 Starting download worker...');
console.log(`📁 Saving thumbnails to: ${THUMBS_DIR}`);
console.log(`⚡ Rate limit: ${1000 / RATE_LIMIT_MS} requests/sec\n`);

const worker = new Worker('download-thumbs', processJob, {
  connection: redisConnection,
  concurrency: 3, // 3 jobs đồng thời
  limiter: {
    max: 10,
    duration: 1000, // max 10 jobs/sec
  },
});

worker.on('completed', (job, result) => {
  // Silent — log ở trong processJob mỗi 50 ảnh
});

worker.on('failed', (job, err) => {
  failCount++;
  if (failCount % 10 === 0) {
    console.log(`❌ Failed: ${failCount} total | Last error: ${err.message}`);
  }
});

worker.on('error', (err) => {
  console.error('🔥 Worker error:', err.message || err);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Shutting down worker...');
  console.log(`📊 Final: ${downloadCount} downloaded, ${failCount} failed, ${skipCount} skipped`);
  await worker.close();
  await pool.end();
  process.exit(0);
});

console.log('⏳ Waiting for jobs... (Ctrl+C to stop)\n');

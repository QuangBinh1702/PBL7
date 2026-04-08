/**
 * Xem trạng thái hàng đợi
 * Chạy: npm run queue:stats
 */
const { downloadQueue } = require('./queues');
const pool = require('../config/db');
require('dotenv').config({ path: __dirname + '/../../.env' });

async function main() {
  console.log('📊 ========== QUEUE & DOWNLOAD STATS ==========\n');

  // Queue stats
  const counts = await downloadQueue.getJobCounts();
  console.log('📨 Queue: download-thumbs');
  console.log(`   Waiting:    ${counts.waiting}`);
  console.log(`   Active:     ${counts.active}`);
  console.log(`   Completed:  ${counts.completed}`);
  console.log(`   Failed:     ${counts.failed}`);
  console.log(`   Delayed:    ${counts.delayed}`);

  // DB stats
  const result = await pool.query(
    `SELECT status, COUNT(*) as count FROM images GROUP BY status ORDER BY count DESC`
  );
  console.log('\n📋 Images by status:');
  result.rows.forEach(r => console.log(`   ${r.status}: ${r.count}`));

  // Disk usage
  const { execSync } = require('child_process');
  try {
    const size = execSync('du -sh d:/pbl7/pbl7/backend/storage/thumbs 2>/dev/null || echo "0\t-"')
      .toString().trim().split('\t')[0];
    console.log(`\n💾 Thumbnail storage: ${size}`);
  } catch (e) {
    console.log('\n💾 Thumbnail storage: checking...');
    const fs = require('fs');
    const path = require('path');
    const thumbsDir = path.join(__dirname, '../../storage/thumbs');
    let totalSize = 0;
    let fileCount = 0;
    function countDir(dir) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) countDir(full);
          else { totalSize += fs.statSync(full).size; fileCount++; }
        }
      } catch (e) {}
    }
    countDir(thumbsDir);
    const mb = (totalSize / 1024 / 1024).toFixed(1);
    console.log(`   Files: ${fileCount}`);
    console.log(`   Size: ${mb} MB`);
  }

  await downloadQueue.close();
  await pool.end();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

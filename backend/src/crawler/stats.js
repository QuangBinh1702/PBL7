const pool = require('../config/db');
require('dotenv').config({ path: __dirname + '/../../.env' });

async function showStats() {
  console.log('📊 ========== DATABASE STATS ==========\n');

  // Total counts
  const images = await pool.query('SELECT COUNT(*) as count FROM images');
  const sequences = await pool.query('SELECT COUNT(*) as count FROM sequences');
  const tilesDone = await pool.query("SELECT COUNT(*) as count FROM crawl_jobs WHERE status = 'done'");
  const tilesFailed = await pool.query("SELECT COUNT(*) as count FROM crawl_jobs WHERE status = 'failed'");
  const tilesPending = await pool.query("SELECT COUNT(*) as count FROM crawl_jobs WHERE status = 'pending'");

  console.log(`📸 Images:       ${images.rows[0].count}`);
  console.log(`🔗 Sequences:    ${sequences.rows[0].count}`);
  console.log(`✅ Tiles done:   ${tilesDone.rows[0].count}`);
  console.log(`❌ Tiles failed: ${tilesFailed.rows[0].count}`);
  console.log(`⏳ Tiles pending: ${tilesPending.rows[0].count}`);

  // Images by status
  const byStatus = await pool.query(
    'SELECT status, COUNT(*) as count FROM images GROUP BY status ORDER BY count DESC'
  );
  console.log('\n📋 Images by status:');
  byStatus.rows.forEach((r) => console.log(`   ${r.status}: ${r.count}`));

  // Date range
  const dateRange = await pool.query(
    'SELECT MIN(captured_at) as earliest, MAX(captured_at) as latest FROM images WHERE captured_at IS NOT NULL'
  );
  if (dateRange.rows[0].earliest) {
    console.log(`\n📅 Date range: ${dateRange.rows[0].earliest.toISOString().slice(0, 10)} → ${dateRange.rows[0].latest.toISOString().slice(0, 10)}`);
  }

  // Geographic bounds
  const bounds = await pool.query(
    'SELECT MIN(lat) as min_lat, MAX(lat) as max_lat, MIN(lon) as min_lon, MAX(lon) as max_lon FROM images'
  );
  const b = bounds.rows[0];
  if (b.min_lat) {
    console.log(`\n🗺️  Geographic bounds:`);
    console.log(`   Lat: ${Number(b.min_lat).toFixed(5)} → ${Number(b.max_lat).toFixed(5)}`);
    console.log(`   Lon: ${Number(b.min_lon).toFixed(5)} → ${Number(b.max_lon).toFixed(5)}`);
  }

  // Panorama stats
  const pano = await pool.query(
    'SELECT is_pano, COUNT(*) as count FROM images GROUP BY is_pano'
  );
  console.log('\n🔄 Panorama:');
  pano.rows.forEach((r) => console.log(`   ${r.is_pano ? 'Pano' : 'Flat'}: ${r.count}`));

  // Top tiles by image count
  const topTiles = await pool.query(
    'SELECT tile_key, COUNT(*) as count FROM images GROUP BY tile_key ORDER BY count DESC LIMIT 5'
  );
  console.log('\n🏆 Top tiles (most images):');
  topTiles.rows.forEach((r) => console.log(`   ${r.tile_key}: ${r.count} images`));

  await pool.end();
}

showStats().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

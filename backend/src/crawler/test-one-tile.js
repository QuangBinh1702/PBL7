/**
 * Test crawl 1 tile duy nhất để kiểm tra mọi thứ hoạt động đúng
 * Chạy: node src/crawler/test-one-tile.js
 */
const { VectorTile } = require('@mapbox/vector-tile');
const Pbf = require('pbf').default || require('pbf');
const { tileCoordsToLonLat, bboxToTiles } = require('./tile-utils');
require('dotenv').config({ path: __dirname + '/../../.env' });

const TOKEN = process.env.MAPILLARY_TOKEN;
const TILE_URL = 'https://tiles.mapillary.com/maps/vtp/mly1_public/2';

// Hòa Khánh, Đà Nẵng — 1 điểm cụ thể
const TEST_POINT = { lat: 16.0744, lon: 108.1491 }; // khu vực trung tâm

async function main() {
  if (!TOKEN) {
    console.error('❌ Set MAPILLARY_TOKEN in .env file');
    process.exit(1);
  }

  // Tính tile z14 chứa điểm test
  const zoom = 14;
  const tileX = Math.floor(((TEST_POINT.lon + 180) / 360) * Math.pow(2, zoom));
  const latRad = (TEST_POINT.lat * Math.PI) / 180;
  const tileY = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, zoom));

  console.log('🧪 TEST: Crawl 1 tile duy nhất');
  console.log(`📍 Điểm test: ${TEST_POINT.lat}, ${TEST_POINT.lon}`);
  console.log(`📦 Tile: z=${zoom} x=${tileX} y=${tileY}`);
  console.log('');

  // ====== BƯỚC 1: Fetch tile ======
  const url = `${TILE_URL}/${zoom}/${tileX}/${tileY}?access_token=${TOKEN}`;
  console.log('1️⃣  Fetching tile...');
  console.log(`   URL: ${url.replace(TOKEN, 'MLY|***')}`);

  const response = await fetch(url);
  console.log(`   Status: ${response.status}`);
  console.log(`   Content-Type: ${response.headers.get('content-type')}`);

  if (!response.ok) {
    console.error(`❌ HTTP ${response.status}: ${await response.text()}`);
    process.exit(1);
  }

  const buffer = await response.arrayBuffer();
  console.log(`   Size: ${buffer.byteLength} bytes`);

  if (buffer.byteLength === 0) {
    console.log('⬜ Tile trống — không có coverage tại đây');
    process.exit(0);
  }

  // ====== BƯỚC 2: Parse MVT ======
  console.log('\n2️⃣  Parsing MVT...');
  const pbf = new Pbf(new Uint8Array(buffer));
  const vt = new VectorTile(pbf);

  console.log(`   Layers có trong tile: [${Object.keys(vt.layers).join(', ')}]`);

  // ====== BƯỚC 3: Đọc layer "image" ======
  if (vt.layers.image) {
    const layer = vt.layers.image;
    console.log(`\n3️⃣  Layer "image": ${layer.length} features`);

    // Hiển thị 5 ảnh đầu tiên
    const showCount = Math.min(5, layer.length);
    console.log(`   Hiển thị ${showCount} ảnh đầu tiên:\n`);

    for (let i = 0; i < showCount; i++) {
      const feature = layer.feature(i);
      const props = feature.properties;
      const geom = feature.loadGeometry()[0][0];
      const { lon, lat } = tileCoordsToLonLat(tileX, tileY, zoom, geom.x, geom.y, layer.extent);

      const date = props.captured_at ? new Date(props.captured_at).toISOString().slice(0, 10) : 'N/A';

      console.log(`   📸 Ảnh #${i + 1}:`);
      console.log(`      ID:        ${props.id}`);
      console.log(`      Tọa độ:    ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
      console.log(`      Ngày chụp: ${date}`);
      console.log(`      Compass:   ${props.compass_angle ?? 'N/A'}°`);
      console.log(`      Panorama:  ${props.is_pano ? 'Yes' : 'No'}`);
      console.log(`      Sequence:  ${props.sequence_id || 'N/A'}`);
      console.log('');
    }
  } else {
    console.log('\n3️⃣  Layer "image" không có trong tile này');
  }

  // ====== BƯỚC 4: Đọc layer "sequence" ======
  if (vt.layers.sequence) {
    const layer = vt.layers.sequence;
    console.log(`4️⃣  Layer "sequence": ${layer.length} features`);

    const showCount = Math.min(3, layer.length);
    for (let i = 0; i < showCount; i++) {
      const feature = layer.feature(i);
      const props = feature.properties;
      console.log(`   🔗 Sequence #${i + 1}: id=${props.id}, image_id=${props.image_id}, pano=${props.is_pano}`);
    }
  }

  // ====== BƯỚC 5: Tóm tắt ======
  console.log('\n========== TÓM TẮT ==========');
  const imgCount = vt.layers.image ? vt.layers.image.length : 0;
  const seqCount = vt.layers.sequence ? vt.layers.sequence.length : 0;
  console.log(`📸 Images:    ${imgCount}`);
  console.log(`🔗 Sequences: ${seqCount}`);
  console.log(`✅ Tile parse thành công!`);

  if (imgCount > 0) {
    console.log('\n👉 Dữ liệu OK — có thể chạy crawl thật.');
    console.log('   Tiếp theo: npm run crawl');
  }
}

main().catch((err) => {
  console.error('💀 Error:', err);
  process.exit(1);
});

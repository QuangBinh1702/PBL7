const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function initDB() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  try {
    await pool.query(schema);
    console.log('✅ Database schema initialized successfully');

    // Verify PostGIS
    const result = await pool.query('SELECT PostGIS_Version()');
    console.log('✅ PostGIS version:', result.rows[0].postgis_version);

    // Show table info
    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    console.log('📋 Tables:', tables.rows.map(r => r.table_name).join(', '));
  } catch (err) {
    console.error('❌ Failed to init database:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initDB();

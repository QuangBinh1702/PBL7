# Mapillary Explorer

Street-level imagery viewer with map integration. Crawls Mapillary data into PostgreSQL, serves via Express API.

## Tech Stack

| Component | Technology                                                  |
| --------- | ----------------------------------------------------------- |
| Frontend  | Static HTML/CSS/JS, MapLibre GL JS 4.7.1, MapillaryJS 4.1.2 |
| Backend   | Node.js, Express 4.21, PostgreSQL (pg 8.13, PostGIS)        |
| Data      | @mapbox/vector-tile, pbf (protobuf parsing)                 |
| External  | Mapillary API v4, Nominatim geocoding, OSM tiles            |

## Structure

```
index.html          # Frontend (~2700 lines, single-file app)
server.js           # Static file server (port 8080)
backend/
├── src/api/        # Express API server (port 3000)
├── src/crawler/    # Mapillary tile crawler
├── src/db/         # Database init scripts
└── src/config/     # DB connection config
docs/               # Documentation
```

## Commands

```bash
# Frontend
node server.js                    # Static server at localhost:8080

# Backend (run from backend/)
npm run db:init                   # Initialize PostgreSQL schema
npm run crawl                     # Crawl Mapillary metadata
npm run api                       # Start API server (port 3000)
npm run test:tile                 # Test single tile fetch
npm run crawl:stats               # Show crawl statistics
```

## Code Example

```javascript
// backend/src/api/server.js — Spatial query with PostGIS
app.get("/api/v1/images", async (req, res) => {
  const { bbox, limit = 100 } = req.query;
  const [minLon, minLat, maxLon, maxLat] = bbox.split(",").map(Number);
  const result = await pool.query(
    `SELECT * FROM images WHERE geom && ST_MakeEnvelope($1,$2,$3,$4,4326) LIMIT $5`,
    [minLon, minLat, maxLon, maxLat, limit],
  );
});
```

## Boundaries

### Always

- Use PostGIS spatial functions for geo queries
- Include CORS headers in API responses
- Validate bbox parameter format before queries

### Ask First

- Database schema changes
- Adding new API endpoints
- Modifying crawler behavior

### Never

- Expose Mapillary token in client code (use server-side proxy if needed)
- Commit `.env` files
- Run crawler without rate limiting

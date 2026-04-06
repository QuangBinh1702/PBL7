# Backend — Phase 1: Crawl Metadata Đà Nẵng

## Yêu cầu

- **Node.js** 18+
- **PostgreSQL** 14+ với **PostGIS** extension

## Cài đặt

### 1. Tạo database

```sql
-- Trong psql hoặc pgAdmin:
CREATE DATABASE mapillary_explorer;
\c mapillary_explorer
CREATE EXTENSION postgis;
```

### 2. Cấu hình .env

```bash
cd backend
copy .env.example .env
```

Sửa file `.env`:
```
MAPILLARY_TOKEN=MLY|xxxx|yyyy    ← token thật của bạn
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mapillary_explorer
DB_USER=postgres
DB_PASSWORD=your_password
```

### 3. Cài dependencies

```bash
cd backend
npm install
```

### 4. Khởi tạo database schema

```bash
npm run db:init
```

Output mong đợi:
```
✅ Database schema initialized successfully
✅ PostGIS version: 3.4 ...
📋 Tables: crawl_jobs, images, sequences
```

## Chạy

### Crawl metadata Đà Nẵng

```bash
npm run crawl
```

Output:
```
🚀 Starting metadata crawl for Da Nang
📍 Bbox: [107.9, 15.95, 108.35, 16.15]
📦 Total tiles to crawl: 156
🔄 Remaining: 156

[1/156] ✅ 14/12835/7732 → 247 new images, 12 new sequences
[2/156] ⬜ 14/12836/7732 → empty (no coverage)
...
```

### Xem thống kê

```bash
npm run crawl:stats
```

### Chạy API

```bash
npm run api
```

API endpoints:
- `GET /api/v1/images?bbox=107.9,15.95,108.35,16.15&limit=10`
- `GET /api/v1/images/nearby?lat=16.074&lon=108.149&radius=500`
- `GET /api/v1/images/:id`
- `GET /api/v1/stats`

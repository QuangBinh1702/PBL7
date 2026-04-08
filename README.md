# 📘 Mapillary Explorer — Tài liệu hướng dẫn

## Mục lục

1. [Tổng quan dự án](#1-tổng-quan-dự-án)
2. [Kiến trúc hệ thống](#2-kiến-trúc-hệ-thống)
3. [Hướng dẫn lấy Mapillary Access Token](#3-hướng-dẫn-lấy-mapillary-access-token)
4. [Cài đặt & Chạy dự án](#4-cài-đặt--chạy-dự-án)
5. [Giải thích API & Dữ liệu](#5-giải-thích-api--dữ-liệu)
6. [Giải thích từng thành phần code](#6-giải-thích-từng-thành-phần-code)
7. [Cách hoạt động chi tiết](#7-cách-hoạt-động-chi-tiết)
8. [Backend — Database & API](#8-backend--database--api)
9. [Xử lý sự cố](#9-xử-lý-sự-cố)
10. [Danh sách đối tượng được hỗ trợ](#10-danh-sách-đối-tượng-được-hỗ-trợ)
11. [State Management](#11-state-management)

---

## 1. Tổng quan dự án

### Dự án là gì?

Mapillary Explorer là ứng dụng web **khám phá bản đồ đường phố** tương tự [mapillary.com/app](https://www.mapillary.com/app/). Ứng dụng cho phép:

- Xem ảnh đường phố (street-level imagery) từ Mapillary
- Điều hướng trên bản đồ với coverage lines (đường xanh lá)
- Click vào bản đồ để nhảy đến ảnh tại vị trí đó
- Xem các đối tượng đã phát hiện (biển báo, đèn giao thông, ...)
- **Lọc đối tượng** theo loại (point objects, traffic signs) với Filter Panel
- **Xem Detection Panel** — hiển thị tất cả ảnh phát hiện đối tượng kèm bounding box
- **Hover Preview** — di chuột qua ảnh trên bản đồ hiện thumbnail preview
- **Tải dữ liệu GeoJSON** — download features/signs đang hiển thị thành file JSON
- **Expand/Collapse Viewer** — phóng to viewer toàn màn hình hoặc thu nhỏ overlay
- Chia sẻ vị trí qua URL

### Công nghệ sử dụng

#### Frontend

| Công nghệ | Vai trò | Link |
|---|---|---|
| **MapillaryJS v4.1.2** | Viewer xem ảnh đường phố (WebGL) | [GitHub](https://github.com/mapillary/mapillary-js) |
| **MapLibre GL JS v4.7.1** | Bản đồ tương tác (thay thế Mapbox, miễn phí) | [maplibre.org](https://maplibre.org/) |
| **Mapillary API v4** | Lấy dữ liệu ảnh, coverage, detections | [API Docs](https://www.mapillary.com/developer/api-documentation) |
| **OpenStreetMap Tiles** | Lớp bản đồ nền (miễn phí) | [openstreetmap.org](https://www.openstreetmap.org/) |
| **Nominatim API** | Tìm kiếm địa điểm (geocoding, miễn phí) | [nominatim.org](https://nominatim.org/) |
| **Mapillary Sprite Source** | Icon SVG cho map features & traffic signs | [GitHub](https://github.com/mapillary/mapillary_sprite_source) |

#### Backend

| Công nghệ | Vai trò | Link |
|---|---|---|
| **Node.js + Express 4.21** | API server phục vụ dữ liệu từ DB | [expressjs.com](https://expressjs.com/) |
| **PostgreSQL + PostGIS** | Lưu trữ metadata ảnh với spatial queries | [postgis.net](https://postgis.net/) |
| **BullMQ 5.x + Redis** | Hàng đợi tải ảnh thumbnail (background jobs) | [GitHub](https://github.com/taskforcesh/bullmq) |
| **@mapbox/vector-tile + pbf** | Parse Mapillary Vector Tiles (MVT/Protobuf) | [GitHub](https://github.com/mapbox/vector-tile-js) |
| **pg 8.13** | PostgreSQL client cho Node.js | [GitHub](https://github.com/brianc/node-postgres) |

### Tại sao chọn MapLibre thay vì Mapbox?

- **MapLibre**: Miễn phí hoàn toàn, không cần token riêng, mã nguồn mở
- **Mapbox**: Cần đăng ký token riêng, có giới hạn free tier
- Cả hai đều hỗ trợ vector tiles của Mapillary

---

## 2. Kiến trúc hệ thống

### Sơ đồ tổng quan

```
┌─────────────────────────────────────────────────────────┐
│                      TRÌNH DUYỆT                        │
│                                                         │
│  ┌────────────────────────────────────────────────────┐  │
│  │               MapLibre GL JS Map                   │  │
│  │  (bản đồ toàn màn hình + coverage + features)     │  │
│  │                                                    │  │
│  │  ┌──────────────┐  ┌────────────┐  ┌───────────┐  │  │
│  │  │ Search Box   │  │ Map        │  │ Filter    │  │  │
│  │  │ (Nominatim)  │  │ Controls   │  │ Panels    │  │  │
│  │  └──────────────┘  │ +/-/⬆/📍  │  │ Signs +   │  │  │
│  │                    └────────────┘  │ Points    │  │  │
│  │  ┌──────────────┐                 └───────────┘  │  │
│  │  │ MapillaryJS  │  ┌────────────────────────┐    │  │
│  │  │ Viewer       │  │ Detection Panel        │    │  │
│  │  │ (overlay,    │  │ (ảnh + bounding box)   │    │  │
│  │  │  bottom-left)│  │                        │    │  │
│  │  └──────────────┘  └────────────────────────┘    │  │
│  │                                                    │  │
│  │  ┌──────────┐  ┌─────────────┐  ┌──────────────┐  │  │
│  │  │ Legend   │  │ Coords      │  │ Hover Preview│  │  │
│  │  └──────────┘  └─────────────┘  └──────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
└─────────┬──────────────────┬───────────────────────────┘
          │                  │
          ▼                  ▼
  ┌───────────────┐  ┌──────────────────────┐
  │ Mapillary API │  │ Mapillary Tiles       │
  │ (Graph API)   │  │ (Vector Tiles)        │
  │               │  │                       │
  │ • Ảnh theo ID │  │ • Coverage lines      │
  │ • Ảnh theo    │  │ • Image dots          │
  │   bbox        │  │ • Map feature points  │
  │ • Detections  │  │ • Traffic signs       │
  │ • Thumbnails  │  │                       │
  └───────────────┘  └──────────────────────┘
          │
          ▼
  ┌───────────────────┐       ┌──────────────────────────────────┐
  │ Mapillary Sprite  │       │         BACKEND SERVER           │
  │ Source (GitHub)    │       │                                  │
  │ • Icon SVG objects│       │  ┌──────────┐   ┌────────────┐  │
  │ • Icon SVG signs  │       │  │ Express  │   │ PostgreSQL │  │
  └───────────────────┘       │  │ API :3000│◄─►│ + PostGIS  │  │
          │                   │  └──────────┘   └─────┬──────┘  │
          ▼                   │                       │         │
  ┌───────────────────┐       │  ┌──────────┐   ┌─────┴──────┐ │
  │ Nominatim API     │       │  │ BullMQ   │   │  Crawler   │ │
  │ (geocoding)       │       │  │ Worker   │◄──│ (MVT tiles)│ │
  └───────────────────┘       │  │ (Redis)  │   └────────────┘ │
                              │  └─────┬────┘                  │
                              │        ▼                       │
                              │  ┌────────────┐                │
                              │  │ storage/   │                │
                              │  │ thumbs/    │                │
                              │  └────────────┘                │
                              └──────────────────────────────────┘
```

### Luồng dữ liệu

```
1. User mở app → Nhập token → Lưu localStorage
2. Khởi tạo MapillaryJS Viewer (overlay bottom-left) + MapLibre Map (toàn màn hình)
3. Map tải vector tiles → hiển thị coverage lines xanh
4. Map tải icon SVG từ GitHub Sprite Source → hiển thị icon đối tượng + biển báo
5. User click coverage line → lấy image_id → viewer.moveTo(id)
6. Viewer chuyển ảnh → fire event "image" → cập nhật map center + camera cone
7. User hover vào ảnh dot → fetch thumbnail → hiển thị preview tooltip
8. User click map feature → mở Detection Panel → fetch detections + thumbnails
9. URL tự động cập nhật → có thể chia sẻ link
```

---

## 3. Hướng dẫn lấy Mapillary Access Token

### Bước 1: Tạo tài khoản Mapillary

1. Truy cập [mapillary.com](https://www.mapillary.com)
2. Click **"Sign up"** hoặc **đăng nhập bằng Facebook**
3. Xác nhận email nếu đăng ký mới

### Bước 2: Đăng ký ứng dụng Developer

1. Truy cập [mapillary.com/dashboard/developers](https://www.mapillary.com/dashboard/developers)
2. Click **"Register Application"**
3. Điền thông tin:

| Trường | Điền gì | Giải thích |
|---|---|---|
| **App Name** | `PBL7 Explorer` | Tên bất kỳ |
| **Company website** | `http://localhost:8080` | URL website (bất kỳ URL hợp lệ) |
| **Redirect URL** | `http://localhost:8080` | URL callback (bất kỳ URL hợp lệ) |

4. Click **"Register"**

### Bước 3: Lấy Client Token

1. Sau khi đăng ký, trang sẽ hiện thông tin app
2. Tìm mục **"Client Token"** — dạng:
   ```
   MLY|1234567890|abcdefghijklmnopqrstuvwxyz
   ```
3. **Copy token này** → dán vào ô nhập khi mở app

### Lưu ý quan trọng

- **Client Token** (dùng cho app này): Chỉ đọc dữ liệu công khai, an toàn cho client-side
- **Client Secret**: KHÔNG BAO GIỜ chia sẻ hoặc đưa vào code
- Token được lưu trong `localStorage` của trình duyệt, không gửi đi đâu ngoài API Mapillary

---

## 4. Cài đặt & Chạy dự án

### Yêu cầu

- Trình duyệt hiện đại (Chrome, Firefox, Edge)
- **Node.js** (v18+)
- **PostgreSQL** với extension **PostGIS**
- **Redis** (cho BullMQ queue)
- Kết nối Internet
- Mapillary Access Token

### Cấu trúc dự án

```
pbl7/
├── index.html              # Frontend (single-file app ~2700 dòng)
├── server.js               # Static file server (port 8080)
├── backend/
│   ├── .env.example        # Mẫu biến môi trường
│   ├── package.json        # Dependencies backend
│   ├── storage/
│   │   └── thumbs/         # Ảnh thumbnail đã tải (hash-based subdirs)
│   └── src/
│       ├── api/
│       │   └── server.js   # Express API server (port 3000)
│       ├── config/
│       │   ├── db.js       # PostgreSQL connection pool
│       │   └── redis.js    # Redis connection (ioredis)
│       ├── crawler/
│       │   ├── crawl-metadata.js  # Crawl metadata từ Mapillary MVT
│       │   ├── tile-utils.js      # Hàm tính tile từ bbox
│       │   ├── stats.js           # Thống kê DB
│       │   └── test-one-tile.js   # Test fetch 1 tile
│       ├── db/
│       │   ├── init.js     # Khởi tạo DB schema
│       │   └── schema.sql  # SQL tạo bảng + indexes
│       ├── queue/
│       │   ├── queues.js           # Định nghĩa BullMQ queue
│       │   ├── enqueue-downloads.js # Đẩy ảnh vào hàng đợi
│       │   └── queue-stats.js      # Thống kê queue
│       └── worker/
│           └── download-worker.js  # Worker tải thumbnail
└── docs/                   # Tài liệu bổ sung
```

### Cách chạy

#### A. Frontend (Static Server)

##### Cách 1: Node.js Server (khuyến nghị — có sẵn `server.js`)

```bash
cd d:\pbl7\pbl7
node server.js
```

Mở trình duyệt: **http://localhost:8080**

> `server.js` là static file server tự viết bằng Node.js, chạy trên port **8080**, hỗ trợ serve HTML/CSS/JS/JSON/PNG/SVG/...

##### Cách 2: Python HTTP Server

```bash
cd d:\pbl7\pbl7
python -m http.server 8080
```

##### Cách 3: VS Code Live Server

1. Cài extension **"Live Server"** trong VS Code
2. Mở file `index.html`
3. Click **"Go Live"** ở thanh status bar

#### B. Backend (Crawler + API + Worker)

##### Bước 1: Cài đặt dependencies

```bash
cd backend
npm install
```

##### Bước 2: Cấu hình biến môi trường

```bash
cp .env.example .env
# Sửa file .env với thông tin thực tế:
```

```env
# Mapillary
MAPILLARY_TOKEN=MLY|xxxx|yyyy

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mapillary_explorer
DB_USER=postgres
DB_PASSWORD=your_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# API
API_PORT=3000
```

##### Bước 3: Khởi tạo database

```bash
npm run db:init       # Tạo bảng crawl_jobs, sequences, images + PostGIS indexes
```

##### Bước 4: Crawl metadata

```bash
npm run crawl -- danang      # Crawl toàn bộ Đà Nẵng
npm run crawl -- hoakhanh    # Hoặc chỉ khu vực Hòa Khánh
npm run crawl:stats          # Xem thống kê sau khi crawl
```

##### Bước 5: Tải thumbnail (tùy chọn)

```bash
# Đẩy ảnh vào hàng đợi download
npm run enqueue -- 5000                                           # 5000 ảnh bất kỳ
npm run enqueue -- 50000 --bbox=108.20,16.04,108.24,16.08         # Theo khu vực

# Chạy worker tải ảnh (cần Redis đang chạy)
npm run worker

# Xem trạng thái queue
npm run queue:stats
```

##### Bước 6: Chạy API server

```bash
npm run api           # Express API tại http://localhost:3000
```

### Tại sao cần server? Mở file trực tiếp không được sao?

Mở file `index.html` trực tiếp (double-click) sẽ dùng giao thức `file://`. Trình duyệt sẽ **chặn các request API** (CORS policy) khi dùng `file://`. Cần chạy qua `http://localhost` để tránh lỗi này.

---

## 5. Giải thích API & Dữ liệu

### 5.1 Tổng hợp tất cả API được sử dụng

| # | API | Method | URL | Mục đích | Xác thực |
|---|---|---|---|---|---|
| 1 | **Coverage Vector Tiles** | GET | `https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}` | Hiển thị đường coverage + ảnh dots trên bản đồ | `?access_token=TOKEN` |
| 2 | **Map Feature Point Tiles** | GET | `https://tiles.mapillary.com/maps/vtp/mly_map_feature_point/2/{z}/{x}/{y}` | Hiển thị icon đối tượng (đèn, cột, trụ nước...) | `?access_token=TOKEN` |
| 3 | **Traffic Sign Tiles** | GET | `https://tiles.mapillary.com/maps/vtp/mly_map_feature_traffic_sign/2/{z}/{x}/{y}` | Hiển thị icon biển báo giao thông | `?access_token=TOKEN` |
| 4 | **Image Metadata** | GET | `https://graph.mapillary.com/{image_id}?fields=captured_at` | Lấy ngày chụp ảnh | `Authorization: OAuth TOKEN` |
| 5 | **Image Thumbnail** | GET | `https://graph.mapillary.com/{image_id}?fields=thumb_256_url` | Lấy URL thumbnail 256px (hover preview) | `Authorization: OAuth TOKEN` |
| 6 | **Image Thumbnail HD** | GET | `https://graph.mapillary.com/{image_id}?fields=thumb_1024_url,width,height` | Lấy URL thumbnail 1024px + kích thước ảnh (Detection Panel) | `Authorization: OAuth TOKEN` |
| 7 | **Images by BBox** | GET | `https://graph.mapillary.com/images?fields=id,geometry&bbox=...&limit=5` | Tìm ảnh gần nhất khi click vào bản đồ trống | `?access_token=TOKEN` |
| 8 | **Map Feature Detections** | GET | `https://graph.mapillary.com/{map_feature_id}/detections?fields=geometry,image,value` | Lấy danh sách ảnh phát hiện 1 đối tượng | `Authorization: OAuth TOKEN` |
| 9 | **Nominatim Geocoding** | GET | `https://nominatim.openstreetmap.org/search?format=json&q=...&limit=1` | Tìm kiếm địa điểm (search box) | Không cần |
| 10 | **Point Icon SVG** | GET | `https://raw.githubusercontent.com/.../package_objects/{value}.svg` | Lấy icon SVG cho map feature | Không cần |
| 11 | **Sign Icon SVG** | GET | `https://raw.githubusercontent.com/.../package_signs/{value}.svg` | Lấy icon SVG cho biển báo | Không cần |
| 12 | **OSM Raster Tiles** | GET | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Lớp bản đồ nền | Không cần |

### 5.2 Xác thực (Authentication)

Mọi request tới Mapillary đều cần token:

```
# Cho Vector Tiles — dùng query parameter
https://tiles.mapillary.com/...?access_token=MLY|xxxx|yyyy

# Cho Graph API — dùng header
Authorization: OAuth MLY|xxxx|yyyy
```

### 5.3 Chi tiết từng API call + JSON Response

#### API 1: Coverage Vector Tiles

```
GET https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=TOKEN
```

**Trả về:** Binary MVT (Mapbox Vector Tile) — không phải JSON. MapLibre tự decode.

**Các layer trong tileset `mly1_public`:**

| Layer | Zoom | Geometry | Mô tả |
|---|---|---|---|
| `overview` | 0–5 | Point | Cluster tổng quan ở zoom thấp |
| `sequence` | 6–14 | **LineString** | **Đường coverage xanh lá** ← quan trọng nhất |
| `image` | 14+ | Point | Vị trí từng ảnh riêng lẻ |

**Properties của layer `sequence`:**

| Property | Type | Mô tả |
|---|---|---|
| `id` | string | ID sequence |
| `image_id` | int | ID ảnh đầu tiên/tốt nhất |
| `captured_at` | int (ms) | Thời gian chụp |
| `is_pano` | bool | Ảnh panorama? |

**Properties của layer `image`:**

| Property | Type | Mô tả |
|---|---|---|
| `id` | int | **ID ảnh** (dùng để navigate viewer) |
| `sequence_id` | string | Thuộc sequence nào |
| `captured_at` | int (ms) | Thời gian chụp |
| `compass_angle` | int | Hướng la bàn (0–360°) |
| `is_pano` | bool | Ảnh panorama? |

#### API 2–3: Map Feature & Traffic Sign Tiles

```
GET https://tiles.mapillary.com/maps/vtp/mly_map_feature_point/2/{z}/{x}/{y}?access_token=TOKEN
GET https://tiles.mapillary.com/maps/vtp/mly_map_feature_traffic_sign/2/{z}/{x}/{y}?access_token=TOKEN
```

**Trả về:** Binary MVT

**Properties chung:**

| Property | Type | Mô tả |
|---|---|---|
| `id` | int | ID map feature |
| `value` | string | Loại đối tượng (vd: `object--fire-hydrant`, `regulatory--stop`) |
| `first_seen_at` | int (ms) | Lần đầu phát hiện |
| `last_seen_at` | int (ms) | Lần cuối phát hiện |

#### API 4: Image Metadata (lấy ngày chụp)

```
GET https://graph.mapillary.com/{image_id}?access_token=TOKEN&fields=captured_at
```

**Response:**
```json
{
  "captured_at": 1569600000000,
  "id": "1137674664114306"
}
```

> `captured_at` là Unix timestamp (ms). App convert thành dạng `"Sep 27, 2019"` hiển thị trên viewer bar.

#### API 5: Image Thumbnail 256px (hover preview)

```
GET https://graph.mapillary.com/{image_id}?fields=thumb_256_url
Headers: Authorization: OAuth TOKEN
```

**Response:**
```json
{
  "thumb_256_url": "https://scontent-..../256x192.jpg",
  "id": "1137674664114306"
}
```

> Dùng khi user **hover chuột** qua image dot trên bản đồ → hiển thị thumbnail tooltip 180×120px.

#### API 6: Image Thumbnail 1024px (Detection Panel)

```
GET https://graph.mapillary.com/{image_id}?fields=thumb_1024_url,width,height
Headers: Authorization: OAuth TOKEN
```

**Response:**
```json
{
  "thumb_1024_url": "https://scontent-..../1024x768.jpg",
  "width": 4032,
  "height": 3024,
  "id": "1137674664114306"
}
```

> Dùng trong **Detection Panel** để hiển thị ảnh lớn kèm bounding box. `width`/`height` dùng để tính tỷ lệ bounding box.

#### API 7: Tìm ảnh gần nhất theo Bounding Box

```
GET https://graph.mapillary.com/images?access_token=TOKEN&fields=id,geometry&bbox=108.1485,16.0740,108.1495,16.0750&limit=5
```

**Response:**
```json
{
  "data": [
    {
      "id": "1137674664114306",
      "geometry": {
        "type": "Point",
        "coordinates": [108.149, 16.074]
      }
    },
    {
      "id": "1137674664114307",
      "geometry": {
        "type": "Point",
        "coordinates": [108.1491, 16.0741]
      }
    }
  ]
}
```

> App tính khoảng cách Euclidean tới từng ảnh, chọn ảnh **gần nhất** rồi `viewer.moveTo()`.

#### API 8: Map Feature Detections

```
GET https://graph.mapillary.com/{map_feature_id}/detections?fields=geometry,image,value
Headers: Authorization: OAuth TOKEN
```

**Response:**
```json
{
  "data": [
    {
      "geometry": "AAIAAQAAEE...",
      "image": {
        "id": "1137674664114306"
      },
      "value": "object--fire-hydrant",
      "id": "987654321"
    },
    {
      "geometry": "AAIAAQBBCC...",
      "image": {
        "id": "1137674664114999"
      },
      "value": "object--fire-hydrant",
      "id": "987654322"
    }
  ]
}
```

> - `geometry` là **base64-encoded MVT** chứa polygon vùng phát hiện (bounding box trên ảnh gốc).
> - App decode geometry → tính tọa độ bounding box % → hiển thị khung đỏ nhấp nháy trên ảnh trong Detection Panel.
> - `image.id` dùng để fetch thumbnail 1024px và navigate viewer khi user click card.

#### API 9: Nominatim Geocoding

```
GET https://nominatim.openstreetmap.org/search?format=json&q=Đà Nẵng&limit=1
```

**Response:**
```json
[
  {
    "place_id": 297750959,
    "licence": "Data © OpenStreetMap contributors, ODbL 1.0.",
    "osm_type": "relation",
    "osm_id": 1905252,
    "lat": "16.0544068",
    "lon": "108.2021667",
    "display_name": "Đà Nẵng, Việt Nam",
    "class": "boundary",
    "type": "administrative",
    "importance": 0.6927
  }
]
```

> App lấy `lat`/`lon` rồi `map.flyTo()` tới vị trí đó.

#### API 10–11: Icon SVG (Mapillary Sprite Source)

```
GET https://raw.githubusercontent.com/mapillary/mapillary_sprite_source/master/package_objects/{value}.svg
GET https://raw.githubusercontent.com/mapillary/mapillary_sprite_source/master/package_signs/{value}.svg
```

**Trả về:** SVG XML (text)

> App fetch SVG → render lên canvas → tạo ImageData → `map.addImage()` để MapLibre dùng làm icon cho symbol layer.
> Nếu fetch thất bại → tạo fallback circle (tím cho object, cam cho sign).

#### API 12: OpenStreetMap Raster Tiles

```
GET https://tile.openstreetmap.org/{z}/{x}/{y}.png
```

**Trả về:** PNG image 256×256px — bản đồ nền.

---

## 6. Giải thích từng thành phần code

### 6.1 Cấu trúc file

```
d:/pbl7/pbl7/
├── index.html          ← File chính (HTML + CSS + JS tất cả trong 1 file, ~2477 dòng)
├── server.js           ← Node.js static file server (port 8080)
├── server.log          ← Log server
├── docs/               ← Thư mục tài liệu
└── README.md           ← Tài liệu này
```

### 6.2 Layout — Map-first Overlay

```
┌──────────────────────────────────────────────┐
│                  TOPBAR (48px)                │
│  Logo | Coords | Image ID | Layer Toggles    │
├──────────────────────────────────────────────┤
│                                              │
│         MapLibre Map (toàn màn hình)          │
│                                              │
│  ┌────────┐     ┌───────────┐  ┌──────────┐ │
│  │ Search │     │ Map Ctrl  │  │ Filter   │ │
│  │ Box    │     │ +/-/⬆/📍 │  │ Panels   │ │
│  └────────┘     └───────────┘  └──────────┘ │
│                                              │
│                  ┌──────────────────────────┐ │
│                  │ Detection Panel (if open)│ │
│                  │ - Header + icon          │ │
│                  │ - Detection cards        │ │
│                  │ - Pagination             │ │
│                  └──────────────────────────┘ │
│  ┌──────────────┐                            │
│  │ MapillaryJS  │                            │
│  │ Viewer       │   ┌────────┐  ┌──────────┐│
│  │ (overlay,    │   │ Legend │  │ Coords   ││
│  │  rounded)    │   └────────┘  │ Display  ││
│  └──────────────┘               └──────────┘│
└──────────────────────────────────────────────┘
```

**Layout:**
- `#map`: `position: absolute; inset: 0` — toàn màn hình
- `#viewer`: `position: absolute; left: 16px; bottom: 16px` — overlay bottom-left, bo tròn 14px, shadow
- `.divider`: `display: none` — không dùng layout split nữa
- Viewer có thể expand lên 50% (class `.expanded`)

### 6.3 Token Flow

```
App mở → Kiểm tra localStorage('mapillary_token')
  ├─ Có token → Ẩn prompt → initApp(token)
  └─ Không có → Hiện prompt (modal fullscreen blur) → User nhập → Validate → Lưu localStorage → initApp(token)
```

### 6.4 MapillaryJS Viewer

```javascript
viewer = new mapillary.Viewer({
  accessToken: token,
  container: 'viewer',
  imageId: params.pKey,
  component: {
    cover: false,      // Không hiện splash screen
    bearing: true,     // La bàn
    direction: true,   // Mũi tên điều hướng không gian
    sequence: true,    // Nút next/prev trong sequence
    zoom: true,        // Zoom in/out
    keyboard: true,    // Điều hướng bằng bàn phím
    pointer: true,     // Tương tác chuột
    image: true,       // Component ảnh
    cache: true,       // Cache ảnh
  },
});
```

**Các event quan trọng:**

| Event | Khi nào | Dùng để |
|---|---|---|
| `image` | Chuyển sang ảnh mới | Cập nhật map center, URL, camera marker, fetch date |
| `bearing` | Xoay góc nhìn | Cập nhật camera cone trên map |
| `position` | Vị trí camera thay đổi | Đồng bộ map center + tọa độ topbar |
| `load` | Viewer tải xong | Ẩn loading spinner |

### 6.5 MapLibre Map

```javascript
map = new maplibregl.Map({
  container: 'map',
  center: [lng, lat],
  zoom: z,
  style: {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
      }
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  },
});
```

**Tất cả sources được thêm sau khi map load:**

| Source ID | Type | URL | Mô tả |
|---|---|---|---|
| `osm` | raster | `tile.openstreetmap.org/...` | Bản đồ nền |
| `mly-coverage` | vector | `tiles.mapillary.com/.../mly1_public/...` | Coverage + image dots |
| `mly-features` | vector | `tiles.mapillary.com/.../mly_map_feature_point/...` | Đối tượng (đèn, cột, ...) |
| `mly-signs` | vector | `tiles.mapillary.com/.../mly_map_feature_traffic_sign/...` | Biển báo giao thông |
| `camera-point` | geojson | (dynamic) | Điểm vị trí camera |
| `camera-cone` | geojson | (dynamic) | Polygon hình nón FOV |
| `feature-hover` | geojson | (dynamic) | Ring hover highlight |
| `feature-selected` | geojson | (dynamic) | Ring selection highlight |

**Tất cả layers được thêm:**

| Layer ID | Source | Type | Mô tả |
|---|---|---|---|
| `osm` | `osm` | raster | Bản đồ nền |
| `mly-sequences` | `mly-coverage` | line | Đường coverage xanh (zoom 6+) |
| `mly-images` | `mly-coverage` | circle | Điểm ảnh trắng viền xanh (zoom 14+) |
| `mly-feature-points` | `mly-features` | **symbol** | **Icon SVG** đối tượng (zoom 14+) |
| `mly-traffic-signs` | `mly-signs` | **symbol** | **Icon SVG** biển báo (zoom 14+) |
| `camera-cone-fill` | `camera-cone` | fill | Hình nón FOV (xanh nhạt) |
| `camera-cone-line` | `camera-cone` | line | Viền hình nón |
| `camera-dot` | `camera-point` | circle | Điểm vị trí camera (xanh, viền trắng) |
| `feature-selected-ring` | `feature-selected` | circle | Vòng tròn highlight khi chọn feature |
| `feature-hover-ring` | `feature-hover` | circle | Vòng tròn highlight khi hover |

> **Lưu ý:** `mly-feature-points` và `mly-traffic-signs` dùng **symbol layer** (không phải circle) — render icon SVG thực tế của từng đối tượng trên bản đồ.

### 6.6 Camera Cone (hình nón hướng nhìn)

Camera cone là hình quạt trên bản đồ cho biết **vị trí** và **hướng nhìn** của viewer:

```
        ╱  ╲           ← Hướng nhìn (bearing)
       ╱    ╲
      ╱ 70°  ╲        ← FOV = 70 độ
     ╱   FOV  ╲
    ╱          ╲
   ●                   ← Vị trí camera (lat, lng)
```

**Cách tính:**
1. Từ vị trí camera (lng, lat), tính 12 điểm cách 25m trên cung từ `bearing - 35°` đến `bearing + 35°`
2. Dùng công thức Haversine nghịch (`offsetPoint`) để tính tọa độ mỗi điểm
3. Tạo polygon GeoJSON: `[camera] → [arc points] → [camera]`
4. Cập nhật GeoJSON source mỗi khi bearing thay đổi

### 6.7 Click-to-Navigate (4 cấp fallback)

```
User click trên map
  │
  ├─ 1. Có feature ở layer 'mly-feature-points' / 'mly-traffic-signs'?
  │    └─ CÓ → Mở Detection Panel + tìm ảnh gần nhất
  │
  ├─ 2. Có feature ở layer 'mly-images'?
  │    └─ CÓ → Lấy properties.id → viewer.moveTo(id)
  │
  ├─ 3. Có feature ở layer 'mly-sequences'?
  │    └─ CÓ → Lấy properties.image_id → viewer.moveTo(id)
  │
  └─ 4. Không có feature nào?
       └─ Xóa selection, đóng Detection Panel
```

### 6.8 Đồng bộ 2 chiều (Sync)

```
Viewer thay đổi ảnh ──→ Cập nhật Map center + camera cone + URL
Map click              ──→ Viewer chuyển đến ảnh

⚠️ Tránh vòng lặp vô hạn bằng 2 flag:
  - syncingFromViewer = true  → Map event KHÔNG trigger viewer
  - syncingFromMap = true     → Viewer event KHÔNG trigger map
  - Timeout 400–600ms để reset flag
```

### 6.9 URL Sync

```
Mỗi khi viewer/map thay đổi:
  → Cập nhật URL: ?lat=16.074&lng=108.149&z=18.00&pKey=1137674664114306
  → Dùng history.replaceState() (không tạo history mới)
  → Debounce 150ms (tránh cập nhật quá nhiều)

Khi mở lại link:
  → Parse URL params → Khởi tạo map + viewer tại vị trí đó
```

### 6.10 Icon Loading System (Lazy Load SVG)

```
Map render feature → MapLibre fire 'styleimagemissing' event
  → Kiểm tra prefix: 'pt:' (point) hoặc 'sg:' (sign)
  → Fetch SVG từ GitHub Sprite Source
  → Render SVG lên canvas (2x DPR)
  → map.addImage(id, imageData, { pixelRatio: 2 })
  → Nếu fetch fail → tạo fallback circle (tím/cam)

Khi initMap:
  → Preload tất cả point icons (30 loại, có sẵn danh sách)
  → Sign icons: lazy-load khi cần (quá nhiều loại)
```

### 6.11 Filter Panels

App có 2 filter panel ở góc phải:

| Panel | Lọc layer | Cách lọc |
|---|---|---|
| **Show traffic signs** | `mly-traffic-signs` | Theo exact value (regulatory--stop--g1, warning--curve-left--g1, ...) — 99 loại biển báo cụ thể với icon SVG |
| **Show points** | `mly-feature-points` | Theo exact value (object--fire-hydrant, ...) |

**Danh sách biển báo (`SIGN_TYPES`):** 99 loại biển báo phổ biến nhất, chia thành 4 nhóm:
- **Regulatory** (42 loại): Stop, Yield, No entry, Speed limits (30–120), No overtaking, No parking, No U-turn, Keep left/right, Roundabout, One way, ...
- **Warning** (31 loại): Curve left/right, Steep ascent/descent, Slippery road, Road works, Pedestrian crossing, Children, Railroad crossing, ...
- **Information** (16 loại): Parking, Hospital, Gas station, Bus stop, Dead end, Motorway, ...
- **Complementary** (10 loại): Chevron left/right, Distance, Obstacle delineator, Tow-away zone, ...

**Tìm kiếm trong dropdown:** Mỗi filter dropdown có ô tìm kiếm (sticky) để lọc nhanh trong danh sách dài. Gõ tên biển báo → danh sách tự lọc theo text.

**Trạng thái filter:**
- **Chưa chọn gì** → hiện tất cả (traffic signs hiện all mặc định, points ẩn all mặc định)
- **Chọn "All"** → hiện tất cả (`setFilter(null)`)
- **Chọn cụ thể** → filter exact match values

**Download:** Nút "Download" xuất tất cả features đang hiển thị thành file GeoJSON.

### 6.12 Detection Panel

Khi click vào 1 map feature/traffic sign:

```
1. Mở panel bên trái (360px, white background)
2. Fetch detections: GET /{map_feature_id}/detections?fields=geometry,image,value
3. Fetch thumbnail 1024px cho mỗi ảnh (batch Promise.all)
4. Render detection cards (3 per page):
   - Ảnh thumbnail 1024px
   - Bounding box đỏ nhấp nháy (decoded từ base64 MVT geometry)
   - Click card → viewer.moveTo(image_id)
5. Pagination: nút "Next 3" để xem thêm
```

**MVT Geometry Decoding:**
- `geometry` field trong detection response là **base64-encoded MVT tile**
- App decode base64 → parse protobuf thủ công → extract zigzag-encoded coordinates
- Convert tọa độ MVT (extent 4096) → phần trăm → CSS position cho bounding box overlay

### 6.13 Hover Preview

```
User di chuột qua image dot trên bản đồ:
  1. Highlight ring xanh (feature-hover source)
  2. Fetch thumbnail 256px: GET /{image_id}?fields=thumb_256_url
  3. Hiển thị tooltip 180×120px tại vị trí chuột
  4. Di chuột ra → ẩn tooltip, xóa highlight
```

### 6.14 Map Controls

| Nút | Chức năng |
|---|---|
| **+** | `map.zoomIn()` |
| **−** | `map.zoomOut()` |
| **⬆** | Reset bearing=0, pitch=0 (hướng Bắc) |
| **📍** | `map.flyTo()` tới vị trí camera hiện tại (zoom 18) |

Thêm `ScaleControl` ở góc dưới phải bản đồ.

---

## 7. Cách hoạt động chi tiết

### 7.1 Luồng khởi tạo app

```
1. HTML load → Kiểm tra token trong localStorage
2. Nếu chưa có → Hiện dialog nhập token (modal blur fullscreen)
3. Sau khi có token:
   a. Parse URL params (lat, lng, z, pKey)
   b. initViewer() → Tạo MapillaryJS, load ảnh pKey, gắn events
   c. initMap()    → Tạo MapLibre, thêm 8 sources + 10 layers
   d. initDivider() → No-op (layout overlay, không cần divider)
   e. initLayerToggles() → Gắn nút bật/tắt 3 nhóm layer
   f. initMapControls() → Zoom, North, Locate, Search
   g. setupIconLoading() → Preload point icons + lazy-load event
   h. initFilterPanels() → Tạo 2 filter panel (signs + points)
4. Viewer fire 'load' → Ẩn loading spinner
5. Map fire 'load' → Coverage lines + icon features xuất hiện
6. App sẵn sàng sử dụng!
```

### 7.2 Khi user click vào coverage line

```
1. map.on('click') trigger
2. queryRenderedFeatures trên ['mly-sequences'] (padding 8px)
3. Lấy image_id từ feature properties
4. Set syncingFromMap = true
5. Gọi viewer.moveTo(image_id)
6. Viewer load ảnh mới → fire 'image' event
7. Vì syncingFromMap = true → KHÔNG cập nhật map center (tránh loop)
8. Sau 600ms → syncingFromMap = false
9. Camera cone cập nhật vị trí mới
10. URL cập nhật
```

### 7.3 Khi user xoay view trong viewer

```
1. User kéo chuột trong viewer → bearing thay đổi
2. viewer.on('bearing') fire
3. Lấy currentBearing mới
4. Gọi updateCameraMarker() → Tính lại polygon cone (12 arc points, 25m radius)
5. Cập nhật GeoJSON source 'camera-cone'
6. Cone xoay trên bản đồ theo hướng nhìn mới
```

### 7.4 Khi user click vào map feature (đối tượng / biển báo)

```
1. map.on('click') trigger
2. queryRenderedFeatures trên ['mly-feature-points', 'mly-traffic-signs'] (padding 12px)
3. Highlight feature (feature-selected ring — tím hoặc cam)
4. Mở Detection Panel:
   a. Hiện panel + loading state
   b. Fetch detections: GET /{id}/detections?fields=geometry,image,value
   c. Batch fetch thumbnails 1024px cho mỗi ảnh
   d. Decode base64 MVT geometry → bounding box %
   e. Render detection cards (3 per page)
5. Đồng thời tìm ảnh gần nhất → navigate viewer tới đó
```

### 7.5 Khi user hover vào image dot

```
1. map.on('mousemove') trigger
2. queryRenderedFeatures trên ['mly-images'] (padding 8px)
3. Hiện green ring highlight (feature-hover source)
4. Fetch thumbnail 256px: GET /{image_id}?fields=thumb_256_url
5. Hiển thị tooltip preview (position theo chuột)
6. Di chuột ra → ẩn tooltip + xóa ring
```

### 7.6 Khi user tìm kiếm địa điểm

```
1. User gõ tên địa điểm + Enter
2. Debounce 100ms
3. Fetch Nominatim: GET /search?format=json&q=...&limit=1
4. Lấy lat/lon từ kết quả đầu tiên
5. map.flyTo({ center: [lon, lat], zoom: 16, duration: 1500 })
```

---

## 8. Backend — Database & API

### 8.1 Database Schema

Hệ thống sử dụng PostgreSQL + PostGIS với 3 bảng chính:

#### Bảng `crawl_jobs` — Theo dõi trạng thái crawl từng tile

| Cột | Kiểu | Mô tả |
|---|---|---|
| `id` | BIGSERIAL PK | ID tự tăng |
| `tile_key` | TEXT | Tọa độ tile `z/x/y` (vd: `14/13456/7890`) |
| `status` | TEXT | `pending` → `running` → `done` / `failed` |
| `images_found` | INT | Số ảnh tìm thấy trong tile |
| `error_message` | TEXT | Lỗi nếu failed |

#### Bảng `sequences` — Danh sách sequence (chuỗi ảnh)

| Cột | Kiểu | Mô tả |
|---|---|---|
| `id` | BIGSERIAL PK | ID nội bộ |
| `provider_sequence_id` | TEXT | ID sequence từ Mapillary |

#### Bảng `images` — Metadata từng ảnh

| Cột | Kiểu | Mô tả |
|---|---|---|
| `id` | BIGSERIAL PK | ID nội bộ |
| `provider_image_id` | TEXT | ID ảnh từ Mapillary |
| `geom` | GEOMETRY(Point, 4326) | Tọa độ PostGIS (cho spatial query) |
| `lat`, `lon` | DOUBLE PRECISION | Tọa độ |
| `captured_at` | TIMESTAMPTZ | Thời điểm chụp |
| `compass_angle` | REAL | Hướng la bàn (0–360°) |
| `is_pano` | BOOLEAN | Ảnh panorama hay không |
| `status` | TEXT | `metadata_only` → `queued` → `downloaded` |
| `tile_key` | TEXT | Tile đã phát hiện ảnh này |

**Indexes:** GIST index trên `geom` cho spatial queries nhanh, B-tree trên `captured_at`, `status`, `sequence_id`, `tile_key`.

### 8.2 Backend API Endpoints

API server chạy tại `http://localhost:3000`:

#### `GET /api/v1/images?bbox=minLon,minLat,maxLon,maxLat&limit=100&cursor=ID`

Lấy danh sách ảnh trong bounding box (cursor-based pagination).

```json
{
  "data": [
    {
      "id": 1,
      "provider_image_id": "1234567890",
      "lat": 16.074,
      "lon": 108.149,
      "captured_at": "2023-06-15T10:30:00Z",
      "compass_angle": 180.5,
      "is_pano": false,
      "tile_key": "14/13456/7890"
    }
  ],
  "cursor": 100,
  "count": 100
}
```

#### `GET /api/v1/images/nearby?lat=16.074&lon=108.149&radius=500&limit=20`

Tìm ảnh gần nhất trong bán kính (mét), sắp xếp theo khoảng cách.

```json
{
  "data": [
    {
      "id": 1,
      "provider_image_id": "1234567890",
      "lat": 16.074,
      "lon": 108.149,
      "distance_m": 42
    }
  ],
  "count": 5
}
```

#### `GET /api/v1/images/:id`

Lấy chi tiết 1 ảnh theo ID nội bộ.

#### `GET /api/v1/stats`

Thống kê tổng quan database.

```json
{
  "images": 150000,
  "sequences": 3200,
  "tiles_crawled": 450,
  "bounds": {
    "min_lat": 15.95,
    "max_lat": 16.15,
    "min_lon": 107.90,
    "max_lon": 108.35
  }
}
```

### 8.3 Crawler

- Sử dụng **Mapillary Vector Tiles** (MVT) tại zoom level **14**
- Parse protobuf bằng `@mapbox/vector-tile` + `pbf`
- Rate limit: ~6–7 requests/giây (150ms delay), tự retry tối đa 3 lần
- Hỗ trợ resume — bỏ qua tile đã crawl thành công
- Khu vực có sẵn: `danang` `[107.9, 15.95, 108.35, 16.15]`, `hoakhanh` `[108.13, 16.05, 108.17, 16.09]`

### 8.4 Queue & Worker (BullMQ + Redis)

- **Enqueue:** Lọc ảnh `status = 'metadata_only'` theo bbox, đẩy vào Redis queue
- **Worker:** Lấy `thumb_256_url` từ Mapillary Graph API → tải ảnh về `storage/thumbs/`
- **Lưu trữ:** Hash-based subdirectory (vd: `storage/thumbs/ab/cd/image_id.jpg`) tránh quá nhiều file trong 1 thư mục
- **Rate limit:** 10 requests/giây (100ms delay)
- **Idempotent:** Bỏ qua ảnh đã tải, cập nhật status → `downloaded`

---

## 9. Xử lý sự cố

### Token không hoạt động

| Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|
| Coverage không hiện | Token sai hoặc hết hạn | Kiểm tra lại token tại dashboard |
| Viewer báo lỗi | Token không có quyền | Dùng Client Token, không phải Secret |
| 401 Unauthorized | Token bị revoke | Tạo app mới, lấy token mới |

**Xóa token đã lưu:** Mở Console (F12) → gõ `localStorage.removeItem('mapillary_token')` → Refresh

### Map trống (không có coverage)

- Zoom ra xa (zoom 6–14 mới thấy sequence lines)
- Kiểm tra kết nối internet
- Kiểm tra token đã đúng chưa
- Thử tắt/bật layer toggle "Coverage"

### Icon feature/sign không hiện

- Kiểm tra zoom level — cần zoom **14+** mới thấy
- Mở Console (F12) xem lỗi fetch SVG
- Icon sẽ tự fallback thành circle nếu SVG fetch thất bại
- Kiểm tra filter panel — có thể đang filter ẩn hết

### Viewer không tải ảnh

- Kiểm tra `pKey` trong URL có đúng image ID không
- Thử đổi sang image ID khác
- Mở Console (F12) xem lỗi cụ thể

### Detection Panel trống

- Không phải đối tượng nào cũng có detections
- Kiểm tra Console xem có lỗi API không
- Thử click đối tượng khác

### Không chạy được server

```bash
# Cách 1: Node.js (khuyến nghị — dùng server.js có sẵn)
node server.js

# Cách 2: Python
python -m http.server 8080

# Cách 3: Python3 (Linux/Mac)
python3 -m http.server 8080

# Cách 4: npx serve
npx serve . -p 8080

# Cách 5: VS Code extension "Live Server"
# Cài extension → Right-click index.html → "Open with Live Server"
```

### Lỗi CORS

- KHÔNG mở file bằng `file://` (double-click)
- PHẢI chạy qua `http://localhost:xxxx`

---

## 10. Danh sách đối tượng được hỗ trợ

### 10.1 Point Objects (30 loại)

| Value | Label |
|---|---|
| `object--banner` | Banner |
| `object--bench` | Bench |
| `object--bike-rack` | Bike rack |
| `object--catch-basin` | Catch basin |
| `object--cctv-camera` | CCTV camera |
| `object--fire-hydrant` | Fire hydrant |
| `object--junction-box` | Junction box |
| `object--mailbox` | Mailbox |
| `object--manhole` | Manhole |
| `object--parking-meter` | Parking meter |
| `object--phone-booth` | Phone booth |
| `object--sign--advertisement` | Signage - Advertisement |
| `object--sign--information` | Signage - Information |
| `object--sign--store` | Signage - Store |
| `object--street-light` | Street light |
| `object--support--pole` | Pole |
| `object--support--traffic-sign-frame` | Traffic sign frame |
| `object--support--utility-pole` | Utility pole |
| `object--traffic-cone` | Traffic cone |
| `object--traffic-light--cyclists` | Traffic light - cyclists |
| `object--traffic-light--general-horizontal` | Traffic light - horizontal |
| `object--traffic-light--general-single` | Traffic light - single |
| `object--traffic-light--general-upright` | Traffic light - upright |
| `object--traffic-light--other` | Traffic light - other |
| `object--traffic-light--pedestrians` | Traffic light - pedestrians |
| `object--trash-can` | Trash can |
| `object--water-valve` | Water valve |
| `construction--flat--crosswalk-plain` | Crosswalk - plain |
| `construction--flat--driveway` | Driveway |
| `construction--barrier--temporary` | Temporary barrier |

### 10.2 Traffic Sign Categories (4 nhóm)

| Category | Label | Ví dụ |
|---|---|---|
| `regulatory` | Regulatory | Stop, speed limit, no entry... |
| `warning` | Warning | Curves, pedestrians, hazards... |
| `information` | Information | Hospital, parking, gas... |
| `complementary` | Complementary | Distance, speed sub-signs... |

---

## 11. State Management

App quản lý state hoàn toàn bằng biến global JavaScript:

| Biến | Type | Mô tả |
|---|---|---|
| `mlToken` | string | Mapillary Access Token |
| `viewer` | Viewer | MapillaryJS Viewer instance |
| `map` | Map | MapLibre Map instance |
| `currentImageId` | string | ID ảnh đang xem |
| `currentLngLat` | object | Tọa độ camera hiện tại |
| `currentBearing` | number | Hướng nhìn hiện tại (0–360°) |
| `syncingFromViewer` | bool | Flag chống loop sync từ viewer |
| `syncingFromMap` | bool | Flag chống loop sync từ map |
| `urlUpdateTimer` | Timer | Debounce timer cho URL update |
| `viewerExpanded` | bool | Viewer đang expand hay không |
| `dateCache` | Map | Cache ngày chụp theo image ID |
| `imageLoadCache` | Map | Cache promise load icon SVG |
| `activePointFilters` | Set | Các point type đang filter |
| `activeSignFilters` | Set | Các sign category đang filter |
| `allDetections` | Array | Danh sách detection đang hiển thị |
| `detPage` | number | Trang detection hiện tại |
| `hoveredImageId` | string | Image ID đang hover |
| `selectedKey` | string | Feature key đang được chọn |
| `currentPopup` | Popup | MapLibre popup hiện tại |

---

## Tài liệu tham khảo

- [Mapillary API v4 Documentation](https://www.mapillary.com/developer/api-documentation)
- [MapillaryJS GitHub](https://github.com/mapillary/mapillary-js)
- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)
- [Mapillary Sprite Source (SVG icons)](https://github.com/mapillary/mapillary_sprite_source)
- [Mapillary CSS (brand colors)](https://github.com/mapillary/mapillary-css)
- [Mapillary Press Assets](https://github.com/mapillary/mapillary_press)
- [OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)
- [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)

# 📘 Mapillary Explorer — Tài liệu hướng dẫn

## Mục lục

1. [Tổng quan dự án](#1-tổng-quan-dự-án)
2. [Kiến trúc hệ thống](#2-kiến-trúc-hệ-thống)
3. [Hướng dẫn lấy Mapillary Access Token](#3-hướng-dẫn-lấy-mapillary-access-token)
4. [Cài đặt & Chạy dự án](#4-cài-đặt--chạy-dự-án)
5. [Giải thích API & Dữ liệu](#5-giải-thích-api--dữ-liệu)
6. [Giải thích từng thành phần code](#6-giải-thích-từng-thành-phần-code)
7. [Cách hoạt động chi tiết](#7-cách-hoạt-động-chi-tiết)
8. [Xử lý sự cố](#8-xử-lý-sự-cố)

---

## 1. Tổng quan dự án

### Dự án là gì?

Mapillary Explorer là ứng dụng web **khám phá bản đồ đường phố** tương tự [mapillary.com/app](https://www.mapillary.com/app/). Ứng dụng cho phép:

- Xem ảnh đường phố (street-level imagery) từ Mapillary
- Điều hướng trên bản đồ với coverage lines (đường xanh lá)
- Click vào bản đồ để nhảy đến ảnh tại vị trí đó
- Xem các đối tượng đã phát hiện (biển báo, đèn giao thông, ...)
- Chia sẻ vị trí qua URL

### Công nghệ sử dụng

| Công nghệ | Vai trò | Link |
|---|---|---|
| **MapillaryJS v4.1.2** | Viewer xem ảnh đường phố (WebGL) | [GitHub](https://github.com/mapillary/mapillary-js) |
| **MapLibre GL JS v4.7.1** | Bản đồ tương tác (thay thế Mapbox, miễn phí) | [maplibre.org](https://maplibre.org/) |
| **Mapillary API v4** | Lấy dữ liệu ảnh, coverage, detections | [API Docs](https://www.mapillary.com/developer/api-documentation) |
| **OpenStreetMap Tiles** | Lớp bản đồ nền (miễn phí) | [openstreetmap.org](https://www.openstreetmap.org/) |
| **Nominatim API** | Tìm kiếm địa điểm (geocoding, miễn phí) | [nominatim.org](https://nominatim.org/) |

### Tại sao chọn MapLibre thay vì Mapbox?

- **MapLibre**: Miễn phí hoàn toàn, không cần token riêng, mã nguồn mở
- **Mapbox**: Cần đăng ký token riêng, có giới hạn free tier
- Cả hai đều hỗ trợ vector tiles của Mapillary

---

## 2. Kiến trúc hệ thống

### Sơ đồ tổng quan

```
┌─────────────────────────────────────────────────────┐
│                    TRÌNH DUYỆT                       │
│                                                      │
│  ┌──────────────┐  ┌─────┐  ┌────────────────────┐  │
│  │  MapillaryJS  │  │  ↔  │  │   MapLibre GL JS   │  │
│  │   Viewer      │  │     │  │      Map           │  │
│  │ (ảnh đường    │  │ Kéo │  │ (bản đồ + coverage │  │
│  │  phố WebGL)   │  │ thả │  │  + features)       │  │
│  └──────┬───────┘  └─────┘  └────────┬───────────┘  │
│         │                             │              │
│         └──────── ĐỒNG BỘ ───────────┘              │
│              (vị trí, hướng, URL)                    │
└─────────┬───────────────────────────┬────────────────┘
          │                           │
          ▼                           ▼
  ┌───────────────┐          ┌──────────────────┐
  │ Mapillary API │          │ Mapillary Tiles   │
  │ (Graph API)   │          │ (Vector Tiles)    │
  │               │          │                   │
  │ • Ảnh theo ID │          │ • Coverage lines  │
  │ • Ảnh theo    │          │ • Image dots      │
  │   bbox        │          │ • Map features    │
  │ • Detections  │          │ • Traffic signs    │
  └───────────────┘          └──────────────────┘
```

### Luồng dữ liệu

```
1. User mở app → Nhập token → Lưu localStorage
2. Khởi tạo MapillaryJS Viewer (trái) + MapLibre Map (phải)
3. Map tải vector tiles → hiển thị coverage lines xanh
4. User click coverage line → lấy image_id → viewer.moveTo(id)
5. Viewer chuyển ảnh → fire event "image" → cập nhật map center + camera cone
6. URL tự động cập nhật → có thể chia sẻ link
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
| **Company website** | `http://localhost:8000` | URL website (bất kỳ URL hợp lệ) |
| **Redirect URL** | `http://localhost:8000` | URL callback (bất kỳ URL hợp lệ) |

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
- Python 3.x (để chạy local server)
- Kết nối Internet
- Mapillary Access Token

### Cách chạy

#### Cách 1: Python HTTP Server

```bash
# Mở terminal/cmd tại thư mục dự án
cd d:\pbl7\pbl7

# Chạy server
python -m http.server 8000
```

Mở trình duyệt: **http://localhost:8000**

#### Cách 2: Node.js (nếu có)

```bash
npx serve d:\pbl7\pbl7 -p 8000
```

#### Cách 3: VS Code Live Server

1. Cài extension **"Live Server"** trong VS Code
2. Mở file `index.html`
3. Click **"Go Live"** ở thanh status bar

### Tại sao cần server? Mở file trực tiếp không được sao?

Mở file `index.html` trực tiếp (double-click) sẽ dùng giao thức `file://`. Trình duyệt sẽ **chặn các request API** (CORS policy) khi dùng `file://`. Cần chạy qua `http://localhost` để tránh lỗi này.

---

## 5. Giải thích API & Dữ liệu

### 5.1 Mapillary API v4 — Tổng quan

Mapillary cung cấp 2 loại endpoint:

| Loại | URL gốc | Dùng để |
|---|---|---|
| **Graph API** | `https://graph.mapillary.com` | Lấy metadata ảnh, detections (JSON) |
| **Vector Tiles** | `https://tiles.mapillary.com` | Hiển thị coverage trên bản đồ (MVT binary) |

### 5.2 Xác thực (Authentication)

Mọi request đều cần token:

```
# Cho Vector Tiles — dùng query parameter
https://tiles.mapillary.com/...?access_token=MLY|xxxx|yyyy

# Cho Graph API — dùng header
Authorization: OAuth MLY|xxxx|yyyy
```

### 5.3 Vector Tiles — Coverage Lines (đường xanh trên bản đồ)

Đây là cách hiển thị **đường xanh lá** trên bản đồ cho biết nơi có ảnh.

**URL format:**
```
https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=TOKEN
```

**Các layer trong tileset `mly1_public`:**

| Layer | Zoom | Geometry | Mô tả |
|---|---|---|---|
| `overview` | 0–5 | Point | Cluster tổng quan ở zoom thấp |
| `sequence` | 6–14 | **LineString** | **Đường coverage xanh lá** ← quan trọng nhất |
| `image` | 14 | Point | Vị trí từng ảnh riêng lẻ |

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

### 5.4 Vector Tiles — Map Features (đối tượng phát hiện)

**Đối tượng thường (đèn giao thông, cột điện, ...):**
```
https://tiles.mapillary.com/maps/vtp/mly_map_feature_point/2/{z}/{x}/{y}?access_token=TOKEN
```
- Layer: `point`, Zoom: 14, Geometry: Point

**Biển báo giao thông:**
```
https://tiles.mapillary.com/maps/vtp/mly_map_feature_traffic_sign/2/{z}/{x}/{y}?access_token=TOKEN
```
- Layer: `traffic_sign`, Zoom: 14, Geometry: Point

**Properties chung:**

| Property | Type | Mô tả |
|---|---|---|
| `id` | int | ID map feature |
| `value` | string | Loại đối tượng (vd: `object--fire-hydrant`) |
| `first_seen_at` | int (ms) | Lần đầu phát hiện |
| `last_seen_at` | int (ms) | Lần cuối phát hiện |

### 5.5 Graph API — Tìm ảnh theo vị trí

Khi user click vào bản đồ mà không có `image_id`, app dùng Graph API để tìm ảnh gần nhất:

```
GET https://graph.mapillary.com/images
  ?access_token=TOKEN
  &bbox=minLon,minLat,maxLon,maxLat    ← bounding box nhỏ quanh điểm click
  &fields=id,geometry
  &limit=5
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
    }
  ]
}
```

**Giới hạn:** Bounding box phải nhỏ hơn 0.01 độ vuông.

### 5.6 Nominatim API — Tìm kiếm địa điểm

App dùng Nominatim (miễn phí) cho ô search:

```
GET https://nominatim.openstreetmap.org/search
  ?format=json
  &q=Đà Nẵng
  &limit=1
```

**Response:**
```json
[
  {
    "lat": "16.0544068",
    "lon": "108.2021667",
    "display_name": "Đà Nẵng, Việt Nam"
  }
]
```

---

## 6. Giải thích từng thành phần code

### 6.1 Cấu trúc file

```
d:/pbl7/pbl7/
├── index.html          ← File chính (HTML + CSS + JS tất cả trong 1 file)
├── docs/
│   └── README.md       ← Tài liệu này
└── server.js           ← (nếu có) Node.js server
```

### 6.2 Layout — Split Screen

```
┌──────────────────────────────────────────────┐
│                  TOPBAR (48px)                │
│  Logo | Coords | Image ID | Layer Toggles    │
├──────────────────┬─────┬─────────────────────┤
│                  │     │                      │
│   MapillaryJS    │  ↔  │    MapLibre Map      │
│    Viewer        │ Kéo │                      │
│  (ảnh đường phố) │ thả │  • Coverage lines    │
│                  │     │  • Image dots        │
│                  │     │  • Feature points     │
│                  │     │  • Camera cone        │
│                  │     │  • Search box         │
│                  │     │  • Legend             │
└──────────────────┴─────┴─────────────────────┘
```

**CSS Grid/Flex:**
- `#app-container`: `display: flex` chia 2 bên
- `#viewer` và `#map`: `flex: 1` (50/50 mặc định)
- `.divider`: 5px, có thể kéo thả để thay đổi tỷ lệ

### 6.3 Token Flow

```
App mở → Kiểm tra localStorage('mapillary_token')
  ├─ Có token → Ẩn prompt → initApp(token)
  └─ Không có → Hiện prompt → User nhập → Lưu localStorage → initApp(token)
```

### 6.4 MapillaryJS Viewer

```javascript
// Khởi tạo viewer
viewer = new mapillary.Viewer({
  accessToken: token,           // Token Mapillary
  container: 'viewer',          // ID element HTML
  imageId: params.pKey,         // Ảnh ban đầu từ URL
  component: {
    cover: false,               // Không hiện splash screen
    bearing: true,              // La bàn
    direction: true,            // Mũi tên điều hướng không gian
    sequence: true,             // Nút next/prev trong sequence
    zoom: true,                 // Zoom in/out
    keyboard: true,             // Điều hướng bằng bàn phím
  },
});
```

**Các event quan trọng:**

| Event | Khi nào | Dùng để |
|---|---|---|
| `image` | Chuyển sang ảnh mới | Cập nhật map center, URL, camera marker |
| `bearing` | Xoay góc nhìn | Cập nhật camera cone trên map |
| `position` | Vị trí camera thay đổi | Đồng bộ map center |
| `load` | Viewer tải xong | Ẩn loading spinner |

### 6.5 MapLibre Map

```javascript
// Khởi tạo map với OSM tiles
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

**Các layer được thêm sau khi map load:**

| Layer ID | Source | Loại | Mô tả |
|---|---|---|---|
| `mly-sequences` | `mly-coverage` | line | Đường coverage xanh |
| `mly-images` | `mly-coverage` | circle | Điểm ảnh (zoom 14+) |
| `mly-feature-points` | `mly-features` | circle | Đối tượng phát hiện (tím) |
| `mly-traffic-signs` | `mly-signs` | circle | Biển báo (cam) |
| `camera-cone-fill` | `camera-cone` | fill | Hình nón FOV (xanh nhạt) |
| `camera-cone-line` | `camera-cone` | line | Viền hình nón |
| `camera-dot` | `camera-point` | circle | Điểm vị trí camera |

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
1. Từ vị trí camera (lng, lat), tính 2 điểm cách 25m theo hướng `bearing ± 35°`
2. Tạo polygon GeoJSON: `[camera] → [trái] → ... → [phải] → [camera]`
3. Cập nhật GeoJSON source mỗi khi bearing thay đổi

### 6.7 Click-to-Navigate (3 cấp fallback)

```
User click trên map
  │
  ├─ 1. Có feature ở layer 'mly-images'?
  │    └─ CÓ → Lấy properties.id → viewer.moveTo(id)
  │
  ├─ 2. Có feature ở layer 'mly-sequences'?
  │    └─ CÓ → Lấy properties.image_id → viewer.moveTo(id)
  │
  └─ 3. Không có feature nào?
       └─ Gọi Graph API bbox search → Tìm ảnh gần nhất → viewer.moveTo(id)
```

### 6.8 Đồng bộ 2 chiều (Sync)

```
Viewer thay đổi ảnh ──→ Cập nhật Map center + camera cone
Map click              ──→ Viewer chuyển đến ảnh

⚠️ Tránh vòng lặp vô hạn bằng 2 flag:
  - syncingFromViewer = true  → Map KHÔNG trigger ngược lại
  - syncingFromMap = true     → Viewer KHÔNG trigger ngược lại
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

---

## 7. Cách hoạt động chi tiết

### 7.1 Luồng khởi tạo app

```
1. HTML load → Kiểm tra token trong localStorage
2. Nếu chưa có → Hiện dialog nhập token
3. Sau khi có token:
   a. Parse URL params (lat, lng, z, pKey)
   b. initViewer() → Tạo MapillaryJS, load ảnh pKey
   c. initMap()    → Tạo MapLibre, thêm coverage + feature layers
   d. initDivider() → Gắn sự kiện kéo thả divider
   e. initLayerToggles() → Gắn nút bật/tắt layers
   f. initMapControls() → Zoom, North, Locate, Search
4. Viewer fire 'load' → Ẩn loading spinner
5. Map fire 'load' → Coverage lines xuất hiện
6. App sẵn sàng sử dụng!
```

### 7.2 Khi user click vào coverage line

```
1. map.on('click', 'mly-sequences') trigger
2. Lấy image_id từ feature properties
3. Set syncingFromMap = true
4. Gọi viewer.moveTo(image_id)
5. Viewer load ảnh mới → fire 'image' event
6. Vì syncingFromMap = true → KHÔNG cập nhật map center (tránh loop)
7. Sau 600ms → syncingFromMap = false
8. Camera cone cập nhật vị trí mới
9. URL cập nhật
```

### 7.3 Khi user xoay view trong viewer

```
1. User kéo chuột trong viewer → bearing thay đổi
2. viewer.on('bearing') fire
3. Lấy currentBearing mới
4. Gọi updateCameraMarker() → Tính lại polygon cone
5. Cập nhật GeoJSON source 'camera-cone'
6. Cone xoay trên bản đồ theo hướng nhìn mới
```

---

## 8. Xử lý sự cố

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

### Viewer không tải ảnh

- Kiểm tra `pKey` trong URL có đúng image ID không
- Thử đổi sang image ID khác
- Mở Console (F12) xem lỗi cụ thể

### Không chạy được server

```bash
# Cách 1: Python
python -m http.server 8000

# Cách 2: Python3 (Linux/Mac)
python3 -m http.server 8000

# Cách 3: Node.js
npx serve . -p 8000

# Cách 4: VS Code extension "Live Server"
# Cài extension → Right-click index.html → "Open with Live Server"
```

### Lỗi CORS

- KHÔNG mở file bằng `file://` (double-click)
- PHẢI chạy qua `http://localhost:xxxx`

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

import { useEffect, useMemo, useState } from 'react';

const API_ROOT = 'http://localhost:3000';
const API_BASE = `${API_ROOT}/api/v1`;

const mockUploads = [
  {
    id: 'UP-2401',
    name: 'duong-nguyen-luong-bang.mp4',
    type: 'Video',
    location: 'Nguyễn Lương Bằng, Đà Nẵng',
    capturedAt: '2026-04-30 08:42',
    uploadedAt: '2026-04-30 09:05',
    status: 'processing',
    progress: 68,
  },
  {
    id: 'UP-2398',
    name: 'hoa-minh-sidewalk.jpg',
    type: 'Image',
    location: 'Hòa Minh, Liên Chiểu',
    capturedAt: '2026-04-29 16:18',
    uploadedAt: '2026-04-29 16:22',
    status: 'ready',
    progress: 100,
  },
  {
    id: 'UP-2391',
    name: 'bien-bao-truong-chinh.mov',
    type: 'Video',
    location: 'Trường Chinh, Thanh Khê',
    capturedAt: '2026-04-28 11:10',
    uploadedAt: '2026-04-28 11:24',
    status: 'failed',
    progress: 42,
  },
];

const pipeline = [
  { label: 'Uploaded', count: 38, tone: 'blue' },
  { label: 'Metadata', count: 31, tone: 'green' },
  { label: 'Geocoded', count: 28, tone: 'green' },
  { label: 'Thumbnails', count: 25, tone: 'green' },
  { label: 'AI captions', count: 19, tone: 'amber' },
  { label: 'Ready', count: 17, tone: 'green' },
];

function formatNumber(value) {
  if (value === undefined || value === null) return '—';
  return new Intl.NumberFormat('vi-VN').format(value);
}

function statusLabel(status) {
  return {
    ready: 'Sẵn sàng',
    processing: 'Đang xử lý',
    failed: 'Lỗi xử lý',
  }[status] || status;
}

export function Dashboard() {
  const [stats, setStats] = useState(null);
  const [images, setImages] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboardData() {
      try {
        const statsRes = await fetch(`${API_BASE}/stats`);
        const statsJson = await statsRes.json();
        const bounds = statsJson.bounds || {
          min_lon: 107.9,
          min_lat: 15.95,
          max_lon: 108.35,
          max_lat: 16.15,
        };
        const bbox = `${bounds.min_lon},${bounds.min_lat},${bounds.max_lon},${bounds.max_lat}`;
        const imagesRes = await fetch(`${API_BASE}/images?bbox=${bbox}&limit=8`);
        const imagesJson = await imagesRes.json();
        const firstImage = imagesJson.data?.[0];
        let analysisJson = null;

        if (firstImage?.provider_image_id) {
          const analysisRes = await fetch(`${API_BASE}/images/provider/${firstImage.provider_image_id}/analysis`);
          analysisJson = await analysisRes.json();
        }

        if (!cancelled) {
          setStats(statsJson);
          setImages(imagesJson.data || []);
          setAnalysis(analysisJson?.data || null);
        }
      } catch {
        if (!cancelled) {
          setStats(null);
          setImages([]);
          setAnalysis(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDashboardData();
    return () => {
      cancelled = true;
    };
  }, []);

  const kpis = useMemo(() => [
    { label: 'Tổng ảnh', value: formatNumber(stats?.images), hint: 'Ảnh đã lưu trong hệ thống' },
    { label: 'Sequences', value: formatNumber(stats?.sequences), hint: 'Tuyến ảnh đã gom nhóm' },
    { label: 'Tiles crawled', value: formatNumber(stats?.tiles_crawled), hint: 'Tile đã thu thập' },
    { label: 'Đối tượng', value: formatNumber(stats?.map_features?.point), hint: 'Map features dạng point' },
    { label: 'Biển báo', value: formatNumber(stats?.map_features?.traffic_sign), hint: 'Traffic signs phát hiện' },
    { label: 'Upload chờ', value: '21', hint: 'Mock pipeline upload' },
  ], [stats]);

  return (
    <main className="dashboard-shell">
      <section className="dashboard-hero">
        <div>
          <div className="dashboard-kicker">BVTK Mapper Operations</div>
          <h1>Dashboard dữ liệu ảnh đường phố</h1>
          <p>
            Theo dõi coverage, upload ảnh/video, pipeline xử lý AI và chất lượng dữ liệu bản đồ
            trong một màn hình điều phối duy nhất.
          </p>
        </div>
        <div className="dashboard-actions">
          <button className="dashboard-primary-btn" type="button">Upload ảnh/video</button>
        </div>
      </section>

      <section className="dashboard-kpis">
        {kpis.map((item) => (
          <article className="dashboard-card kpi-card" key={item.label}>
            <span>{item.label}</span>
            <strong>{loading ? '...' : item.value}</strong>
            <small>{item.hint}</small>
          </article>
        ))}
      </section>

      <section className="dashboard-grid">
        <article className="dashboard-card coverage-card">
          <div className="section-heading">
            <span>Coverage Health</span>
            <strong>Vùng dữ liệu</strong>
          </div>
          <div className="coverage-map-preview">
            <div className="coverage-orbit orbit-one"></div>
            <div className="coverage-orbit orbit-two"></div>
            <div className="coverage-road road-one"></div>
            <div className="coverage-road road-two"></div>
            <div className="coverage-node node-one"></div>
            <div className="coverage-node node-two"></div>
            <div className="coverage-node node-three"></div>
          </div>
          <div className="bounds-list">
            <span>Min lat: {stats?.bounds?.min_lat ?? '—'}</span>
            <span>Max lat: {stats?.bounds?.max_lat ?? '—'}</span>
            <span>Min lon: {stats?.bounds?.min_lon ?? '—'}</span>
            <span>Max lon: {stats?.bounds?.max_lon ?? '—'}</span>
          </div>
        </article>

        <article className="dashboard-card upload-card">
          <div className="section-heading">
            <span>Upload Intelligence</span>
            <strong>Ảnh/video gần đây</strong>
          </div>
          <div className="upload-list">
            {mockUploads.map((upload) => (
              <div className="upload-row" key={upload.id}>
                <div className={`upload-thumb ${upload.status}`}>{upload.type.slice(0, 1)}</div>
                <div>
                  <strong>{upload.name}</strong>
                  <span>{upload.location}</span>
                  <small>Chụp: {upload.capturedAt} · Upload: {upload.uploadedAt}</small>
                </div>
                <div className="upload-status">
                  <b className={upload.status}>{statusLabel(upload.status)}</b>
                  <i style={{ '--progress': `${upload.progress}%` }}></i>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="dashboard-card pipeline-card">
          <div className="section-heading">
            <span>Processing Pipeline</span>
            <strong>Trạng thái xử lý</strong>
          </div>
          <div className="pipeline-track">
            {pipeline.map((step, index) => (
              <div className="pipeline-step" key={step.label}>
                <div className={`pipeline-dot ${step.tone}`}>{index + 1}</div>
                <span>{step.label}</span>
                <strong>{step.count}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="dashboard-card insight-card">
          <div className="section-heading">
            <span>AI Insight</span>
            <strong>Caption mới nhất</strong>
          </div>
          <div className="insight-stack">
            {['scene_text', 'road_text', 'vehicle_text', 'sign_text', 'safety_text'].map((field) => (
              <p key={field}>{analysis?.[field] || 'Chưa có dữ liệu phân tích cho mục này.'}</p>
            ))}
          </div>
        </article>

        <article className="dashboard-card recent-card">
          <div className="section-heading">
            <span>Recent Images</span>
            <strong>Ảnh mẫu từ hệ thống</strong>
          </div>
          <div className="recent-grid">
            {images.slice(0, 6).map((image) => (
              <div className="recent-image" key={image.provider_image_id}>
                {image.thumb_256_url ? (
                  <img src={`${API_ROOT}${image.thumb_256_url}`} alt={`Ảnh ${image.provider_image_id}`} />
                ) : (
                  <span>No thumb</span>
                )}
                <small>{new Date(image.captured_at).toLocaleDateString('vi-VN')}</small>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}

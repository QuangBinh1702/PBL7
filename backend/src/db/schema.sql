-- ====== EXTENSIONS ======
CREATE EXTENSION IF NOT EXISTS postgis;

-- ====== CRAWL JOBS ======
CREATE TABLE IF NOT EXISTS crawl_jobs (
  id            BIGSERIAL PRIMARY KEY,
  tile_key      TEXT NOT NULL,                -- '14/13456/7890'
  source        TEXT NOT NULL DEFAULT 'mapillary',
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending/running/done/failed
  images_found  INT DEFAULT 0,
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  UNIQUE(tile_key, source)
);

-- ====== SEQUENCES ======
CREATE TABLE IF NOT EXISTS sequences (
  id                    BIGSERIAL PRIMARY KEY,
  provider              TEXT NOT NULL DEFAULT 'mapillary',
  provider_sequence_id  TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_sequence_id)
);

-- ====== IMAGES ======
CREATE TABLE IF NOT EXISTS images (
  id                  BIGSERIAL PRIMARY KEY,
  provider            TEXT NOT NULL DEFAULT 'mapillary',
  provider_image_id   TEXT NOT NULL,
  sequence_id         BIGINT REFERENCES sequences(id),
  geom                GEOMETRY(Point, 4326) NOT NULL,
  lat                 DOUBLE PRECISION NOT NULL,
  lon                 DOUBLE PRECISION NOT NULL,
  captured_at         TIMESTAMPTZ,
  compass_angle       REAL,
  is_pano             BOOLEAN DEFAULT false,
  status              TEXT NOT NULL DEFAULT 'metadata_only',  -- metadata_only/downloaded/processed/ready
  tile_key            TEXT,                    -- which tile discovered this image
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_image_id)
);

-- ====== INDEXES ======
CREATE INDEX IF NOT EXISTS images_geom_gist ON images USING GIST (geom);
CREATE INDEX IF NOT EXISTS images_captured_at_idx ON images (captured_at);
CREATE INDEX IF NOT EXISTS images_status_idx ON images (status);
CREATE INDEX IF NOT EXISTS images_sequence_idx ON images (sequence_id);
CREATE INDEX IF NOT EXISTS images_tile_key_idx ON images (tile_key);
CREATE INDEX IF NOT EXISTS crawl_jobs_status_idx ON crawl_jobs (status);

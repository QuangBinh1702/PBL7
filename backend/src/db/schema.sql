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

-- ====== MAP FEATURES (points + traffic signs) ======
CREATE TABLE IF NOT EXISTS map_features (
  id                   BIGSERIAL PRIMARY KEY,
  provider             TEXT NOT NULL DEFAULT 'mapillary',
  provider_feature_id  TEXT NOT NULL,
  feature_kind         TEXT NOT NULL CHECK (feature_kind IN ('point', 'traffic_sign')),
  value                TEXT NOT NULL,
  geom                 GEOMETRY(Point, 4326) NOT NULL,
  lat                  DOUBLE PRECISION NOT NULL,
  lon                  DOUBLE PRECISION NOT NULL,
  first_seen_at        TIMESTAMPTZ,
  last_seen_at         TIMESTAMPTZ,
  tile_key             TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_feature_id)
);

CREATE INDEX IF NOT EXISTS map_features_geom_gist ON map_features USING GIST (geom);
CREATE INDEX IF NOT EXISTS map_features_kind_idx ON map_features (feature_kind);
CREATE INDEX IF NOT EXISTS map_features_value_idx ON map_features (value);
CREATE INDEX IF NOT EXISTS map_features_tile_key_idx ON map_features (tile_key);

-- ====== DETECTION CACHE ======
CREATE TABLE IF NOT EXISTS map_feature_detection_cache (
  provider_feature_id  TEXT PRIMARY KEY,
  detections_json      JSONB NOT NULL,
  fetched_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add width/height to images for detection panel bbox calculation
DO $$ BEGIN
  ALTER TABLE images ADD COLUMN IF NOT EXISTS width INT;
  ALTER TABLE images ADD COLUMN IF NOT EXISTS height INT;
EXCEPTION WHEN others THEN NULL;
END $$;

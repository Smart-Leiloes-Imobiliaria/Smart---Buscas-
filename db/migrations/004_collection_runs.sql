ALTER TABLE property ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE property ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE property ADD COLUMN IF NOT EXISTS zone TEXT;
ALTER TABLE property ADD COLUMN IF NOT EXISTS street TEXT;
ALTER TABLE property ADD COLUMN IF NOT EXISTS street_number TEXT;
ALTER TABLE property ADD COLUMN IF NOT EXISTS suites INTEGER;
ALTER TABLE property ADD COLUMN IF NOT EXISTS total_area_m2 DOUBLE PRECISION;
ALTER TABLE property ADD COLUMN IF NOT EXISTS amenities JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE property ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE listing ADD COLUMN IF NOT EXISTS yearly_iptu NUMERIC(14, 2);
ALTER TABLE listing ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE listing ADD COLUMN IF NOT EXISTS inactive_at TIMESTAMPTZ;
ALTER TABLE listing ADD COLUMN IF NOT EXISTS inactive_reason TEXT;

CREATE TABLE collection_scope (
    id BIGSERIAL PRIMARY KEY,
    source_code TEXT NOT NULL REFERENCES source(code),
    scope_key TEXT NOT NULL,
    criteria JSONB NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_code, scope_key)
);

CREATE TABLE collection_run (
    id UUID PRIMARY KEY,
    scope_id BIGINT NOT NULL REFERENCES collection_scope(id),
    run_type TEXT NOT NULL CHECK (run_type IN ('FULL', 'INCREMENTAL')),
    status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'PARTIAL', 'SUSPECT', 'FAILED')),
    parser_status TEXT NOT NULL DEFAULT 'OK',
    pages_processed INTEGER NOT NULL DEFAULT 0,
    listings_found INTEGER NOT NULL DEFAULT 0,
    previous_healthy_count INTEGER,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMPTZ
);

CREATE TABLE listing_scope_presence (
    listing_id TEXT NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
    scope_id BIGINT NOT NULL REFERENCES collection_scope(id) ON DELETE CASCADE,
    last_seen_run_id UUID REFERENCES collection_run(id),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    consecutive_misses INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'STALE', 'INACTIVE')),
    inactive_at TIMESTAMPTZ,
    PRIMARY KEY(listing_id, scope_id)
);

CREATE INDEX idx_collection_run_scope_started
ON collection_run(scope_id, started_at DESC);

CREATE INDEX idx_listing_scope_presence_status
ON listing_scope_presence(scope_id, status, last_seen_at);

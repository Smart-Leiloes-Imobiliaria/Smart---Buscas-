CREATE TABLE source (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    discovery_method TEXT NOT NULL,
    fetch_method TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 50,
    max_results INTEGER NOT NULL DEFAULT 50,
    status TEXT NOT NULL DEFAULT 'HEALTHY',
    last_sync_at TIMESTAMPTZ
);

CREATE TABLE property (
    id TEXT PRIMARY KEY,
    property_type TEXT NOT NULL,
    transaction_type TEXT NOT NULL DEFAULT 'SALE',
    city TEXT NOT NULL,
    neighborhood TEXT NOT NULL,
    normalized_address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    area_m2 DOUBLE PRECISION,
    bedrooms INTEGER,
    bathrooms INTEGER,
    parking_spaces INTEGER,
    description TEXT,
    image_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE listing (
    id TEXT PRIMARY KEY,
    property_id TEXT NOT NULL REFERENCES property(id),
    source_code TEXT NOT NULL REFERENCES source(code),
    external_id TEXT NOT NULL,
    url TEXT NOT NULL,
    price NUMERIC(14, 2),
    condo_fee NUMERIC(14, 2),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_code, external_id)
);

CREATE TABLE raw_listing_snapshot (
    id BIGSERIAL PRIMARY KEY,
    source_code TEXT NOT NULL REFERENCES source(code),
    external_id TEXT NOT NULL,
    url TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    payload JSONB NOT NULL
);

CREATE TABLE listing_snapshot (
    id BIGSERIAL PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listing(id),
    price NUMERIC(14, 2),
    condo_fee NUMERIC(14, 2),
    active BOOLEAN NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE property_event (
    id BIGSERIAL PRIMARY KEY,
    property_id TEXT NOT NULL REFERENCES property(id),
    event_type TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE search (
    id TEXT PRIMARY KEY,
    criteria JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'RUNNING',
    cached_count INTEGER NOT NULL DEFAULT 0,
    discovered_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMPTZ
);

CREATE TABLE search_result (
    search_id TEXT NOT NULL REFERENCES search(id),
    property_id TEXT NOT NULL REFERENCES property(id),
    score INTEGER NOT NULL,
    reasons JSONB NOT NULL,
    PRIMARY KEY(search_id, property_id)
);

CREATE TABLE favorite (
    id BIGSERIAL PRIMARY KEY,
    property_id TEXT NOT NULL UNIQUE REFERENCES property(id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE review_queue (
    id BIGSERIAL PRIMARY KEY,
    review_type TEXT NOT NULL,
    property_id TEXT REFERENCES property(id),
    candidate_property_id TEXT REFERENCES property(id),
    match_score INTEGER,
    details JSONB,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE job (
    id BIGSERIAL PRIMARY KEY,
    job_type TEXT NOT NULL,
    source_code TEXT REFERENCES source(code),
    status TEXT NOT NULL,
    processed_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMPTZ
);

CREATE INDEX idx_property_location ON property(city, neighborhood);
CREATE INDEX idx_listing_property ON listing(property_id);
CREATE INDEX idx_snapshot_listing ON listing_snapshot(listing_id, captured_at);

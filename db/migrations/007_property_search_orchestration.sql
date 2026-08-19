CREATE TABLE property_searches (
    id UUID PRIMARY KEY,
    search_key TEXT NOT NULL,
    criteria JSONB NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    neighborhood TEXT,
    transaction TEXT NOT NULL CHECK (transaction IN ('SALE', 'RENT')),
    property_type TEXT,
    min_price NUMERIC,
    max_price NUMERIC,
    bedrooms INTEGER,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
    properties_found INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    collector_version TEXT NOT NULL DEFAULT 'vivareal-v1',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE property_search_results (
    search_id UUID NOT NULL REFERENCES property_searches(id) ON DELETE CASCADE,
    property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (search_id, property_id)
);

CREATE UNIQUE INDEX idx_property_searches_active_key
ON property_searches (search_key)
WHERE status IN ('PENDING', 'RUNNING');

CREATE INDEX idx_property_searches_completed_key
ON property_searches (search_key, completed_at DESC)
WHERE status = 'COMPLETED';

CREATE INDEX idx_property_searches_queue
ON property_searches (status, created_at)
WHERE status = 'PENDING';

CREATE INDEX idx_property_search_results_property
ON property_search_results (property_id);

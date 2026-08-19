CREATE TABLE search_index_outbox (
    id BIGSERIAL PRIMARY KEY,
    document_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload JSONB,
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMPTZ
);

CREATE INDEX idx_search_index_outbox_pending
ON search_index_outbox(status, created_at);

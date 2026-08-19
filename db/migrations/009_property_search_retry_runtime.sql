ALTER TABLE property_searches
ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

ALTER TABLE property_searches
ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_property_searches_retry_queue
ON property_searches (COALESCE(next_attempt_at, created_at), created_at)
WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_property_searches_running_heartbeat
ON property_searches (COALESCE(last_heartbeat_at, updated_at, started_at))
WHERE status = 'RUNNING';

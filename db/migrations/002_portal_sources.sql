-- Remove a antiga fonte experimental e seus dados dependentes, caso a migração
-- anterior tenha sido aplicada em uma instalação existente.
CREATE TABLE migration_removed_source_property (
    property_id TEXT PRIMARY KEY
);
INSERT INTO migration_removed_source_property(property_id)
SELECT DISTINCT property_id FROM listing WHERE source_code = 'mercadolivre';

DELETE FROM listing_snapshot
WHERE listing_id IN (SELECT id FROM listing WHERE source_code = 'mercadolivre');

DELETE FROM raw_listing_snapshot WHERE source_code = 'mercadolivre';
DELETE FROM job WHERE source_code = 'mercadolivre';
DELETE FROM listing WHERE source_code = 'mercadolivre';

DELETE FROM search_result
WHERE property_id IN (
  SELECT property_id FROM migration_removed_source_property
  WHERE property_id NOT IN (SELECT property_id FROM listing)
);
DELETE FROM favorite
WHERE property_id IN (
  SELECT property_id FROM migration_removed_source_property
  WHERE property_id NOT IN (SELECT property_id FROM listing)
);
DELETE FROM review_queue
WHERE property_id IN (
  SELECT property_id FROM migration_removed_source_property
  WHERE property_id NOT IN (SELECT property_id FROM listing)
)
OR candidate_property_id IN (
  SELECT property_id FROM migration_removed_source_property
  WHERE property_id NOT IN (SELECT property_id FROM listing)
);
DELETE FROM property_event
WHERE property_id IN (
  SELECT property_id FROM migration_removed_source_property
  WHERE property_id NOT IN (SELECT property_id FROM listing)
);
DELETE FROM property
WHERE id IN (SELECT property_id FROM migration_removed_source_property)
  AND id NOT IN (SELECT property_id FROM listing);
DELETE FROM source WHERE code = 'mercadolivre';
DROP TABLE migration_removed_source_property;

UPDATE source
SET discovery_method = 'PORTAL_ADAPTER',
    fetch_method = 'AUTHORIZED_GATEWAY',
    status = 'DEMO'
WHERE code IN ('zap', 'vivareal', 'imovelweb');

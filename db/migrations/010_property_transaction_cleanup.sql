UPDATE properties
SET rental_price = COALESCE(rental_price, sale_price),
    sale_price = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE url LIKE '%-aluguel-%';

UPDATE properties
SET sale_price = COALESCE(sale_price, rental_price),
    rental_price = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE url LIKE '%-venda-%';

DELETE FROM property_search_results
WHERE search_id IN (
    SELECT id FROM property_searches WHERE transaction = 'SALE'
  )
  AND property_id IN (
    SELECT id FROM properties WHERE url LIKE '%-aluguel-%'
  );

DELETE FROM property_search_results
WHERE search_id IN (
    SELECT id FROM property_searches WHERE transaction = 'RENT'
  )
  AND property_id IN (
    SELECT id FROM properties WHERE url LIKE '%-venda-%'
  );

UPDATE property_searches
SET properties_found = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'COMPLETED';

UPDATE property_searches
SET properties_found = result_count.total,
    updated_at = CURRENT_TIMESTAMP
FROM (
  SELECT search_id, COUNT(*) AS total
  FROM property_search_results
  GROUP BY search_id
) AS result_count
WHERE property_searches.id = result_count.search_id
  AND property_searches.status = 'COMPLETED';

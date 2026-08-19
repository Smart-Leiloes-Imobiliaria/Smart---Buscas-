import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import type { SearchCriteria } from "@/lib/schemas";
import { rank } from "@/lib/services/ranking";
import {
  processSearchIndexOutbox,
  searchIndexedPropertyIds,
  searchIndexEnabled,
} from "@/lib/services/search-index";
import type { PropertyRow } from "@/lib/types";

export async function createSearch(database: Pool, criteria: SearchCriteria) {
  const searchId = `SRCH-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  await database.query("INSERT INTO search(id, criteria) VALUES ($1, $2)", [
    searchId,
    JSON.stringify(criteria),
  ]);

  const cachedResult = await database.query<{ id: string }>(
    "SELECT id FROM property WHERE lower(city)=lower($1)",
    [criteria.city],
  );
  const cachedIds = new Set(cachedResult.rows.map((row) => row.id));
  const touched = new Set(cachedIds);
  const discoveredCount = 0;

  let indexedCount = 0;
  let indexSync = { processed: 0, completed: 0, failed: 0 };
  if (searchIndexEnabled()) {
    try {
      indexSync = await processSearchIndexOutbox(database);
      const indexedPropertyIds = await searchIndexedPropertyIds(criteria);
      indexedCount = indexedPropertyIds.length;
      indexedPropertyIds.forEach((propertyId) => touched.add(propertyId));
    } catch (error) {
      console.error("Smart-Buscas indisponível; usando PostgreSQL", error);
    }
  }

  for (const propertyId of touched) {
    const propertyResult = await database.query<PropertyRow>(
      `SELECT p.*, prices.price
       FROM property p
       JOIN (
         SELECT property_id, MIN(price)::double precision AS price
         FROM listing WHERE active=TRUE GROUP BY property_id
       ) prices ON prices.property_id=p.id
       WHERE p.id=$1`,
      [propertyId],
    );
    const item = propertyResult.rows[0];
    if (!item || !matches(item, criteria)) continue;
    const ranked = rank(item, criteria);
    await database.query(
      `INSERT INTO search_result(search_id, property_id, score, reasons)
       VALUES ($1, $2, $3, $4)`,
      [searchId, propertyId, ranked.score, JSON.stringify(ranked.reasons)],
    );
  }

  const countResult = await database.query<{ total: number }>(
    "SELECT COUNT(*)::int AS total FROM search_result WHERE search_id=$1",
    [searchId],
  );
  await database.query(
    `UPDATE search SET status='COMPLETED', cached_count=$1, discovered_count=$2,
     finished_at=CURRENT_TIMESTAMP WHERE id=$3`,
    [cachedIds.size, discoveredCount, searchId],
  );
  return {
    search_id: searchId,
    status: "COMPLETED",
    result_count: countResult.rows[0].total,
    cached_count: cachedIds.size,
    discovered_count: discoveredCount,
    indexed_count: indexedCount,
    index_sync: indexSync,
  };
}

function matches(item: PropertyRow, criteria: SearchCriteria) {
  if (item.city.toLowerCase() !== criteria.city.toLowerCase()) return false;
  if (item.transaction_type !== criteria.transaction) return false;
  if (criteria.property_type && item.property_type !== criteria.property_type) return false;
  if (criteria.price_min != null && (item.price ?? 0) < criteria.price_min) return false;
  if (criteria.price_max != null && (item.price ?? 0) > criteria.price_max) return false;
  if (criteria.area_min != null && (item.area_m2 ?? 0) < criteria.area_min) return false;
  if (criteria.bedrooms_min != null && (item.bedrooms ?? 0) < criteria.bedrooms_min) return false;
  if (criteria.parking_spaces_min != null && (item.parking_spaces ?? 0) < criteria.parking_spaces_min) return false;
  return !criteria.neighborhoods.length || criteria.neighborhoods.some(
    (value) => value.toLowerCase() === item.neighborhood.toLowerCase(),
  );
}

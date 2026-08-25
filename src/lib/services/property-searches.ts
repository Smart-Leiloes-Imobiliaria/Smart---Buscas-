import { createHash, randomUUID } from "node:crypto";

import type { SqlExecutor } from "@/lib/db";
import { withTransaction } from "@/lib/db";
import {
  getProperties,
  serializeCollectorProperty,
} from "@/lib/properties";
import type { PropertySearchRequest } from "@/lib/schemas";
import type {
  CollectorProperty,
  CollectorPropertyRow,
  PropertySearchRow,
} from "@/lib/types";

const collectorVersion = "multi-portal-v9";

const normalizedText = (value: string | undefined) =>
  value
    ?.trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export function normalizePropertySearch(
  criteria: PropertySearchRequest,
): PropertySearchRequest {
  return {
    city: criteria.city.trim(),
    state: criteria.state.trim().toUpperCase(),
    neighborhood: criteria.neighborhood?.trim() || undefined,
    transaction: criteria.transaction,
    propertyType: criteria.propertyType?.trim().toUpperCase() || undefined,
    minPrice: criteria.minPrice,
    maxPrice: criteria.maxPrice,
    minArea: criteria.minArea,
    maxArea: criteria.maxArea,
    bedrooms: criteria.bedrooms,
  };
}

export function propertySearchKey(criteria: PropertySearchRequest) {
  const canonical = {
    collectorVersion,
    city: normalizedText(criteria.city),
    state: normalizedText(criteria.state),
    neighborhood: normalizedText(criteria.neighborhood) ?? null,
    transaction: criteria.transaction,
    propertyType: criteria.propertyType ?? null,
    minPrice: criteria.minPrice ?? null,
    maxPrice: criteria.maxPrice ?? null,
    minArea: criteria.minArea ?? null,
    maxArea: criteria.maxArea ?? null,
    bedrooms: criteria.bedrooms ?? null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export async function createPropertySearch(criteria: PropertySearchRequest) {
  const normalized = normalizePropertySearch(criteria);
  const searchKey = propertySearchKey(normalized);
  const cacheMinutes = Math.max(
    0,
    Number(process.env.PROPERTY_SEARCH_CACHE_MINUTES ?? 10),
  );
  const cacheCutoff = new Date(Date.now() - cacheMinutes * 60_000);

  return withTransaction(async (database) => {
    await database.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `property-search-${searchKey}`,
    ]);
    const active = await database.query<PropertySearchRow>(
      `SELECT * FROM property_searches
       WHERE search_key=$1 AND status IN ('PENDING', 'RUNNING')
       ORDER BY created_at DESC LIMIT 1`,
      [searchKey],
    );
    if (active.rows[0]) {
      return {
        search: serializePropertySearch(active.rows[0]),
        created: false,
        cacheHit: false,
      };
    }

    const cached = await database.query<PropertySearchRow>(
      `SELECT * FROM property_searches
       WHERE search_key=$1 AND status='COMPLETED'
         AND completed_at >= $2
       ORDER BY completed_at DESC LIMIT 1`,
      [searchKey, cacheCutoff],
    );
    if (cached.rows[0]) {
      return {
        search: serializePropertySearch(cached.rows[0]),
        created: false,
        cacheHit: true,
      };
    }

    const id = randomUUID();
    const inserted = await database.query<PropertySearchRow>(
        `INSERT INTO property_searches (
          id, search_key, criteria, city, state, neighborhood, transaction,
          property_type, min_price, max_price, min_area, max_area, bedrooms,
          collector_version
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
        )
        RETURNING *`,
        [
          id,
          searchKey,
          JSON.stringify(normalized),
          normalized.city,
          normalized.state,
          normalized.neighborhood ?? null,
          normalized.transaction,
          normalized.propertyType ?? null,
          normalized.minPrice ?? null,
          normalized.maxPrice ?? null,
          normalized.minArea ?? null,
          normalized.maxArea ?? null,
          normalized.bedrooms ?? null,
          collectorVersion,
        ],
    );
    return {
      search: serializePropertySearch(inserted.rows[0]),
      created: true,
      cacheHit: false,
    };
  });
}

export async function findPropertySearch(
  database: SqlExecutor,
  searchId: string,
) {
  const result = await database.query<PropertySearchRow>(
    "SELECT * FROM property_searches WHERE id=$1",
    [searchId],
  );
  return result.rows[0]
    ? serializePropertySearch(result.rows[0])
    : undefined;
}

export async function propertySearchProperties(
  database: SqlExecutor,
  search: ReturnType<typeof serializePropertySearch>,
): Promise<{ properties: CollectorProperty[]; cached: boolean }> {
  if (search.status === "COMPLETED") {
    const result = await database.query<CollectorPropertyRow>(
      `SELECT properties.*
       FROM property_search_results
       JOIN properties ON properties.id=property_search_results.property_id
       WHERE property_search_results.search_id=$1
       ORDER BY properties.updated_at DESC
       LIMIT 100`,
      [search.id],
    );
    const collected = result.rows.map((row) =>
      serializeCollectorProperty(row, search.transaction),
    );
    const stored = await getProperties(
      {
        city: search.city,
        state: search.state,
        neighborhood: search.neighborhood ?? undefined,
        transaction: search.transaction,
        propertyType: search.propertyType ?? undefined,
        minPrice: search.minPrice ?? undefined,
        maxPrice: search.maxPrice ?? undefined,
        minArea: search.minArea ?? undefined,
        maxArea: search.maxArea ?? undefined,
        bedrooms: search.bedrooms ?? undefined,
        limit: 100,
      },
      database,
    );
    const merged = new Map<number, CollectorProperty>();
    for (const property of collected) merged.set(property.id, property);
    for (const property of stored.properties) {
      if (!merged.has(property.id)) merged.set(property.id, property);
    }

    return {
      properties: [...merged.values()],
      cached: false,
    };
  }

  const existing = await getProperties(
    {
      city: search.city,
      state: search.state,
      neighborhood: search.neighborhood ?? undefined,
      transaction: search.transaction,
      propertyType: search.propertyType ?? undefined,
      minPrice: search.minPrice ?? undefined,
      maxPrice: search.maxPrice ?? undefined,
      minArea: search.minArea ?? undefined,
      maxArea: search.maxArea ?? undefined,
      bedrooms: search.bedrooms ?? undefined,
      limit: 100,
    },
    database,
  );
  return { properties: existing.properties, cached: true };
}

const numberOrNull = (value: number | string | null) =>
  value == null ? null : Number(value);

const isoOrNull = (value: Date | string | null) =>
  value == null ? null : new Date(value).toISOString();

function serializePropertySearch(row: PropertySearchRow) {
  return {
    id: row.id,
    city: row.city,
    state: row.state,
    neighborhood: row.neighborhood,
    transaction: row.transaction,
    propertyType: row.property_type,
    minPrice: numberOrNull(row.min_price),
    maxPrice: numberOrNull(row.max_price),
    minArea: numberOrNull(row.min_area),
    maxArea: numberOrNull(row.max_area),
    bedrooms: row.bedrooms,
    status: row.status,
    propertiesFound: Number(row.properties_found),
    attempts: Number(row.attempts),
    error: row.error_message,
    createdAt: isoOrNull(row.created_at)!,
    startedAt: isoOrNull(row.started_at),
    completedAt: isoOrNull(row.completed_at),
    updatedAt: isoOrNull(row.updated_at)!,
  };
}

export type PropertySearch = ReturnType<typeof serializePropertySearch>;

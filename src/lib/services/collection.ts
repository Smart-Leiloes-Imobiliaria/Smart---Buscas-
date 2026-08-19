import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type { PublicPageScopeConfig, PublicPageSourceConfig } from "@/lib/collection/config";
import { PublicPageCollector } from "@/lib/collection/public-pages";
import { ingest } from "@/lib/services/ingestion";
import { enqueueSearchProperty, listingToSearchPropertyDocument } from "@/lib/services/search-index";
import type { NormalizedListing } from "@/lib/types";

export type CollectionRunResult = {
  runId: string;
  status: "COMPLETED" | "PARTIAL" | "SUSPECT" | "FAILED";
  pagesProcessed: number;
  listingsFound: number;
  inactivated: number;
  error?: string;
};

export async function runPublicPageCollection(
  database: Pool,
  source: PublicPageSourceConfig,
  scope: PublicPageScopeConfig,
  options: {
    userAgent: string;
    contact: string;
    runType?: "FULL" | "INCREMENTAL";
    missThreshold?: number;
    inactiveAfterHours?: number;
    fetch?: typeof fetch;
  },
): Promise<CollectionRunResult> {
  const runType = options.runType ?? "FULL";
  const runId = randomUUID();
  const scopeId = await ensureScope(database, source.code, scope);
  await database.query(
    `UPDATE source SET discovery_method='PUBLIC_PAGE', fetch_method='HTTP_HTML'
     WHERE code=$1`,
    [source.code],
  );
  const previousCount = await previousHealthyCount(database, scopeId);
  await database.query(
    `INSERT INTO collection_run(id, scope_id, run_type, status, previous_healthy_count)
     VALUES ($1, $2, $3, 'RUNNING', $4)`,
    [runId, scopeId, runType, previousCount],
  );

  let pagesProcessed = 0;
  let listingsFound = 0;
  try {
    const collector = new PublicPageCollector(
      source,
      options.userAgent,
      options.contact,
      options.fetch,
    );
    const batch = await collector.collect(scope);
    pagesProcessed = batch.pagesProcessed;

    for (const page of batch.pages) {
      for (let index = 0; index < page.items.length; index += 1) {
        const normalized = page.items[index];
        const raw = { ...page.rawItems[index], _collectionPage: page.url };
        const client = await database.connect();
        try {
          await client.query("BEGIN");
          const result = await ingest(client, source.code, raw, normalized);
          await markSeen(client, result.listingId, scopeId, runId);
          await client.query("COMMIT");
          listingsFound += 1;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
    }

    const suspicious = previousCount != null
      && previousCount >= source.minimumBaselineForDropDetection
      && listingsFound < previousCount * (1 - source.suspiciousDropRatio);
    const status = suspicious ? "SUSPECT" : batch.complete ? "COMPLETED" : "PARTIAL";
    let inactivated = 0;
    if (status === "COMPLETED" && runType === "FULL") {
      inactivated = await applyAbsences(
        database,
        scopeId,
        runId,
        options.missThreshold ?? Number(process.env.COLLECTOR_MISS_THRESHOLD ?? 3),
        options.inactiveAfterHours ?? Number(process.env.COLLECTOR_INACTIVE_AFTER_HOURS ?? 36),
      );
    }
    await finishRun(database, runId, status, pagesProcessed, listingsFound, suspicious ? "VOLUME_DROP" : "OK");
    await database.query(
      `UPDATE source SET status=$1, last_sync_at=CURRENT_TIMESTAMP WHERE code=$2`,
      [status === "COMPLETED" ? "HEALTHY" : "DEGRADED", source.code],
    );
    return { runId, status, pagesProcessed, listingsFound, inactivated };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await database.query(
      `UPDATE collection_run SET status='FAILED', parser_status='ERROR',
       pages_processed=$1, listings_found=$2, error_message=$3,
       finished_at=CURRENT_TIMESTAMP WHERE id=$4`,
      [pagesProcessed, listingsFound, message.slice(0, 2_000), runId],
    );
    await database.query("UPDATE source SET status='DEGRADED' WHERE code=$1", [source.code]);
    return { runId, status: "FAILED", pagesProcessed, listingsFound, inactivated: 0, error: message };
  }
}

async function ensureScope(database: Pool, sourceCode: string, scope: PublicPageScopeConfig) {
  const result = await database.query<{ id: number }>(
    `INSERT INTO collection_scope(source_code, scope_key, criteria)
     VALUES ($1, $2, $3)
     ON CONFLICT(source_code, scope_key) DO UPDATE SET
       criteria=EXCLUDED.criteria, updated_at=CURRENT_TIMESTAMP
     RETURNING id`,
    [sourceCode, scope.key, JSON.stringify({
      city: scope.city,
      state: scope.state,
      neighborhoods: scope.neighborhoods,
      transaction: scope.transaction,
      propertyType: scope.propertyType,
    })],
  );
  return result.rows[0].id;
}

async function previousHealthyCount(database: Pool, scopeId: number) {
  const result = await database.query<{ listings_found: number }>(
    `SELECT listings_found FROM collection_run
     WHERE scope_id=$1 AND status='COMPLETED'
     ORDER BY started_at DESC LIMIT 1`,
    [scopeId],
  );
  return result.rows[0]?.listings_found ?? null;
}

async function markSeen(client: PoolClient, listingId: string, scopeId: number, runId: string) {
  await client.query(
    `INSERT INTO listing_scope_presence
      (listing_id, scope_id, last_seen_run_id, last_seen_at, consecutive_misses, status)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP, 0, 'ACTIVE')
     ON CONFLICT(listing_id, scope_id) DO UPDATE SET
       last_seen_run_id=EXCLUDED.last_seen_run_id,
       last_seen_at=CURRENT_TIMESTAMP, consecutive_misses=0,
       status='ACTIVE', inactive_at=NULL`,
    [listingId, scopeId, runId],
  );
}

async function applyAbsences(
  database: Pool,
  scopeId: number,
  runId: string,
  missThreshold: number,
  inactiveAfterHours: number,
) {
  const client = await database.connect();
  const newlyInactive: Array<{ listing_id: string; property_id: string }> = [];
  let globallyInactivated = 0;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`collection-scope-${scopeId}`]);
    const missing = await client.query<{
      listing_id: string;
      property_id: string;
      consecutive_misses: number;
      last_seen_at: Date;
      status: string;
    }>(
      `SELECT presence.listing_id, listing.property_id, presence.consecutive_misses,
        presence.last_seen_at, presence.status
       FROM listing_scope_presence presence
       JOIN listing ON listing.id=presence.listing_id
       WHERE presence.scope_id=$1
         AND (presence.last_seen_run_id IS NULL OR presence.last_seen_run_id<>$2)`,
      [scopeId, runId],
    );
    const cutoff = Date.now() - inactiveAfterHours * 60 * 60 * 1_000;
    for (const row of missing.rows) {
      const misses = row.consecutive_misses + 1;
      const inactive = misses >= missThreshold && new Date(row.last_seen_at).getTime() <= cutoff;
      const status = inactive ? "INACTIVE" : "STALE";
      await client.query(
        `UPDATE listing_scope_presence SET consecutive_misses=$1, status=$2,
         inactive_at=CASE WHEN $2='INACTIVE' THEN COALESCE(inactive_at, CURRENT_TIMESTAMP) ELSE NULL END
         WHERE listing_id=$3 AND scope_id=$4`,
        [misses, status, row.listing_id, scopeId],
      );
      globallyInactivated += 1;
      if (inactive && row.status !== "INACTIVE") newlyInactive.push(row);
    }

    for (const row of newlyInactive) {
      const remaining = await client.query(
        `SELECT 1 FROM listing_scope_presence
         WHERE listing_id=$1 AND status<>'INACTIVE' LIMIT 1`,
        [row.listing_id],
      );
      if (remaining.rowCount) continue;
      await client.query(
        `UPDATE listing SET active=FALSE, inactive_at=CURRENT_TIMESTAMP,
         inactive_reason='MISSING_FROM_HEALTHY_FULL_RUNS' WHERE id=$1`,
        [row.listing_id],
      );
      await client.query(
        `INSERT INTO property_event(property_id, event_type, old_value, new_value)
         VALUES ($1, 'LISTING_INACTIVATED', 'ACTIVE', 'INACTIVE')`,
        [row.property_id],
      );
      const stored = await storedNormalizedListing(client, row.listing_id);
      if (stored) {
        await enqueueSearchProperty(
          client,
          listingToSearchPropertyDocument(stored.listing, stored.propertyId, new Date().toISOString(), "INACTIVE"),
        );
      }
    }
    await client.query("COMMIT");
    return globallyInactivated;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function storedNormalizedListing(client: PoolClient, listingId: string) {
  const result = await client.query<Record<string, unknown>>(
    `SELECT l.external_id, l.source_code, l.url, l.price::double precision AS price,
      l.condo_fee::double precision AS condo_fee,
      l.yearly_iptu::double precision AS yearly_iptu, p.*
     FROM listing l JOIN property p ON p.id=l.property_id WHERE l.id=$1`,
    [listingId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    propertyId: String(row.id),
    listing: {
      source_code: String(row.source_code), external_id: String(row.external_id), url: String(row.url),
      title: row.title == null ? null : String(row.title), property_type: String(row.property_type),
      transaction_type: row.transaction_type === "RENT" ? "RENT" as const : "SALE" as const,
      city: String(row.city), state: row.state == null ? null : String(row.state),
      neighborhood: String(row.neighborhood), zone: row.zone == null ? null : String(row.zone),
      street: row.street == null ? null : String(row.street), street_number: row.street_number == null ? null : String(row.street_number),
      normalized_address: row.normalized_address == null ? null : String(row.normalized_address),
      latitude: numberOrNull(row.latitude), longitude: numberOrNull(row.longitude),
      area_m2: numberOrNull(row.area_m2), total_area_m2: numberOrNull(row.total_area_m2),
      bedrooms: numberOrNull(row.bedrooms), bathrooms: numberOrNull(row.bathrooms),
      suites: numberOrNull(row.suites), parking_spaces: numberOrNull(row.parking_spaces),
      amenities: Array.isArray(row.amenities) ? row.amenities.map(String) : [],
      image_urls: Array.isArray(row.image_urls) ? row.image_urls.map(String) : [],
      image_url: row.image_url == null ? null : String(row.image_url),
      description: row.description == null ? null : String(row.description),
      price: Number(row.price), condo_fee: Number(row.condo_fee ?? 0), yearly_iptu: numberOrNull(row.yearly_iptu),
    } satisfies NormalizedListing,
  };
}

async function finishRun(
  database: Pool,
  runId: string,
  status: "COMPLETED" | "PARTIAL" | "SUSPECT",
  pages: number,
  listings: number,
  parserStatus: string,
) {
  await database.query(
    `UPDATE collection_run SET status=$1, parser_status=$2, pages_processed=$3,
     listings_found=$4, finished_at=CURRENT_TIMESTAMP WHERE id=$5`,
    [status, parserStatus, pages, listings, runId],
  );
}

const numberOrNull = (value: unknown) => value == null ? null : Number(value);

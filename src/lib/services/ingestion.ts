import { randomUUID } from "node:crypto";

import { config } from "@/lib/config";
import type { SqlExecutor } from "@/lib/db";
import {
  enqueueSearchProperty,
  listingToSearchPropertyDocument,
} from "@/lib/services/search-index";
import type { NormalizedListing, PropertyRow } from "@/lib/types";

const id = (prefix: string) =>
  `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;

const tokens = (value: string | null | undefined) =>
  new Set((value ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? []);

const sameSet = (left: Set<string>, right: Set<string>) =>
  left.size === right.size && [...left].every((value) => right.has(value));

export function similarity(existing: PropertyRow, candidate: NormalizedListing) {
  let score = 0;
  if (existing.normalized_address === candidate.normalized_address) score += 65;
  else if (sameSet(tokens(existing.normalized_address), tokens(candidate.normalized_address))) score += 55;
  if (existing.neighborhood.toLowerCase() === candidate.neighborhood.toLowerCase()) score += 8;
  if (Math.abs((existing.area_m2 ?? 0) - (candidate.area_m2 ?? 0)) <= 3) score += 12;
  if (existing.bedrooms === candidate.bedrooms) score += 8;
  if (existing.parking_spaces === candidate.parking_spaces) score += 7;
  return Math.min(score, 100);
}

export async function ingest(
  database: SqlExecutor,
  sourceCode: string,
  raw: Record<string, unknown>,
  normalized: NormalizedListing,
): Promise<{ propertyId: string; listingId: string; created: boolean }> {
  await database.query(
    "INSERT INTO raw_listing_snapshot(source_code, external_id, url, payload) VALUES ($1, $2, $3, $4)",
    [sourceCode, normalized.external_id, normalized.url, JSON.stringify(raw)],
  );

  const existingResult = await database.query<{
    id: string;
    property_id: string;
    price: number;
    active: boolean;
  }>(
    "SELECT id, property_id, price, active FROM listing WHERE source_code=$1 AND external_id=$2",
    [sourceCode, normalized.external_id],
  );
  const existingListing = existingResult.rows[0];
  if (existingListing) {
    if (existingListing.price !== normalized.price) {
      await database.query(
        `INSERT INTO property_event(property_id, event_type, old_value, new_value)
         VALUES ($1, 'PRICE_CHANGED', $2, $3)`,
        [existingListing.property_id, existingListing.price, normalized.price],
      );
    }
    if (!existingListing.active) {
      await database.query(
        `INSERT INTO property_event(property_id, event_type, old_value, new_value)
         VALUES ($1, 'LISTING_REACTIVATED', 'INACTIVE', 'ACTIVE')`,
        [existingListing.property_id],
      );
    }
    await database.query(
      `UPDATE listing SET url=$1, price=$2, condo_fee=$3, yearly_iptu=$4,
       active=TRUE, captured_at=CURRENT_TIMESTAMP, last_seen_at=CURRENT_TIMESTAMP,
       inactive_at=NULL, inactive_reason=NULL WHERE id=$5`,
      [normalized.url, normalized.price, normalized.condo_fee,
       normalized.yearly_iptu ?? null, existingListing.id],
    );
    await updateProperty(database, existingListing.property_id, normalized);
    await database.query(
      `INSERT INTO listing_snapshot(listing_id, price, condo_fee, active)
       VALUES ($1, $2, $3, TRUE)`,
      [existingListing.id, normalized.price, normalized.condo_fee],
    );
    await enqueueSearchProperty(
      database,
      listingToSearchPropertyDocument(normalized, existingListing.property_id),
    );
    return { propertyId: existingListing.property_id, listingId: existingListing.id, created: false };
  }

  const candidatesResult = await database.query<PropertyRow>(
    "SELECT * FROM property WHERE lower(city)=lower($1) AND lower(neighborhood)=lower($2)",
    [normalized.city, normalized.neighborhood],
  );
  let bestProperty: PropertyRow | undefined;
  let bestScore = 0;
  for (const candidate of candidatesResult.rows) {
    const score = similarity(candidate, normalized);
    if (score > bestScore) {
      bestScore = score;
      bestProperty = candidate;
    }
  }

  const created = bestScore < config.deduplication.automaticMatchMin;
  let propertyId: string;
  if (created) {
    propertyId = id("PROP");
    await database.query(
      `INSERT INTO property(id, title, property_type, transaction_type, city, state,
        neighborhood, zone, street, street_number, normalized_address, latitude,
        longitude, area_m2, total_area_m2, bedrooms, bathrooms, suites,
        parking_spaces, amenities, image_urls, description, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`,
      [
        propertyId,
        normalized.title ?? null,
        normalized.property_type,
        normalized.transaction_type,
        normalized.city,
        normalized.state ?? null,
        normalized.neighborhood,
        normalized.zone ?? null,
        normalized.street ?? null,
        normalized.street_number ?? null,
        normalized.normalized_address,
        normalized.latitude,
        normalized.longitude,
        normalized.area_m2,
        normalized.total_area_m2 ?? null,
        normalized.bedrooms,
        normalized.bathrooms,
        normalized.suites ?? null,
        normalized.parking_spaces,
        JSON.stringify(normalized.amenities ?? []),
        JSON.stringify(normalized.image_urls ?? []),
        normalized.description,
        normalized.image_url,
      ],
    );
    if (bestProperty && bestScore >= config.deduplication.manualReviewMin) {
      await database.query(
        `INSERT INTO review_queue
          (review_type, property_id, candidate_property_id, match_score, details)
         VALUES ('POSSIBLE_DUPLICATE', $1, $2, $3, $4)`,
        [
          propertyId,
          bestProperty.id,
          bestScore,
          JSON.stringify({ address: normalized.normalized_address }),
        ],
      );
    }
  } else {
    propertyId = bestProperty!.id;
    await updateProperty(database, propertyId, normalized);
  }

  const listingId = id("LIST");
  await database.query(
    `INSERT INTO listing(id, property_id, source_code, external_id, url, price,
      condo_fee, yearly_iptu)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      listingId,
      propertyId,
      sourceCode,
      normalized.external_id,
      normalized.url,
      normalized.price,
      normalized.condo_fee,
      normalized.yearly_iptu ?? null,
    ],
  );
  await database.query(
    `INSERT INTO listing_snapshot(listing_id, price, condo_fee, active)
     VALUES ($1, $2, $3, TRUE)`,
    [listingId, normalized.price, normalized.condo_fee],
  );
  await enqueueSearchProperty(
    database,
    listingToSearchPropertyDocument(normalized, propertyId),
  );
  return { propertyId, listingId, created };
}

async function updateProperty(
  database: SqlExecutor,
  propertyId: string,
  normalized: NormalizedListing,
) {
  await database.query(
    `UPDATE property SET
      title=COALESCE($1, title), property_type=$2, transaction_type=$3,
      city=$4, state=COALESCE($5, state), neighborhood=$6,
      zone=COALESCE($7, zone), street=COALESCE($8, street),
      street_number=COALESCE($9, street_number), normalized_address=$10,
      latitude=COALESCE($11, latitude), longitude=COALESCE($12, longitude),
      area_m2=COALESCE($13, area_m2), total_area_m2=COALESCE($14, total_area_m2),
      bedrooms=COALESCE($15, bedrooms), bathrooms=COALESCE($16, bathrooms),
      suites=COALESCE($17, suites), parking_spaces=COALESCE($18, parking_spaces),
      amenities=$19, image_urls=$20, description=COALESCE($21, description),
      image_url=COALESCE($22, image_url), updated_at=CURRENT_TIMESTAMP
     WHERE id=$23`,
    [
      normalized.title ?? null,
      normalized.property_type,
      normalized.transaction_type,
      normalized.city,
      normalized.state ?? null,
      normalized.neighborhood,
      normalized.zone ?? null,
      normalized.street ?? null,
      normalized.street_number ?? null,
      normalized.normalized_address,
      normalized.latitude,
      normalized.longitude,
      normalized.area_m2,
      normalized.total_area_m2 ?? null,
      normalized.bedrooms,
      normalized.bathrooms,
      normalized.suites ?? null,
      normalized.parking_spaces,
      JSON.stringify(normalized.amenities ?? []),
      JSON.stringify(normalized.image_urls ?? []),
      normalized.description,
      normalized.image_url,
      propertyId,
    ],
  );
}

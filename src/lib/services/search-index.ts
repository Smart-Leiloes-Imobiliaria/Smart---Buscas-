import {
  DiscoveryEngineClient,
  type DiscoveryEngineSettings,
} from "@/lib/search/discovery-engine";
import {
  createSearchPropertyDocument,
  searchPropertyDocumentSchema,
  type SearchPropertyDocument,
} from "@/lib/search/property-document";
import type { SearchCriteria } from "@/lib/schemas";
import type { SqlExecutor } from "@/lib/db";
import type { NormalizedListing } from "@/lib/types";

let client: DiscoveryEngineClient | undefined;

export async function indexSearchProperty(document: SearchPropertyDocument) {
  return searchIndexClient().upsertProperty(document);
}

export async function removeSearchProperty(documentId: string) {
  return searchIndexClient().deleteProperty(documentId);
}

export async function updateSearchPropertySchema() {
  return searchIndexClient().updatePropertySchema();
}

export function searchIndexEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return (
    environment.SEARCH_INDEX_ENABLED === "true" &&
    Boolean(environment.GOOGLE_CLOUD_PROJECT && environment.DISCOVERY_ENGINE_DATA_STORE_ID)
  );
}

export function listingToSearchPropertyDocument(
  listing: NormalizedListing,
  propertyId: string,
  updatedAt = new Date().toISOString(),
  status: SearchPropertyDocument["status"] = "ACTIVE",
) {
  const location =
    listing.latitude != null && listing.longitude != null
      ? { latitude: listing.latitude, longitude: listing.longitude }
      : undefined;
  const transactionTypes = [listing.transaction_type];

  return createSearchPropertyDocument({
    source: listing.source_code,
    sourceListingId: listing.external_id,
    propertyId,
    title: listing.title ?? `${propertyTypeLabel(listing.property_type)} em ${listing.neighborhood}, ${listing.city}`,
    description: listing.description ?? undefined,
    propertyType: listing.property_type,
    transactionTypes,
    salePrice: listing.transaction_type === "SALE" ? listing.price : undefined,
    rentalPrice: listing.transaction_type === "RENT" ? listing.price : undefined,
    condoFee: listing.condo_fee,
    city: listing.city,
    state: listing.state ?? undefined,
    neighborhood: listing.neighborhood,
    zone: listing.zone ?? undefined,
    street: listing.street ?? listing.normalized_address ?? undefined,
    streetNumber: listing.street_number ?? undefined,
    location,
    bedrooms: listing.bedrooms ?? undefined,
    bathrooms: listing.bathrooms ?? undefined,
    suites: listing.suites ?? undefined,
    parkingSpaces: listing.parking_spaces ?? undefined,
    usableArea: listing.area_m2 ?? undefined,
    totalArea: listing.total_area_m2 ?? undefined,
    amenities: listing.amenities ?? [],
    imageUrl: listing.image_url ?? undefined,
    url: listing.url,
    status,
    updatedAt,
  });
}

export async function enqueueSearchProperty(
  database: SqlExecutor,
  document: SearchPropertyDocument,
) {
  await database.query(
    `DELETE FROM search_index_outbox
     WHERE document_id=$1 AND operation='UPSERT' AND status IN ('PENDING', 'FAILED')`,
    [document.id],
  );
  await database.query(
    `INSERT INTO search_index_outbox(document_id, operation, payload)
     VALUES ($1, 'UPSERT', $2)`,
    [document.id, JSON.stringify(document)],
  );
}

export async function processSearchIndexOutbox(
  database: SqlExecutor,
  limit = 50,
  indexClient = searchIndexClient(),
) {
  const pending = await database.query<{
    id: number;
    document_id: string;
    operation: "UPSERT" | "DELETE";
    payload: unknown;
  }>(
    `SELECT id, document_id, operation, payload
     FROM search_index_outbox
     WHERE status IN ('PENDING', 'FAILED') AND attempts < 5
     ORDER BY created_at LIMIT $1`,
    [limit],
  );
  let completed = 0;
  let failed = 0;

  for (const item of pending.rows) {
    try {
      if (item.operation === "DELETE") {
        await indexClient.deleteProperty(item.document_id);
      } else {
        await indexClient.upsertProperty(searchPropertyDocumentSchema.parse(item.payload));
      }
      await database.query(
        `UPDATE search_index_outbox SET status='COMPLETED', attempts=attempts+1,
         last_error=NULL, processed_at=CURRENT_TIMESTAMP WHERE id=$1`,
        [item.id],
      );
      completed += 1;
    } catch (error) {
      await database.query(
        `UPDATE search_index_outbox SET status='FAILED', attempts=attempts+1,
         last_error=$1 WHERE id=$2`,
        [error instanceof Error ? error.message.slice(0, 2_000) : String(error), item.id],
      );
      failed += 1;
    }
  }
  return { processed: pending.rows.length, completed, failed };
}

export async function searchIndexedPropertyIds(criteria: SearchCriteria) {
  const response = await searchIndexClient().searchProperties(criteria);
  return [...new Set(
    (response.results ?? [])
      .map((result) => result.document?.structData?.propertyId)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  )];
}

export function setSearchIndexClientForTests(testClient?: DiscoveryEngineClient) {
  client = testClient;
}

function searchIndexClient(settings?: DiscoveryEngineSettings) {
  client ??= new DiscoveryEngineClient(settings);
  return client;
}

const propertyTypeLabel = (value: string) => {
  const labels: Record<string, string> = {
    APARTMENT: "Apartamento",
    HOME: "Casa",
    HOUSE: "Casa",
    PENTHOUSE: "Cobertura",
    LAND: "Terreno",
  };
  return labels[value.toUpperCase()] ?? "Imóvel";
};

import { db, type SqlExecutor } from "@/lib/db";
import type { CollectorPropertyFilters } from "@/lib/schemas";
import type {
  CollectorProperty,
  CollectorPropertyRow,
  PropertyRow,
} from "@/lib/types";

export type GetPropertiesOptions = Partial<CollectorPropertyFilters>;

export type GetPropertiesResult = {
  properties: CollectorProperty[];
  total: number;
  limit: number;
  offset: number;
};

const numberOrNull = (value: number | string | null) => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isoOrNull = (value: Date | string | null) => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const imageUrls = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
};

export function serializeCollectorProperty(
  row: CollectorPropertyRow,
  transaction: "SALE" | "RENT",
): CollectorProperty {
  const salePrice = numberOrNull(row.sale_price);
  const rentalPrice = numberOrNull(row.rental_price);
  return {
    ...row,
    sale_price: salePrice,
    rental_price: rentalPrice,
    price: transaction === "RENT" ? rentalPrice : salePrice,
    transaction,
    usable_area: numberOrNull(row.usable_area),
    total_area: numberOrNull(row.total_area),
    condominium_fee: numberOrNull(row.condominium_fee),
    iptu: numberOrNull(row.iptu),
    image_urls: imageUrls(row.image_urls),
    sourceUrl: row.url,
    date_posted: isoOrNull(row.date_posted),
    first_seen_at: isoOrNull(row.first_seen_at)!,
    last_seen_at: isoOrNull(row.last_seen_at)!,
    created_at: isoOrNull(row.created_at)!,
    updated_at: isoOrNull(row.updated_at)!,
  };
}

export async function getProperties(
  options: GetPropertiesOptions = {},
  executor?: SqlExecutor,
): Promise<GetPropertiesResult> {
  const database = executor ?? (await db());
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 100);
  const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
  const transaction = options.transaction ?? "SALE";
  const clauses = ["status = $1"];
  const parameters: unknown[] = ["ACTIVE"];

  const parameter = (value: unknown) => {
    parameters.push(value);
    return `$${parameters.length}`;
  };

  if (transaction === "RENT") {
    clauses.push("rental_price IS NOT NULL");
  } else {
    clauses.push("(sale_price IS NOT NULL OR rental_price IS NULL)");
  }
  if (options.city) {
    clauses.push(`lower(city) = lower(${parameter(options.city)})`);
  }
  if (options.state) {
    clauses.push(`lower(state) = lower(${parameter(options.state)})`);
  }
  if (options.neighborhood) {
    clauses.push(
      `lower(neighborhood) = lower(${parameter(options.neighborhood)})`,
    );
  }
  if (options.propertyType) {
    clauses.push(
      `lower(property_type) = lower(${parameter(options.propertyType)})`,
    );
  }
  if (options.bedrooms != null) {
    clauses.push(`bedrooms >= ${parameter(options.bedrooms)}`);
  }
  if (options.minArea != null) {
    clauses.push(`usable_area >= ${parameter(options.minArea)}`);
  }
  if (options.maxArea != null) {
    clauses.push(`usable_area <= ${parameter(options.maxArea)}`);
  }

  const priceColumn = transaction === "RENT" ? "rental_price" : "sale_price";
  if (options.minPrice != null) {
    clauses.push(`${priceColumn} >= ${parameter(options.minPrice)}`);
  }
  if (options.maxPrice != null) {
    clauses.push(`${priceColumn} <= ${parameter(options.maxPrice)}`);
  }

  const where = `WHERE ${clauses.join(" AND ")}`;
  const countParameters = [...parameters];
  const listParameters = [...parameters, limit, offset];
  const [countResult, propertiesResult] = await Promise.all([
    database.query<{ total: number | string }>(
      `SELECT COUNT(*) AS total FROM properties ${where}`,
      countParameters,
    ),
    database.query<CollectorPropertyRow>(
      `SELECT * FROM properties ${where}
       ORDER BY updated_at DESC
       LIMIT $${parameters.length + 1} OFFSET $${parameters.length + 2}`,
      listParameters,
    ),
  ]);

  return {
    properties: propertiesResult.rows.map((row) =>
      serializeCollectorProperty(row, transaction),
    ),
    total: Number(countResult.rows[0]?.total ?? 0),
    limit,
    offset,
  };
}

export function propertyQuery(where = "", order = "p.updated_at DESC") {
  return `SELECT p.*, listings.price, listings.condo_fee,
    listings.source_count, listings.sources,
    (favorite.property_id IS NOT NULL) AS favorite
    FROM property p
    JOIN (
      SELECT property_id,
        MIN(price)::double precision AS price,
        MIN(condo_fee)::double precision AS condo_fee,
        COUNT(DISTINCT source_code)::int AS source_count,
        ARRAY_AGG(DISTINCT source_code) AS sources
      FROM listing WHERE active=TRUE GROUP BY property_id
    ) listings ON listings.property_id=p.id
    LEFT JOIN favorite ON favorite.property_id=p.id
    ${where} ORDER BY ${order}`;
}

export function serializeProperty(row: PropertyRow) {
  return {
    ...row,
    sources:
      typeof row.sources === "string"
        ? row.sources.split(",").filter(Boolean)
        : (row.sources ?? []),
    favorite: Boolean(row.favorite),
  };
}

export async function findProperty(database: SqlExecutor, propertyId: string) {
  const propertyResult = await database.query<PropertyRow>(
    propertyQuery("WHERE p.id=$1"),
    [propertyId],
  );
  const row = propertyResult.rows[0];
  if (!row) return undefined;
  const [listings, history, events] = await Promise.all([
    database.query(
      `SELECT l.*, l.price::double precision AS price,
        l.condo_fee::double precision AS condo_fee, s.name AS source_name
       FROM listing l JOIN source s ON s.code=l.source_code
       WHERE l.property_id=$1 ORDER BY l.price`,
      [propertyId],
    ),
    database.query(
      `SELECT ls.price::double precision AS price,
        ls.condo_fee::double precision AS condo_fee, ls.captured_at, l.source_code
       FROM listing_snapshot ls JOIN listing l ON l.id=ls.listing_id
       WHERE l.property_id=$1 ORDER BY ls.captured_at DESC LIMIT 30`,
      [propertyId],
    ),
    database.query(
      "SELECT * FROM property_event WHERE property_id=$1 ORDER BY created_at DESC",
      [propertyId],
    ),
  ]);
  return {
    ...serializeProperty(row),
    listings: listings.rows,
    history: history.rows,
    events: events.rows,
  };
}

import { NextResponse } from "next/server";

import { ApiError, apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { legacyPropertyToCardData } from "@/lib/property-card-data";
import type { PropertyRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const database = await db();
    const searchResult = await database.query<Record<string, unknown> & { criteria: unknown }>(
      "SELECT * FROM search WHERE id=$1",
      [id],
    );
    const search = searchResult.rows[0];
    if (!search) throw new ApiError(404, "Busca não encontrada");
    const rowsResult = await database.query<PropertyRow>(
        `SELECT p.*, listings.price, listings.condo_fee,
          listings.source_count, listings.sources,
          sr.score match_score, sr.reasons,
          (favorite.property_id IS NOT NULL) favorite
         FROM search_result sr JOIN property p ON p.id=sr.property_id
         JOIN (
           SELECT property_id,
             MIN(price)::double precision AS price,
             MIN(condo_fee)::double precision AS condo_fee,
             COUNT(DISTINCT source_code)::int AS source_count,
             ARRAY_AGG(DISTINCT source_code) AS sources
           FROM listing WHERE active=TRUE GROUP BY property_id
         ) listings ON listings.property_id=p.id
         LEFT JOIN favorite ON favorite.property_id=p.id
         WHERE sr.search_id=$1 ORDER BY sr.score DESC, listings.price ASC`,
      [id],
    );
    return NextResponse.json({
      ...search,
      criteria: search.criteria,
      items: rowsResult.rows.map(legacyPropertyToCardData),
    });
  } catch (error) {
    return apiError(error);
  }
}

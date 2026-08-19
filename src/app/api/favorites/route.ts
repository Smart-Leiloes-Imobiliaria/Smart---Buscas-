import { NextResponse } from "next/server";

import { ApiError, apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { legacyPropertyToCardData } from "@/lib/property-card-data";
import { propertyQuery } from "@/lib/properties";
import { favoriteInputSchema } from "@/lib/schemas";
import type { PropertyRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await (await db()).query<PropertyRow>(
      propertyQuery("WHERE favorite.property_id IS NOT NULL"),
    );
    return NextResponse.json({
      items: rows.rows.map(legacyPropertyToCardData),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = favoriteInputSchema.parse(await request.json());
    const database = await db();
    const exists = await database.query("SELECT id FROM property WHERE id=$1", [payload.property_id]);
    if (!exists.rowCount) throw new ApiError(404, "Imóvel não encontrado");
    await database.query(
      `INSERT INTO favorite(property_id, notes) VALUES ($1, $2)
       ON CONFLICT(property_id) DO UPDATE SET notes=excluded.notes`,
      [payload.property_id, payload.notes ?? null],
    );
    return NextResponse.json({ favorite: true }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

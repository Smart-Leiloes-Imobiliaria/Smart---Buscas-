import { NextRequest, NextResponse } from "next/server";

import { getProperties } from "@/lib/properties";
import { collectorPropertyFiltersSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const parsed = collectorPropertyFiltersSchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: parsed.error.issues[0]?.message ?? "Filtros inválidos",
        },
        { status: 400 },
      );
    }

    const result = await getProperties(parsed.data);
    return NextResponse.json({
      ok: true,
      count: result.properties.length,
      total: result.total,
      properties: result.properties,
      pagination: {
        limit: result.limit,
        offset: result.offset,
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { ok: false, error: "Erro ao buscar imóveis" },
      { status: 500 },
    );
  }
}

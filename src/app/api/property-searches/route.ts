import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { findMunicipality } from "@/lib/ibge-cities";
import { propertySearchRequestSchema } from "@/lib/schemas";
import {
  dispatchPropertySearch,
  propertySearchDispatchMode,
} from "@/lib/services/property-search-dispatch";
import { createPropertySearch } from "@/lib/services/property-searches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const parsed = propertySearchRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: parsed.error.issues[0]?.message ?? "Pesquisa inválida",
        },
        { status: 400 },
      );
    }

    let municipality;
    try {
      municipality = await findMunicipality(parsed.data.state, parsed.data.city);
    } catch (error) {
      console.error(error);
      return NextResponse.json(
        { ok: false, error: "Não foi possível validar a cidade agora." },
        { status: 503 },
      );
    }
    if (!municipality) {
      return NextResponse.json(
        {
          ok: false,
          error: "Selecione uma cidade válida para o estado informado.",
        },
        { status: 400 },
      );
    }

    const result = await createPropertySearch({
      ...parsed.data,
      city: municipality.name,
    });
    let dispatchError: string | undefined;
    if (result.created) {
      try {
        await dispatchPropertySearch(result.search.id);
      } catch (error) {
        dispatchError = error instanceof Error ? error.message : String(error);
        console.error("Property search dispatch failed:", error);
        await (await db()).query(
          `UPDATE property_searches SET status='FAILED', error_message=$1,
           completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
           WHERE id=$2 AND status='PENDING'`,
          [dispatchError.slice(0, 2000), result.search.id],
        );
      }
    }

    return NextResponse.json(
      {
        ok: true,
        searchId: result.search.id,
        status: result.search.status,
        cacheHit: result.cacheHit,
        reused: !result.created,
        dispatchMode: propertySearchDispatchMode(),
        dispatchError,
      },
      { status: result.created ? 202 : 200 },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("Property search start failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Não foi possível iniciar a pesquisa",
        ...(process.env.NODE_ENV !== "production" ? { detail } : {}),
      },
      { status: 500 },
    );
  }
}

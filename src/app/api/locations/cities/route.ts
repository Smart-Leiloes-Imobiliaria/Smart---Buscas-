import { NextResponse } from "next/server";

import { isBrazilianState } from "@/lib/brazilian-states";
import { searchMunicipalities } from "@/lib/ibge-cities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const state = (searchParams.get("state") ?? "").toUpperCase();
  const query = searchParams.get("q") ?? "";

  if (!isBrazilianState(state)) {
    return NextResponse.json(
      { ok: false, error: "Selecione um estado válido." },
      { status: 400 },
    );
  }

  try {
    const cities = await searchMunicipalities(state, query);
    return NextResponse.json({ ok: true, cities });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { ok: false, error: "Não foi possível consultar os municípios." },
      { status: 503 },
    );
  }
}

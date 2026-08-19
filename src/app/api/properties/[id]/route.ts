import { NextResponse } from "next/server";

import { ApiError, apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { findProperty } from "@/lib/properties";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const property = await findProperty(await db(), id);
    if (!property) throw new ApiError(404, "Imóvel não encontrado");
    return NextResponse.json(property);
  } catch (error) {
    return apiError(error);
  }
}

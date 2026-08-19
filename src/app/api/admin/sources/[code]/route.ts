import { NextResponse } from "next/server";

import { ApiError, apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { sourceUpdateSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    const changes = sourceUpdateSchema.parse(await request.json());
    const entries = Object.entries(changes);
    const assignment = entries.map(([key], index) => `${key}=$${index + 1}`).join(", ");
    const values = entries.map(([, value]) => value);
    const result = await (await db()).query(
      `UPDATE source SET ${assignment} WHERE code=$${entries.length + 1}`,
      [...values, code],
    );
    if (!result.rowCount) throw new ApiError(404, "Fonte não encontrada");
    return NextResponse.json({ updated: true });
  } catch (error) {
    return apiError(error);
  }
}

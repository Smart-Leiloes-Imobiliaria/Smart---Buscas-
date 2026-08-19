import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await (await db()).query("DELETE FROM favorite WHERE property_id=$1", [id]);
    return NextResponse.json({ favorite: false });
  } catch (error) {
    return apiError(error);
  }
}

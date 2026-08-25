import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({
      items: (await (await db()).query("SELECT * FROM review_queue ORDER BY id DESC")).rows,
    });
  } catch (error) {
    return apiError(error);
  }
}

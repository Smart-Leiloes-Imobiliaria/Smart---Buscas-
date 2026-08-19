import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const database = await db();
    const counts: Record<string, number> = {};
    for (const table of ["source", "property", "listing", "search", "favorite", "review_queue", "job"]) {
      const result = await database.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM ${table}`);
      counts[table] = result.rows[0].total;
    }
    const pending = await database.query<{ total: number }>(
      "SELECT COUNT(*)::int AS total FROM review_queue WHERE status='PENDING'",
    );
    counts.pending_reviews = pending.rows[0].total;
    return NextResponse.json(counts);
  } catch (error) {
    return apiError(error);
  }
}

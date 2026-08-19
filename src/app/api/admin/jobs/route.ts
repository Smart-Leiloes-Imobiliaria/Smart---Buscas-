import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const database = await db();
    const [jobs, collectionRuns] = await Promise.all([
      database.query("SELECT * FROM job ORDER BY id DESC LIMIT 100"),
      database.query(
        `SELECT run.*, scope.source_code, scope.scope_key
         FROM collection_run run JOIN collection_scope scope ON scope.id=run.scope_id
         ORDER BY run.started_at DESC LIMIT 100`,
      ),
    ]);
    return NextResponse.json({
      items: jobs.rows,
      collection_runs: collectionRuns.rows,
    });
  } catch (error) {
    return apiError(error);
  }
}

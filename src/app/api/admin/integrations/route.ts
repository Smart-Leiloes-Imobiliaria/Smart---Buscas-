import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { isGatewaySource, portalSources } from "@/lib/connectors/registry";
import { requireAdmin } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { searchIndexEnabled } from "@/lib/services/search-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const indexQueue = await (await db()).query<{ status: string; total: number }>(
      `SELECT status, COUNT(*)::int AS total FROM search_index_outbox GROUP BY status`,
    );
    return NextResponse.json({
      items: portalSources.map((source) => ({
        ...source,
        configured: isGatewaySource(source.code),
        authentication: isGatewaySource(source.code)
          ? process.env.PORTAL_DATA_API_TOKEN
            ? "GATEWAY_TOKEN"
            : "GATEWAY_IAM"
          : "DEMO",
      })),
      search_index: {
        enabled: searchIndexEnabled(),
        engine: process.env.DISCOVERY_ENGINE_ENGINE_ID ?? null,
        data_store: process.env.DISCOVERY_ENGINE_DATA_STORE_ID ?? null,
        queue: Object.fromEntries(indexQueue.rows.map((row) => [row.status, row.total])),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

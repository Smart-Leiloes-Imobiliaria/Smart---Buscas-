import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { config } from "@/lib/config";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    await (await db()).query("SELECT 1");
    return NextResponse.json({
      status: "ok",
      app: config.appName,
      database: "postgresql",
    });
  } catch (error) {
    return apiError(error);
  }
}

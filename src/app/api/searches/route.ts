import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { searchCriteriaSchema } from "@/lib/schemas";
import { createSearch } from "@/lib/services/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const criteria = searchCriteriaSchema.parse(await request.json());
    return NextResponse.json(await createSearch(await db(), criteria), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

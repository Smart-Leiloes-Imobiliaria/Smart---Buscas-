import { NextResponse } from "next/server";

import { ApiError, apiError } from "@/lib/api";
import { reviewDecisionSchema } from "@/lib/schemas";
import { withTransaction } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const reviewId = Number(id);
    if (!Number.isInteger(reviewId)) throw new ApiError(422, "Revisão inválida");
    const payload = reviewDecisionSchema.parse(await request.json());
    await withTransaction(async (database) => {
      const reviewResult = await database.query<{
        property_id: string | null;
        candidate_property_id: string | null;
      }>("SELECT property_id, candidate_property_id FROM review_queue WHERE id=$1 FOR UPDATE", [reviewId]);
      const review = reviewResult.rows[0];
      if (!review) throw new ApiError(404, "Revisão não encontrada");
      if (payload.decision === "GROUP" && review.property_id && review.candidate_property_id) {
        await database.query("DELETE FROM search_result WHERE property_id=$1", [review.property_id]);
        await database.query("DELETE FROM favorite WHERE property_id=$1", [review.property_id]);
        await database.query("UPDATE property_event SET property_id=$1 WHERE property_id=$2", [review.candidate_property_id, review.property_id]);
        await database.query("UPDATE listing SET property_id=$1 WHERE property_id=$2", [review.candidate_property_id, review.property_id]);
        await database.query("UPDATE review_queue SET property_id=$1 WHERE property_id=$2 AND id<>$3", [review.candidate_property_id, review.property_id, reviewId]);
        await database.query("UPDATE review_queue SET candidate_property_id=$1 WHERE candidate_property_id=$2 AND id<>$3", [review.candidate_property_id, review.property_id, reviewId]);
        await database.query("UPDATE review_queue SET property_id=$1, status='GROUPED' WHERE id=$2", [review.candidate_property_id, reviewId]);
        await database.query("DELETE FROM property WHERE id=$1", [review.property_id]);
      } else {
        await database.query("UPDATE review_queue SET status=$1 WHERE id=$2", [payload.decision === "GROUP" ? "GROUPED" : "SEPARATED", reviewId]);
      }
    });
    return NextResponse.json({ decision: payload.decision });
  } catch (error) {
    return apiError(error);
  }
}

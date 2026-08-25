import { cookies } from "next/headers";

import { sessionCookieName } from "@/lib/auth/constants";
import { verifySessionToken } from "@/lib/auth/token";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { findActiveUser } from "@/lib/auth/users";
import { ApiError } from "@/lib/api";

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const token = (await cookies()).get(sessionCookieName)?.value;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  return findActiveUser(payload.id);
}

export async function isCurrentUserAdmin() {
  return (await getCurrentUser())?.role === "ADMIN";
}

export async function requireAdmin() {
  if (!(await isCurrentUserAdmin())) throw new ApiError(403, "Acesso administrativo necessário.");
}

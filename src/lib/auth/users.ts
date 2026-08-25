import { randomUUID } from "node:crypto";

import { hashPassword, normalizeEmail, verifyPassword } from "@/lib/auth/password";
import type { AuthenticatedUser, UserRole } from "@/lib/auth/types";
import { db } from "@/lib/db";

type UserRow = AuthenticatedUser & { password_hash: string; active: boolean; created_at: string };

export async function authenticate(emailInput: string, password: string): Promise<AuthenticatedUser | null> {
  const email = normalizeEmail(emailInput);
  const result = await (await db()).query<UserRow>(
    "SELECT id, email, role, password_hash, active, created_at FROM app_user WHERE email=$1",
    [email],
  );
  const user = result.rows[0];
  if (!user || !user.active || !(await verifyPassword(password, user.password_hash))) return null;
  return { id: user.id, email: user.email, role: user.role };
}

export async function listUsers() {
  const result = await (await db()).query<Pick<UserRow, "id" | "email" | "role" | "active" | "created_at">>(
    "SELECT id, email, role, active, created_at FROM app_user ORDER BY created_at DESC",
  );
  return result.rows;
}

export async function createUser(input: { email: string; password: string; role?: UserRole }) {
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const result = await (await db()).query<AuthenticatedUser & { active: boolean; created_at: string }>(
    `INSERT INTO app_user (id, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, role, active, created_at`,
    [randomUUID(), email, passwordHash, input.role ?? "USER"],
  );
  return result.rows[0];
}

export async function findActiveUser(id: string) {
  const result = await (await db()).query<AuthenticatedUser>(
    "SELECT id, email, role FROM app_user WHERE id=$1 AND active=TRUE",
    [id],
  );
  return result.rows[0] ?? null;
}

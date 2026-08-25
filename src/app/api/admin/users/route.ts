import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { createUser, listUsers } from "@/lib/auth/users";

const createUserSchema = z.object({
  email: z.email("Informe um e-mail válido."),
  password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres."),
});

async function requireAdmin() {
  return (await getCurrentUser())?.role === "ADMIN";
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ ok: false, error: "Acesso administrativo necessário." }, { status: 403 });
  }
  return NextResponse.json({ ok: true, items: await listUsers() });
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ ok: false, error: "Acesso administrativo necessário." }, { status: 403 });
  }
  const parsed = createUserSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  try {
    const user = await createUser(parsed.data);
    return NextResponse.json({ ok: true, user }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      return NextResponse.json({ ok: false, error: "Já existe um usuário com este e-mail." }, { status: 409 });
    }
    throw error;
  }
}

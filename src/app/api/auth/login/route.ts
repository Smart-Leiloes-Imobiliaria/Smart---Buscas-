import { NextResponse } from "next/server";
import { z } from "zod";

import { sessionCookieName, sessionCookieOptions } from "@/lib/auth/constants";
import { createSessionToken } from "@/lib/auth/token";
import { authenticate } from "@/lib/auth/users";

const loginSchema = z.object({
  email: z.email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe sua senha."),
});

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) {
    return NextResponse.json({ ok: false, error: "E-mail ou senha incorretos." }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true, user });
  response.cookies.set(sessionCookieName, await createSessionToken(user), sessionCookieOptions);
  return response;
}

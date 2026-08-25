import { DataType, newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

let closeDatabaseForTests: () => Promise<void>;
let createUser: typeof import("@/lib/auth/users").createUser;
let authenticate: typeof import("@/lib/auth/users").authenticate;
let createSessionToken: typeof import("@/lib/auth/token").createSessionToken;
let verifySessionToken: typeof import("@/lib/auth/token").verifySessionToken;
let proxy: typeof import("../src/proxy").proxy;

beforeAll(async () => {
  process.env.AUTH_SESSION_SECRET = "test-auth-secret-with-enough-entropy";

  const memory = newDb();
  memory.public.registerFunction({
    name: "hashtext",
    args: [DataType.text],
    returns: DataType.integer,
    implementation: () => 1,
  });
  memory.public.registerFunction({
    name: "pg_advisory_xact_lock",
    args: [DataType.integer],
    returns: DataType.integer,
    implementation: () => 1,
  });
  const adapter = memory.adapters.createPg();
  const testPool = new adapter.Pool() as unknown as Pool;
  const databaseModule = await import("@/lib/db");
  databaseModule.setDatabasePoolForTests(testPool);
  closeDatabaseForTests = databaseModule.closeDatabaseForTests;
  createUser = (await import("@/lib/auth/users")).createUser;
  authenticate = (await import("@/lib/auth/users")).authenticate;
  createSessionToken = (await import("@/lib/auth/token")).createSessionToken;
  verifySessionToken = (await import("@/lib/auth/token")).verifySessionToken;
  proxy = (await import("../src/proxy")).proxy;

  await databaseModule.db();
});

afterAll(async () => {
  await closeDatabaseForTests?.();
});

function request(path: string, token?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: token ? { cookie: `morada_session=${token}` } : undefined,
  });
}

describe("autenticação e autorização", () => {
  it("autentica usuário ativo e rejeita senha incorreta ou conta inativa", async () => {
    const user = await createUser({
      email: "Admin@Teste.Local",
      password: "senha-segura-123",
      role: "ADMIN",
    });

    await expect(authenticate("admin@teste.local", "senha-segura-123")).resolves.toMatchObject({
      id: user.id,
      email: "admin@teste.local",
      role: "ADMIN",
    });
    await expect(authenticate("admin@teste.local", "senha-errada")).resolves.toBeNull();

    const database = await (await import("@/lib/db")).db();
    await database.query("UPDATE app_user SET active=FALSE WHERE id=$1", [user.id]);
    await expect(authenticate("admin@teste.local", "senha-segura-123")).resolves.toBeNull();
  });

  it("valida token de sessão assinado e rejeita token adulterado", async () => {
    const token = await createSessionToken({
      id: "00000000-0000-4000-8000-000000000001",
      email: "admin@teste.local",
      role: "ADMIN",
    });

    await expect(verifySessionToken(token)).resolves.toMatchObject({
      email: "admin@teste.local",
      role: "ADMIN",
    });
    await expect(verifySessionToken(`${token.slice(0, -2)}xx`)).resolves.toBeNull();
  });

  it("bloqueia rotas protegidas para anônimos e área admin para usuário comum", async () => {
    const userToken = await createSessionToken({
      id: "00000000-0000-4000-8000-000000000002",
      email: "usuario@teste.local",
      role: "USER",
    });
    const adminToken = await createSessionToken({
      id: "00000000-0000-4000-8000-000000000003",
      email: "admin@teste.local",
      role: "ADMIN",
    });

    const anonymousPage = await proxy(request("/admin/users"));
    expect(anonymousPage.status).toBe(307);
    expect(anonymousPage.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fadmin%2Fusers");

    const anonymousApi = await proxy(request("/api/admin/users"));
    expect(anonymousApi.status).toBe(401);
    await expect(anonymousApi.json()).resolves.toMatchObject({
      ok: false,
      error: "Autenticação necessária.",
    });

    const userPage = await proxy(request("/admin/users", userToken));
    expect(userPage.status).toBe(307);
    expect(userPage.headers.get("location")).toBe("http://localhost:3000/");

    const userApi = await proxy(request("/api/admin/users", userToken));
    expect(userApi.status).toBe(403);
    await expect(userApi.json()).resolves.toMatchObject({
      ok: false,
      error: "Acesso administrativo necessário.",
    });

    const adminPage = await proxy(request("/admin/users", adminToken));
    expect(adminPage.status).toBe(200);
  });
});

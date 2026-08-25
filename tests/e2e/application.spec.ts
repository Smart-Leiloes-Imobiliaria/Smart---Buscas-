import { expect, test, type Page } from "@playwright/test";

const adminEmail = "admin.e2e@morada.local";
const adminPassword = "AdminE2EPassword!123";
const userEmail = "usuario.e2e@morada.local";
const userPassword = "UserE2EPassword!123";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

async function fetchFromPage(page: Page, path: string) {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    return { status: response.status, ok: response.ok, body: await response.json() };
  }, path);
}

test("protege rotas e valida login, logout e permissões", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?next=%2F$/);
  await expect(page.getByRole("heading", { name: "Acesse sua conta" })).toBeVisible();

  const anonymousAdminApi = await request.get("/api/admin/users");
  expect(anonymousAdminApi.status()).toBe(401);
  await expect(anonymousAdminApi.json()).resolves.toMatchObject({
    ok: false,
    error: "Autenticação necessária.",
  });

  await page.getByLabel("E-mail").fill(adminEmail);
  await page.getByLabel("Senha").fill("senha-incorreta");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  await login(page, adminEmail, adminPassword);
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: /Operação/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Acessos/ })).toBeVisible();

  await page.getByRole("link", { name: /Acessos/ }).click();
  await expect(page).toHaveURL("/admin/users");
  await expect(page.getByRole("heading", { name: "Gerenciar acessos" })).toBeVisible();

  const createdEmail = `usuario.criado.${Date.now()}@morada.local`;
  await page.getByLabel("E-mail").fill(createdEmail);
  await page.getByLabel("Senha").fill("SenhaCriadaE2E!123");
  await page.getByRole("button", { name: "Criar usuário" }).click();
  await expect(page.getByText("Usuário criado e liberado para acesso.")).toBeVisible();
  await expect(page.getByText(createdEmail)).toBeVisible();

  await page.getByRole("button", { name: "Sair da conta" }).click();
  await expect(page).toHaveURL(/\/login/);

  await login(page, userEmail, userPassword);
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: /Operação/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Acessos/ })).toHaveCount(0);

  await page.goto("/admin/users");
  await expect(page).toHaveURL("/");

  const normalUserAdminApi = await fetchFromPage(page, "/api/admin/users");
  expect(normalUserAdminApi.status).toBe(403);
  expect(normalUserAdminApi.body).toMatchObject({
    ok: false,
    error: "Acesso administrativo necessário.",
  });
});

test("consulta imóveis coletados no PostgreSQL pela página e API", async ({ page, request }) => {
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  await expect(health.json()).resolves.toMatchObject({
    status: "ok",
    database: "postgresql",
  });

  await login(page, adminEmail, adminPassword);
  await expect(page).toHaveURL("/");

  const propertiesResponse = await fetchFromPage(
    page,
    "/api/properties?city=Acrel%C3%A2ndia&state=AC&transaction=SALE",
  );
  expect(propertiesResponse.ok).toBe(true);
  expect(propertiesResponse.body).toMatchObject({
    ok: true,
    count: 1,
    total: 1,
    properties: [{
      source: "E2E",
      title: "Casa coletada para teste",
      price: 650000,
      sourceUrl: "https://example.com/e2e/collector-property",
    }],
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Seu próximo endereço começa aqui." }),
  ).toBeVisible();
  await page.getByLabel("Estado").selectOption("AC");
  await page.getByLabel("Cidade").fill("Acre");
  await page.getByRole("option", { name: "Acrelândia" }).click();
  await page.getByLabel("Tipo").selectOption("HOUSE");
  await page.getByRole("button", { name: "Buscar imóveis" }).click();

  await expect(page).toHaveURL(/\/property-searches\/[0-9a-f-]+/);
  await expect(page.getByRole("heading", { name: "Busca concluída" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "1 resultado" })).toBeVisible();
  const firstCard = page.locator("article.card").first();
  await expect(firstCard).toBeVisible();
  await expect(firstCard.getByRole("heading", { name: "Casa coletada para teste" })).toBeVisible();
  const originalLink = firstCard.getByRole("link", { name: /Ver anúncio original/ });
  await expect(originalLink).toHaveAttribute("href", "https://example.com/e2e/collector-property");
  await expect(originalLink).toHaveAttribute("target", "_blank");

  await page.getByRole("link", { name: /Operação/ }).click();
  await expect(page.getByRole("heading", { name: "Operação da plataforma" })).toBeVisible();
  await expect(page.getByText("ZAP Imóveis", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Viva Real", { exact: true }).first()).toBeVisible();
});

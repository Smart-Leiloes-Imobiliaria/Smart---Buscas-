import { expect, test } from "@playwright/test";

test("consulta imóveis coletados no PostgreSQL pela página e API", async ({ page, request }) => {
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  await expect(health.json()).resolves.toMatchObject({
    status: "ok",
    database: "postgresql",
  });

  const propertiesResponse = await request.get(
    "/api/properties?city=Acrel%C3%A2ndia&state=AC&transaction=SALE",
  );
  expect(propertiesResponse.ok()).toBe(true);
  await expect(propertiesResponse.json()).resolves.toMatchObject({
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

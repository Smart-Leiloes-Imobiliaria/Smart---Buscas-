import type { Pool } from "pg";
import { DataType, newDb } from "pg-mem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectionConfigSchema } from "@/lib/collection/config";

let database: Pool;
let closeDatabaseForTests: () => Promise<void>;
let createSearch: typeof import("@/lib/services/search").createSearch;
let findProperty: typeof import("@/lib/properties").findProperty;
let seedDemoListings: typeof import("@/lib/services/demo-seed").seedDemoListings;
let createPropertySearch: typeof import("@/lib/services/property-searches").createPropertySearch;

beforeAll(async () => {
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
  createSearch = (await import("@/lib/services/search")).createSearch;
  findProperty = (await import("@/lib/properties")).findProperty;
  seedDemoListings = (await import("@/lib/services/demo-seed")).seedDemoListings;
  createPropertySearch = (await import("@/lib/services/property-searches")).createPropertySearch;
  database = await databaseModule.db();
  await seedDemoListings(database);
});

afterAll(async () => {
  await closeDatabaseForTests?.();
});

describe("fluxos essenciais com PostgreSQL", () => {
  it("inicializa o esquema e semeia as fontes", async () => {
    const result = await database.query<{ total: number }>(
      "SELECT COUNT(*)::int AS total FROM source",
    );
    expect(result.rows[0].total).toBe(8);
  });

  it("busca, consolida e ranqueia imóveis de fontes diferentes", async () => {
    const result = await createSearch(database, {
      city: "Belo Horizonte",
      neighborhoods: ["Savassi", "Funcionários"],
      transaction: "SALE",
      price_max: 900000,
      bedrooms_min: 3,
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.result_count).toBeGreaterThanOrEqual(1);
    const consolidated = await database.query<{ source_count: number }>(
      `SELECT COUNT(DISTINCT l.source_code)::int AS source_count
       FROM search_result sr JOIN listing l ON l.property_id=sr.property_id
       WHERE sr.search_id=$1 GROUP BY sr.property_id
       ORDER BY source_count DESC LIMIT 1`,
      [result.search_id],
    );
    expect(consolidated.rows[0].source_count).toBeGreaterThanOrEqual(2);
    const property = await findProperty(database, (
      await database.query<{ id: string }>(
        "SELECT property_id AS id FROM search_result WHERE search_id=$1 LIMIT 1",
        [result.search_id],
      )
    ).rows[0].id);
    expect(property?.sources.length).toBeGreaterThanOrEqual(2);
    expect(property?.listings.length).toBeGreaterThanOrEqual(2);
    const outbox = await database.query<{ total: number }>(
      "SELECT COUNT(*)::int AS total FROM search_index_outbox WHERE status='PENDING'",
    );
    expect(outbox.rows[0].total).toBeGreaterThan(0);
  });

  it("salva e remove um favorito", async () => {
    const properties = await database.query<{ id: string }>("SELECT id FROM property LIMIT 1");
    const propertyId = properties.rows[0].id;
    await database.query("INSERT INTO favorite(property_id) VALUES ($1)", [propertyId]);
    expect((await database.query("SELECT 1 FROM favorite WHERE property_id=$1", [propertyId])).rowCount).toBe(1);
    await database.query("DELETE FROM favorite WHERE property_id=$1", [propertyId]);
    expect((await database.query("SELECT 1 FROM favorite WHERE property_id=$1", [propertyId])).rowCount).toBe(0);
  });

  it("reutiliza uma pesquisa de propriedade que ainda está pendente", async () => {
    const criteria = {
      city: "Belo Horizonte",
      state: "MG",
      transaction: "SALE" as const,
      propertyType: "APARTMENT",
      bedrooms: 3,
      minArea: 80,
      maxArea: 150,
    };
    const first = await createPropertySearch(criteria);
    const repeated = await createPropertySearch(criteria);

    expect(first).toMatchObject({ created: true, cacheHit: false });
    expect(repeated).toMatchObject({ created: false, cacheHit: false });
    expect(repeated.search.id).toBe(first.search.id);
    expect(repeated.search.status).toBe("PENDING");
  });

  it("só inativa ausência após uma coleta completa e saudável", async () => {
    const { runPublicPageCollection } = await import("@/lib/services/collection");
    const config = collectionConfigSchema.parse({
      userAgent: "MoradaCollector/1.0",
      contact: "collector@example.com",
      sources: [{
        code: "zap",
        allowedHosts: ["catalogo.example"],
        requestDelayMs: 0,
        minimumBaselineForDropDetection: 10,
        scopes: [{
          key: "teste-inativacao",
          searchUrl: "https://catalogo.example/imoveis?page={page}",
          city: "Belo Horizonte",
          state: "MG",
          parser: "JSON_LD",
          maxPages: 2,
        }],
      }],
    });
    const source = config.sources[0];
    const scope = source.scopes[0];
    const listingHtml = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Product", sku: "INATIVAR-1", name: "Apartamento teste",
      url: "/imovel/inativar-1", offers: { price: 500000 },
    })}</script>`;
    const firstFetch = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { status: 200 });
      return new Response(url.includes("page=1") ? listingHtml : "", {
        status: 200, headers: { "content-type": "text/html" },
      });
    };
    const first = await runPublicPageCollection(database, source, scope, {
      userAgent: config.userAgent, contact: config.contact, fetch: firstFetch,
      missThreshold: 1, inactiveAfterHours: 0,
    });
    expect(first.status).toBe("COMPLETED");

    const emptyFetch = async (input: string | URL | Request) => {
      const url = String(input);
      return url.endsWith("/robots.txt")
        ? new Response("User-agent: *\nAllow: /", { status: 200 })
        : new Response("", { status: 200, headers: { "content-type": "text/html" } });
    };
    const second = await runPublicPageCollection(database, source, scope, {
      userAgent: config.userAgent, contact: config.contact, fetch: emptyFetch,
      missThreshold: 1, inactiveAfterHours: 0,
    });
    expect(second).toMatchObject({ status: "COMPLETED", inactivated: 1 });
    const listing = await database.query<{ active: boolean; inactive_reason: string }>(
      "SELECT active, inactive_reason FROM listing WHERE source_code='zap' AND external_id='INATIVAR-1'",
    );
    expect(listing.rows[0]).toMatchObject({
      active: false,
      inactive_reason: "MISSING_FROM_HEALTHY_FULL_RUNS",
    });
  });
});

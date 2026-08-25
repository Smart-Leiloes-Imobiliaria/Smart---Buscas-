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
let findPropertySearch: typeof import("@/lib/services/property-searches").findPropertySearch;
let propertySearchProperties: typeof import("@/lib/services/property-searches").propertySearchProperties;

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
  const propertySearches = await import("@/lib/services/property-searches");
  createPropertySearch = propertySearches.createPropertySearch;
  findPropertySearch = propertySearches.findPropertySearch;
  propertySearchProperties = propertySearches.propertySearchProperties;
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
    expect(result.rows[0].total).toBe(7);
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

  it("mantém imóveis armazenados compatíveis após a coleta concluir", async () => {
    const criteria = {
      city: "Belo Horizonte",
      state: "MG",
      transaction: "SALE" as const,
    };
    await database.query(
      `INSERT INTO properties
       (source, source_id, title, sale_price, city, state, neighborhood,
        bedrooms, usable_area, property_type, image_urls, url, status)
       VALUES
       ('TEST', 'stored-1', 'Apartamento armazenado 1', 350000, 'Belo Horizonte',
        'MG', 'Centro', 2, 70, 'APARTMENT', '[]'::jsonb, 'https://example.test/1', 'ACTIVE'),
       ('TEST', 'stored-2', 'Apartamento armazenado 2', 390000, 'Belo Horizonte',
        'MG', 'Savassi', 3, 90, 'APARTMENT', '[]'::jsonb, 'https://example.test/2', 'ACTIVE')
       ON CONFLICT (source, source_id) DO NOTHING`,
    );
    const created = await createPropertySearch(criteria);
    const compatible = await database.query<{ id: number }>(
      `SELECT id FROM properties
       WHERE status='ACTIVE' AND lower(city)=lower($1) AND lower(state)=lower($2)
       ORDER BY updated_at DESC LIMIT 2`,
      [
        criteria.city,
        criteria.state,
      ],
    );
    expect(compatible.rows.length).toBeGreaterThanOrEqual(2);
    await database.query(
      "INSERT INTO property_search_results(search_id, property_id) VALUES ($1, $2)",
      [created.search.id, compatible.rows[0].id],
    );
    await database.query(
      `UPDATE property_searches SET status='COMPLETED', properties_found=1,
       completed_at=CURRENT_TIMESTAMP WHERE id=$1`,
      [created.search.id],
    );

    const completed = await findPropertySearch(database, created.search.id);
    expect(completed?.status).toBe("COMPLETED");
    const result = await propertySearchProperties(database, completed!);

    expect(result.cached).toBe(false);
    expect(result.properties.length).toBeGreaterThan(1);
    expect(result.properties.map((property) => property.id)).toContain(
      compatible.rows[1].id,
    );
  });

  it("ranqueia imóveis do Mongo por proximidade mesmo sem match perfeito", async () => {
    const { scoreMongoProperty } = await import("@/lib/services/mongo-property-source");
    const criteria = {
      city: "Belo Horizonte",
      state: "MG",
      neighborhood: "Savassi",
      transaction: "SALE" as const,
      propertyType: "APARTMENT",
      minPrice: 600000,
      maxPrice: 900000,
      minArea: 80,
      maxArea: 140,
      bedrooms: 3,
    };

    const close = scoreMongoProperty({
      id: "mongo-1",
      title: "Apartamento na Savassi",
      imageUrl: null,
      href: "#",
      neighborhood: "Funcionários",
      city: "Belo Horizonte",
      state: "MG",
      price: 930000,
      usableArea: 78,
      bedrooms: 3,
      bathrooms: 2,
      parkingSpaces: 2,
      propertyType: "APARTMENT",
      transaction: "SALE",
      description: null,
      address: "Rua em Funcionários",
      amenities: [],
    }, criteria);
    const distant = scoreMongoProperty({
      id: "mongo-2",
      title: "Casa em outra cidade",
      imageUrl: null,
      href: "#",
      neighborhood: "Centro",
      city: "Contagem",
      state: "MG",
      price: 1500000,
      usableArea: 250,
      bedrooms: 2,
      bathrooms: 2,
      parkingSpaces: 1,
      propertyType: "HOUSE",
      transaction: "SALE",
      description: null,
      address: "Rua em Contagem",
      amenities: [],
    }, criteria);

    expect(close).toBeGreaterThan(distant);
    expect(close).toBeGreaterThanOrEqual(80);
  });

  it("calcula médias usando apenas preço e área válidos sem duplicar cards", async () => {
    const { calculatePropertyValueAverages } = await import("@/lib/property-statistics");
    const base = {
      title: "Imóvel",
      imageUrl: null,
      href: "#",
      external: true,
      neighborhood: null,
      city: "Belo Horizonte",
      state: "MG",
      bedrooms: null,
      bathrooms: null,
      parkingSpaces: null,
      sources: ["TEST"],
      favorite: false,
    };

    const averages = calculatePropertyValueAverages([
      { ...base, id: "a", price: 400000, usableArea: 80 },
      { ...base, id: "b", price: 600000, usableArea: 0 },
      { ...base, id: "b", price: 900000, usableArea: 90 },
      { ...base, id: "c", price: null, usableArea: 50 },
    ]);

    expect(averages.averagePrice).toBe(500000);
    expect(averages.priceSampleSize).toBe(2);
    expect(averages.averagePricePerSquareMeter).toBe(5000);
    expect(averages.pricePerSquareMeterSampleSize).toBe(1);
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

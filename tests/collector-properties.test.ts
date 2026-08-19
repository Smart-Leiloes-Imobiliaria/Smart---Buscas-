import { describe, expect, it, vi } from "vitest";

import type { SqlExecutor } from "@/lib/db";
import { collectorPropertyToCardData } from "@/lib/property-card-data";
import { getProperties } from "@/lib/properties";
import type { CollectorPropertyRow } from "@/lib/types";

const row: CollectorPropertyRow = {
  id: 42,
  source: "VIVAREAL",
  source_id: "123",
  title: "Apartamento no Centro",
  advertiser_name: "Imobiliária",
  description: "Descrição",
  sale_price: "750000.50",
  rental_price: null,
  city: "Belo Horizonte",
  state: "MG",
  neighborhood: "Centro",
  street: null,
  bedrooms: 3,
  bathrooms: 2,
  suites: 1,
  parking_spaces: 2,
  usable_area: "92.5",
  total_area: null,
  condominium_fee: "800",
  iptu: "250",
  property_type: "APARTMENT",
  image_url: "https://resizedimgs.vivareal.com/imagem.webp",
  image_urls: ["https://resizedimgs.vivareal.com/imagem.webp"],
  url: "https://www.vivareal.com.br/imovel/123",
  country: "BR",
  date_posted: "2026-08-17T12:00:00.000Z",
  status: "ACTIVE",
  first_seen_at: "2026-08-17T12:00:00.000Z",
  last_seen_at: "2026-08-17T12:00:00.000Z",
  created_at: "2026-08-17T12:00:00.000Z",
  updated_at: "2026-08-17T12:00:00.000Z",
};

describe("imóveis coletados", () => {
  it("usa filtros parametrizados, COUNT separado e limita a paginação", async () => {
    const query = vi.fn(async (sql: string, _parameters?: unknown[]) => ({
      rows: sql.startsWith("SELECT COUNT") ? [{ total: "1" }] : [row],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: [],
    }));
    const database = { query } as unknown as SqlExecutor;

    const result = await getProperties(
      {
        city: "Belo Horizonte",
        state: "MG",
        neighborhood: "Centro",
        transaction: "SALE",
        minPrice: 500000,
        maxPrice: 900000,
        minArea: 80,
        maxArea: 120,
        bedrooms: 3,
        propertyType: "APARTMENT",
        limit: 100000,
      },
      database,
    );

    expect(query).toHaveBeenCalledTimes(2);
    const [countSql, countParameters] = query.mock.calls[0];
    const [listSql, listParameters] = query.mock.calls[1];
    expect(countSql).not.toContain("Belo Horizonte");
    expect(countSql).toContain("lower(city) = lower($2)");
    expect(countSql).toContain("usable_area >=");
    expect(countSql).toContain("usable_area <=");
    expect(countParameters).toContain("Belo Horizonte");
    expect(countParameters).toContain(80);
    expect(countParameters).toContain(120);
    expect(listSql).toContain("ORDER BY updated_at DESC");
    expect(listParameters?.at(-2)).toBe(100);
    expect(result).toMatchObject({ total: 1, limit: 100, offset: 0 });
    expect(result.properties[0]).toMatchObject({
      price: 750000.5,
      usable_area: 92.5,
      condominium_fee: 800,
      sourceUrl: row.url,
    });
  });

  it("adapta o registro coletado para um card externo", async () => {
    const database = {
      query: vi.fn(async (sql: string, _parameters?: unknown[]) => ({
        rows: sql.startsWith("SELECT COUNT") ? [{ total: 1 }] : [row],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: [],
      })),
    } as unknown as SqlExecutor;
    const property = (await getProperties({}, database)).properties[0];

    expect(collectorPropertyToCardData(property)).toMatchObject({
      id: "collector-42",
      external: true,
      href: row.url,
      price: 750000.5,
      favorite: false,
    });
  });
});

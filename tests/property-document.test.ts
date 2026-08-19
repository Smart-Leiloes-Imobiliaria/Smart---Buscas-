import { describe, expect, it } from "vitest";

import {
  createSearchPropertyDocument,
  createSearchPropertyDocumentId,
  searchPropertyDocumentSchema,
  toDiscoveryEngineDocument,
} from "@/lib/search/property-document";

describe("SearchPropertyDocument", () => {
  it("mantém o ID legível quando a origem e o ID externo já são seguros", () => {
    expect(createSearchPropertyDocumentId("VIVAREAL", "2763318568")).toBe(
      "vivareal-2763318568",
    );
  });

  it("gera IDs determinísticos, válidos e distintos para IDs externos complexos", () => {
    const first = createSearchPropertyDocumentId("VIVA REAL", "imóvel/123");
    const repeated = createSearchPropertyDocumentId("VIVA REAL", "imóvel/123");
    const other = createSearchPropertyDocumentId("VIVA REAL", "imóvel_123");

    expect(first).toBe(repeated);
    expect(first).not.toBe(other);
    expect(first).toMatch(/^[a-z][a-z0-9-]{0,127}$/);
    expect(first.length).toBeLessThanOrEqual(128);
  });

  it("normaliza um anúncio para importação no Discovery Engine", () => {
    const document = createSearchPropertyDocument({
      source: "vivareal",
      sourceListingId: "2763318568",
      externalId: "VR-2763318568",
      sourceId: "1aa4561c-0342-3a3e-aedd-e77d7cd2a133",
      title: "Casa com paisagismo",
      description: "Casa localizada no Morumbi...",
      salePrice: 22_000_000,
      city: "São Paulo",
      state: "SP",
      neighborhood: "Morumbi",
      bedrooms: 5,
      bathrooms: 8,
      parkingSpaces: 12,
      usableArea: 1_334,
      amenities: ["pool", "BALCONY", "pool"],
      imageUrl: "https://example.com/image.webp",
      url: "https://www.vivareal.com.br/imovel/2763318568",
      updatedAt: "2026-08-13T19:20:09.100Z",
    });

    expect(document).toMatchObject({
      id: "vivareal-2763318568",
      schemaVersion: 1,
      source: "VIVAREAL",
      sourceListingId: "2763318568",
      sourceId: "1aa4561c-0342-3a3e-aedd-e77d7cd2a133",
      transactionTypes: ["SALE"],
      currency: "BRL",
      amenities: ["BALCONY", "POOL"],
      status: "ACTIVE",
    });

    const discoveryDocument = toDiscoveryEngineDocument(document);
    expect(discoveryDocument.id).toBe(document.id);
    expect(discoveryDocument.structData).not.toHaveProperty("id");
    expect(discoveryDocument.structData.title).toBe("Casa com paisagismo");
  });

  it("rejeita ID que não corresponde à origem e ao anúncio", () => {
    const document = createSearchPropertyDocument({
      source: "VIVAREAL",
      sourceListingId: "123",
      title: "Imóvel",
      salePrice: 100_000,
      url: "https://example.com/123",
      updatedAt: "2026-08-13T19:20:09.100Z",
    });

    expect(() => searchPropertyDocumentSchema.parse({ ...document, id: "zap-123" })).toThrow(
      /ID inconsistente/,
    );
  });
});

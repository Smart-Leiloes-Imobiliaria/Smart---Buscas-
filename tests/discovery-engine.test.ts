import { describe, expect, it, vi } from "vitest";

import {
  DiscoveryEngineClient,
  DiscoveryEngineError,
  propertySearchFilter,
  type DiscoveryEngineSettings,
} from "@/lib/search/discovery-engine";
import { createSearchPropertyDocument } from "@/lib/search/property-document";

const settings: DiscoveryEngineSettings = {
  projectId: "smart-caixa-teste",
  location: "global",
  collection: "default_collection",
  dataStoreId: "smart-dados-pesquisa_1786716693643",
  engineId: "smart-buscas_1786716455197",
  branch: "default_branch",
  schemaId: "default_schema",
  timeoutMs: 1_000,
};

describe("DiscoveryEngineClient", () => {
  it("faz upsert idempotente usando structData", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "vivareal-2763318568" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = new DiscoveryEngineClient(settings, {
      accessToken: async () => "test-token",
      fetch: fetchMock,
    });
    const document = createSearchPropertyDocument({
      source: "VIVAREAL",
      sourceListingId: "2763318568",
      title: "Casa com paisagismo",
      salePrice: 22_000_000,
      url: "https://www.vivareal.com.br/imovel/2763318568",
      updatedAt: "2026-08-13T19:20:09.100Z",
    });

    await client.upsertProperty(document);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("documents/vivareal-2763318568?allowMissing=true");
    expect(init?.method).toBe("PATCH");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-token" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      id: "vivareal-2763318568",
      schemaId: "default_schema",
      structData: { source: "VIVAREAL", title: "Casa com paisagismo" },
    });
  });

  it("propaga a mensagem estruturada de erro da API", async () => {
    const client = new DiscoveryEngineClient(settings, {
      accessToken: async () => "test-token",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: "Schema inválido", status: "INVALID_ARGUMENT" } }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      ),
    });

    await expect(client.updatePropertySchema()).rejects.toEqual(
      new DiscoveryEngineError("Schema inválido", 400, "INVALID_ARGUMENT"),
    );
  });

  it("monta filtros estruturados para compra", () => {
    expect(
      propertySearchFilter({
        city: "Belo Horizonte",
        neighborhoods: ["Savassi", "Funcionários"],
        transaction: "SALE",
        price_min: 500_000,
        price_max: 900_000,
        bedrooms_min: 3,
      }),
    ).toContain(
      'transactionTypes: ANY("SALE") AND city: ANY("Belo Horizonte") AND neighborhood: ANY("Savassi", "Funcionários")',
    );
  });
});

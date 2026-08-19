import { afterEach, describe, expect, it, vi } from "vitest";

import { PortalGatewayConnector } from "@/lib/connectors/gateway";
import { getPortalConnectors, portalSources } from "@/lib/connectors/registry";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PORTAL_DATA_API_URL;
  delete process.env.PORTAL_DATA_API_TOKEN;
  delete process.env.PORTAL_DATA_SOURCES;
});

describe("conectores dos portais", () => {
  it("registra os dois blocos de portais", () => {
    expect(portalSources.map((source) => source.code)).toEqual([
      "zap",
      "vivareal",
      "imovelweb",
      "casamineira",
      "olx",
      "quintoandar",
    ]);
    expect(portalSources.filter((source) => source.block === 2)).toHaveLength(3);
    expect(Object.keys(getPortalConnectors())).toHaveLength(6);
  });

  it("usa dados demonstrativos enquanto o gateway não está configurado", () => {
    const connectors = getPortalConnectors();
    expect(connectors.zap.constructor.name).toBe("DemoConnector");
    expect(connectors.vivareal.configured()).toBe(true);
    expect(connectors.quintoandar.constructor.name).toBe("DemoConnector");
  });

  it("traduz a busca para o contrato do gateway autorizado", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [{ external_id: "zap-123", url: "https://www.zapimoveis.com.br/imovel/123" }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const connector = new PortalGatewayConnector("zap", "https://collector.example", "secret");
    const results = await connector.search({
      city: "Belo Horizonte",
      neighborhoods: ["Savassi"],
      transaction: "SALE",
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://collector.example/v1/sources/zap/search",
    );
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      authorization: "Bearer secret",
    });
    expect(results[0]).toMatchObject({ external_id: "zap-123", key: "zap-123" });
  });

  it("normaliza a resposta canônica do gateway", () => {
    const connector = new PortalGatewayConnector("vivareal", "https://collector.example");
    expect(
      connector.normalize({
        id: "vr-10",
        url: "https://www.vivareal.com.br/imovel/10",
        property_type: "APARTMENT",
        transaction_type: "RENT",
        city: "Belo Horizonte",
        neighborhood: "Lourdes",
        address: "Rua Curitiba, 10",
        area_m2: 80,
        bedrooms: 2,
        bathrooms: 2,
        parking_spaces: 1,
        price: 3500,
        condo_fee: 700,
      }),
    ).toMatchObject({
      source_code: "vivareal",
      external_id: "vr-10",
      transaction_type: "RENT",
      normalized_address: "rua curitiba, 10",
      price: 3500,
    });
  });
});

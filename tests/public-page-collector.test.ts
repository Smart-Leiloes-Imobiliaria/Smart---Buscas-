import { describe, expect, it, vi } from "vitest";

import { collectionConfigSchema } from "@/lib/collection/config";
import { PublicPageCollector, parsePage, robotsAllows } from "@/lib/collection/public-pages";

const parsedConfig = collectionConfigSchema.parse({
  userAgent: "MoradaCollector/1.0",
  contact: "collector@example.com",
  sources: [{
    code: "zap",
    allowedHosts: ["catalogo.example"],
    requestDelayMs: 0,
    scopes: [{
      key: "bh-venda",
      searchUrl: "https://catalogo.example/imoveis?page={page}",
      city: "Belo Horizonte",
      state: "MG",
      parser: "AUTO",
      maxPages: 3,
    }],
  }],
});
const source = parsedConfig.sources[0];
const scope = source.scopes[0];

describe("coletor de páginas públicas", () => {
  it("extrai e normaliza anúncios de JSON-LD", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "ItemList",
      itemListElement: [{
        position: 1,
        item: {
          "@type": "Apartment",
          sku: "ABC-10",
          name: "Apartamento com varanda",
          description: "Imóvel bem localizado",
          url: "/imovel/abc-10",
          offers: { price: 750000 },
          address: { addressLocality: "Belo Horizonte", addressRegion: "MG", streetAddress: "Rua A, 10" },
          floorSize: { value: 82 },
          numberOfRooms: 3,
          image: ["/images/abc-10.webp"],
        },
      }],
    })}</script>`;
    const raw = parsePage(html, scope, "https://catalogo.example/imoveis?page=1");
    const collector = new PublicPageCollector(source, parsedConfig.userAgent, parsedConfig.contact,
      vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response("User-agent: *\nAllow: /", { status: 200 }))
        .mockResolvedValueOnce(new Response(html, { status: 200, headers: { "content-type": "text/html" } }))
        .mockResolvedValueOnce(new Response("", { status: 200, headers: { "content-type": "text/html" } })),
    );
    expect(raw).toHaveLength(1);
    return collector.collect(scope).then((result) => {
      expect(result).toMatchObject({ complete: true, pagesProcessed: 2 });
      expect(result.pages[0].items[0]).toMatchObject({
        external_id: "ABC-10",
        title: "Apartamento com varanda",
        city: "Belo Horizonte",
        state: "MG",
        bedrooms: 3,
        area_m2: 82,
        price: 750000,
      });
    });
  });

  it("bloqueia caminhos proibidos pelo robots.txt", () => {
    expect(robotsAllows("User-agent: *\nDisallow: /privado\nAllow: /privado/publico", "/privado/item", "MoradaCollector/1.0")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /privado\nAllow: /privado/publico", "/privado/publico/item", "MoradaCollector/1.0")).toBe(true);
  });

  it("marca como parcial quando chega ao limite com resultados", async () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Product", sku: "1", name: "Casa", url: "/1", offers: { price: 100000 },
    })}</script>`;
    const onePageScope = { ...scope, maxPages: 1 };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response(html, { status: 200, headers: { "content-type": "text/html" } }));
    const result = await new PublicPageCollector(source, parsedConfig.userAgent, parsedConfig.contact, fetchMock).collect(onePageScope);
    expect(result).toMatchObject({ complete: false, stopReason: "MAX_PAGES" });
  });
});

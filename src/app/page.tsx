import Link from "next/link";

import { PropertyCard } from "@/components/property-card";
import { SearchForm } from "@/components/search-form";
import { collectorPropertyToCardData } from "@/lib/property-card-data";
import { getProperties } from "@/lib/properties";
import {
  collectorPropertyFiltersSchema,
  type CollectorPropertyFilters,
} from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RawSearchParams = Record<string, string | string[] | undefined>;

const firstValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const normalizedInput = (searchParams: RawSearchParams) => ({
  city: firstValue(searchParams.city),
  state: firstValue(searchParams.state),
  neighborhood: firstValue(searchParams.neighborhood),
  transaction: firstValue(searchParams.transaction) ?? "SALE",
  propertyType: firstValue(searchParams.propertyType),
  minPrice: firstValue(searchParams.minPrice),
  maxPrice: firstValue(searchParams.maxPrice),
  minArea: firstValue(searchParams.minArea),
  maxArea: firstValue(searchParams.maxArea),
  bedrooms: firstValue(searchParams.bedrooms),
  limit: firstValue(searchParams.limit) ?? "12",
  offset: firstValue(searchParams.offset) ?? "0",
});

function pageHref(filters: CollectorPropertyFilters, offset: number) {
  const params = new URLSearchParams();
  if (filters.city) params.set("city", filters.city);
  if (filters.state) params.set("state", filters.state);
  if (filters.neighborhood) params.set("neighborhood", filters.neighborhood);
  params.set("transaction", filters.transaction);
  if (filters.propertyType) params.set("propertyType", filters.propertyType);
  if (filters.minPrice != null) params.set("minPrice", String(filters.minPrice));
  if (filters.maxPrice != null) params.set("maxPrice", String(filters.maxPrice));
  if (filters.minArea != null) params.set("minArea", String(filters.minArea));
  if (filters.maxArea != null) params.set("maxArea", String(filters.maxArea));
  if (filters.bedrooms != null) params.set("bedrooms", String(filters.bedrooms));
  params.set("limit", String(filters.limit));
  params.set("offset", String(offset));
  return `/?${params.toString()}`;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const parsed = collectorPropertyFiltersSchema.safeParse(
    normalizedInput(await searchParams),
  );
  const filters = parsed.success
    ? parsed.data
    : collectorPropertyFiltersSchema.parse({
        transaction: "SALE",
        limit: 12,
        offset: 0,
      });
  const filterError = parsed.success ? undefined : parsed.error.issues[0]?.message;
  const result = parsed.success
    ? await getProperties(filters)
    : { properties: [], total: 0, limit: filters.limit, offset: filters.offset };
  const effectiveFilters = {
    ...filters,
    limit: result.limit,
    offset: result.offset,
  };
  const cards = result.properties.map(collectorPropertyToCardData);
  const start = result.total === 0 ? 0 : result.offset + 1;
  const end = Math.min(result.offset + result.properties.length, result.total);
  const hasPrevious = result.offset > 0;
  const hasNext = result.offset + result.limit < result.total;

  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div className="eyebrow">Uma busca. Imóveis atualizados.</div>
          <h1>Seu próximo endereço começa aqui.</h1>
          <p>Pesquise em qualquer cidade do Brasil. A coleta acontece em segundo plano e os resultados aparecem automaticamente.</p>
          <SearchForm defaults={effectiveFilters} error={filterError} />
        </div>
      </section>
      <main className="content">
        <div className="section-head">
          <div>
            <div className="eyebrow">Resultados reais</div>
            <h2>{result.total} {result.total === 1 ? "imóvel encontrado" : "imóveis encontrados"}</h2>
            <span className="subtle">{result.total > 0 ? `Exibindo ${start}–${end}` : "Tente ampliar ou remover algum filtro."}</span>
          </div>
          <Link className="text-link" href="/">Limpar filtros</Link>
        </div>

        <section className="cards property-results">
          {cards.length ? cards.map((item) => <PropertyCard item={item} key={item.id} />) : (
            <div className="empty">
              <h3>Nenhum imóvel nesta combinação</h3>
              <p className="subtle">Amplie a faixa de preço ou remova algum filtro.</p>
              <Link className="primary" href="/">Ver todos os imóveis</Link>
            </div>
          )}
        </section>

        {(hasPrevious || hasNext) && (
          <nav className="pagination" aria-label="Paginação dos imóveis">
            {hasPrevious ? <Link className="primary pagination-link" href={pageHref(effectiveFilters, Math.max(0, result.offset - result.limit))}>← Anterior</Link> : <span />}
            <span className="subtle">Página {Math.floor(result.offset / result.limit) + 1}</span>
            {hasNext ? <Link className="primary pagination-link" href={pageHref(effectiveFilters, result.offset + result.limit)}>Próxima →</Link> : <span />}
          </nav>
        )}

        <div className="section-head how-it-works"><div><div className="eyebrow">Como funciona</div><h2>Coleta separada. Busca rápida.</h2></div></div>
        <div className="stats">
          <div className="stat"><span className="subtle">01 · Coletar</span><strong>Em segundo plano</strong><small className="subtle">O Selenium não participa da busca do usuário.</small></div>
          <div className="stat"><span className="subtle">02 · Normalizar</span><strong>Um formato</strong><small className="subtle">Fontes diferentes compartilham o mesmo contrato.</small></div>
          <div className="stat"><span className="subtle">03 · Consultar</span><strong>PostgreSQL</strong><small className="subtle">Filtros são aplicados diretamente no banco.</small></div>
          <div className="stat"><span className="subtle">04 · Visitar</span><strong>Fonte original</strong><small className="subtle">Cada card leva ao anúncio sincronizado.</small></div>
        </div>
      </main>
    </>
  );
}

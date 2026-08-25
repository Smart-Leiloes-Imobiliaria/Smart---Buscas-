"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { PropertyAveragesCard } from "@/components/property-averages-card";
import { PropertyCard } from "@/components/property-card";
import { api } from "@/lib/client-api";
import type {
  PropertyCardData,
  PropertySearchStatus,
  PropertyTransaction,
} from "@/lib/types";

type PropertySearchResponse = {
  ok: true;
  search: {
    id: string;
    city: string;
    state: string;
    neighborhood: string | null;
    transaction: PropertyTransaction;
    propertyType: string | null;
    minPrice: number | null;
    maxPrice: number | null;
    minArea: number | null;
    maxArea: number | null;
    bedrooms: number | null;
    status: PropertySearchStatus;
    propertiesFound: number;
    error: string | null;
  };
  cachedResults: boolean;
  count: number;
  properties: PropertyCardData[];
  sourceErrors?: string[];
};

const statusCopy: Record<PropertySearchStatus, string> = {
  PENDING: "Aguardando o coletor",
  RUNNING: "Buscando imóveis nos portais",
  COMPLETED: "Busca concluída",
  FAILED: "A busca não pôde ser concluída",
};

export default function PropertySearchPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<PropertySearchResponse>();
  const [error, setError] = useState("");

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      try {
        const next = await api<PropertySearchResponse>(
          `/api/property-searches/${id}`,
        );
        if (stopped) return;
        setData(next);
        setError("");
        if (next.search.status === "PENDING" || next.search.status === "RUNNING") {
          timer = setTimeout(load, 2000);
        }
      } catch (caught) {
        if (stopped) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Não foi possível acompanhar a pesquisa",
        );
      }
    }

    void load();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  if (error) {
    return <main className="content"><ErrorState message={error} /></main>;
  }
  if (!data) return <LoadingState />;

  const running = data.search.status === "PENDING" || data.search.status === "RUNNING";
  return (
    <main className="content">
      <div className="section-head">
        <div>
          <div className="eyebrow">Pesquisa #{data.search.id.slice(0, 8)}</div>
          <h2>{statusCopy[data.search.status]}</h2>
          <span className="subtle">
            {[data.search.neighborhood, data.search.city, data.search.state]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        <Link className="primary" href="/">Nova pesquisa</Link>
      </div>

      <section className={`search-status search-status-${data.search.status.toLowerCase()}`}>
        {running && <div className="spinner" />}
        <div>
          <strong>{running ? "Coleta em andamento" : statusCopy[data.search.status]}</strong>
          <p className="subtle">
            {running
              ? data.cachedResults && data.count > 0
                ? `${data.count} imóveis já armazenados são exibidos enquanto buscamos atualizações.`
                : "Os resultados aparecerão automaticamente assim que o coletor encontrá-los."
              : data.search.status === "COMPLETED"
                ? `${data.search.propertiesFound} imóveis encontrados nesta coleta.`
                : data.search.error || "Tente iniciar uma nova pesquisa."}
          </p>
        </div>
      </section>
      {data.sourceErrors?.length ? (
        <section className="search-status search-status-failed">
          <div>
            <strong>Algumas fontes não responderam</strong>
            <p className="subtle">{data.sourceErrors.join(" ")}</p>
          </div>
        </section>
      ) : null}

      <div className="section-head search-results-head">
        <div>
          <h2>{data.count} {data.count === 1 ? "resultado" : "resultados"}</h2>
          {data.cachedResults && running && <span className="tag tag-warning">Resultados anteriores</span>}
        </div>
      </div>

      <section className="cards property-results">
        {data.properties.length ? (
          <>
            <PropertyAveragesCard properties={data.properties} />
            {data.properties.map((item) => (
              <PropertyCard item={item} key={item.id} />
            ))}
          </>
        ) : (
          <div className="empty">
            <h3>{running ? "Buscando imóveis…" : "Nenhum imóvel encontrado"}</h3>
            <p className="subtle">{running ? "Esta página será atualizada automaticamente." : "Altere os filtros e tente novamente."}</p>
          </div>
        )}
      </section>
    </main>
  );
}

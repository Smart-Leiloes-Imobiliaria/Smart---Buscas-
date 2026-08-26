"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
  mongoSource?: {
    status: string;
    message: string;
  };
};

const statusCopy: Record<PropertySearchStatus, string> = {
  PENDING: "Aguardando o coletor",
  RUNNING: "Buscando imóveis nos portais",
  COMPLETED: "Busca concluída",
  FAILED: "A busca não pôde ser concluída",
};

const mongoStatusCopy: Record<string, string> = {
  DISABLED: "Não consultado",
  IN_COLLECTOR: "No fluxo da coleta",
  CONNECTED: "Consultado com sucesso",
  EMPTY_COLLECTION: "Coleção de imóveis não encontrada",
  NO_MATCHES: "Nenhum documento correspondeu aos filtros",
  EMPTY_AFTER_FILTERING: "Documentos encontrados, mas descartados na validação",
  ERROR: "Erro ao consultar o MongoDB",
};

export default function PropertySearchPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<PropertySearchResponse>();
  const [error, setError] = useState("");
  const hasLoadedData = useRef(false);
  const latestStatus = useRef<PropertySearchStatus | undefined>(undefined);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    async function load() {
      let shouldPollAgain = true;
      try {
        const next = await api<PropertySearchResponse>(
          `/api/property-searches/${id}`,
        );
        if (stopped) return;
        failures = 0;
        hasLoadedData.current = true;
        setData(next);
        latestStatus.current = next.search.status;
        setError("");
        shouldPollAgain =
          next.search.status === "PENDING" || next.search.status === "RUNNING";
      } catch (caught) {
        if (stopped) return;
        failures += 1;
        shouldPollAgain =
          latestStatus.current !== "COMPLETED" &&
          latestStatus.current !== "FAILED";
        if (!hasLoadedData.current || failures >= 3) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Não foi possível acompanhar a pesquisa",
          );
        }
      } finally {
        if (!stopped && shouldPollAgain) {
          timer = setTimeout(load, failures ? 3000 : 2000);
        }
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
      {data.mongoSource ? (
        <section className="search-status">
          <div>
            <strong>MongoDB</strong>
            <p className="subtle">
              {mongoStatusCopy[data.mongoSource.status] ?? data.mongoSource.status}: {data.mongoSource.message}
            </p>
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

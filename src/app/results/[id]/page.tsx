"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { PropertyAveragesCard } from "@/components/property-averages-card";
import { PropertyCard, type PropertyCardItem } from "@/components/property-card";
import { api, money } from "@/lib/client-api";

type SearchResponse = {
  discovered_count: number;
  criteria: {
    city: string;
    neighborhoods: string[];
    price_min?: number | null;
    price_max?: number | null;
    area_min?: number | null;
    bedrooms_min?: number | null;
    parking_spaces_min?: number | null;
  };
  items: PropertyCardItem[];
};

export default function ResultsPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SearchResponse>();
  const [error, setError] = useState("");
  useEffect(() => {
    api<SearchResponse>(`/api/searches/${id}`).then(setData).catch((caught) => setError(caught.message));
  }, [id]);
  if (error) return <main className="content"><ErrorState message={error} /></main>;
  if (!data) return <LoadingState />;
  return (
    <main className="content">
      <div className="section-head">
        <div><div className="eyebrow">Busca consolidada</div><h2>{data.items.length} {data.items.length === 1 ? "imóvel encontrado" : "imóveis encontrados"}</h2><span className="subtle">{data.discovered_count} anúncios analisados em múltiplas fontes</span></div>
        <Link className="primary" href="/">Alterar busca</Link>
      </div>
      <div className="result-layout">
        <aside className="filter-panel">
          <h3>Sua busca</h3>
          <div className="field"><label>Cidade</label><strong>{data.criteria.city}</strong></div>
          <div className="field"><label>Bairros</label><span>{data.criteria.neighborhoods.join(", ") || "Todos"}</span></div>
          <div className="field"><label>Preço</label><span>{data.criteria.price_min ? `A partir de ${money(data.criteria.price_min)}` : "Sem mínimo"}<br />{data.criteria.price_max ? `Até ${money(data.criteria.price_max)}` : "Sem máximo"}</span></div>
          <div className="field"><label>Área</label><span>{data.criteria.area_min ? `${data.criteria.area_min}+ m²` : "Todas"}</span></div>
          <div className="field"><label>Quartos</label><span>{data.criteria.bedrooms_min ? `${data.criteria.bedrooms_min}+` : "Todos"}</span></div>
          <div className="field"><label>Vagas</label><span>{data.criteria.parking_spaces_min ? `${data.criteria.parking_spaces_min}+` : "Todas"}</span></div>
        </aside>
        <section className="cards">
          {data.items.length ? (
            <>
              <PropertyAveragesCard properties={data.items} />
              {data.items.map((item) => <PropertyCard item={item} key={item.id} />)}
            </>
          ) : <div className="empty"><h3>Nenhum imóvel nesta combinação</h3><p className="subtle">Amplie a faixa de preço ou remova algum bairro.</p></div>}
        </section>
      </div>
    </main>
  );
}

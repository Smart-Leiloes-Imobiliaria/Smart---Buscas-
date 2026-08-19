"use client";

import Image from "next/image";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ErrorState } from "@/components/error-state";
import { FavoriteButton } from "@/components/favorite-button";
import { LoadingState } from "@/components/loading-state";
import { api, money } from "@/lib/client-api";

type PropertyDetail = {
  id: string; image_url: string; property_type: string; sources: string[]; neighborhood: string;
  normalized_address: string; price: number; area_m2: number; bedrooms: number; parking_spaces: number;
  description: string; favorite: boolean;
  listings: { id: string; source_name: string; price: number; condo_fee: number; url: string }[];
  history: { source_code: string; price: number; captured_at: string }[];
  events: { id: number; event_type: string; old_value: string; new_value: string; created_at: string }[];
};

export default function PropertyPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<PropertyDetail>();
  const [error, setError] = useState("");
  useEffect(() => { api<PropertyDetail>(`/api/properties/${id}`).then(setItem).catch((caught) => setError(caught.message)); }, [id]);
  if (error) return <main className="content"><ErrorState message={error} /></main>;
  if (!item) return <LoadingState />;
  return (
    <>
      <section className="detail-hero">
        <Image className="detail-image" src={item.image_url} alt={item.neighborhood} width={1200} height={800} priority />
        <div className="detail-info">
          <div className="eyebrow">{item.property_type === "PENTHOUSE" ? "Cobertura" : "Apartamento"} · {item.sources.length} fontes</div>
          <h1>{item.neighborhood}</h1><div className="subtle">{item.normalized_address}</div>
          <div className="detail-price">{money(item.price)}</div>
          <div className="detail-features"><span><strong>{item.area_m2} m²</strong><br /><small className="subtle">área privativa</small></span><span><strong>{item.bedrooms}</strong><br /><small className="subtle">quartos</small></span><span><strong>{item.parking_spaces}</strong><br /><small className="subtle">vagas</small></span></div>
          <p className="subtle">{item.description}</p>
          <FavoriteButton propertyId={item.id} initial={item.favorite} detail />
        </div>
      </section>
      <main className="content">
        <div className="admin-grid">
          <section className="listings"><h2>Onde está anunciado</h2>{item.listings.map((listing) => <div className="list-row" key={listing.id}><strong>{listing.source_name}</strong><span>{money(listing.price)}</span><span className="subtle">Condomínio {money(listing.condo_fee)}</span><a className="text-link" href={listing.url} target="_blank" rel="noreferrer">Ver anúncio ↗</a></div>)}</section>
          <section className="history"><h2>Histórico capturado</h2>{item.history.map((row, index) => <div className="list-row" key={`${row.source_code}-${row.captured_at}-${index}`}><span className="tag">{row.source_code}</span><strong>{money(row.price)}</strong><span className="subtle">{new Date(row.captured_at).toLocaleDateString("pt-BR")}</span><span /></div>)}</section>
          {item.events.length > 0 && <section className="admin-card"><h2>Alterações detectadas</h2>{item.events.map((event) => <div className="list-row" key={event.id}><strong>Preço alterado</strong><span>{money(Number(event.old_value))}</span><span>→ {money(Number(event.new_value))}</span><small className="subtle">{new Date(event.created_at).toLocaleDateString("pt-BR")}</small></div>)}</section>}
        </div>
      </main>
    </>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { PropertyCard, type PropertyCardItem } from "@/components/property-card";
import { api } from "@/lib/client-api";

export default function FavoritesPage() {
  const [items, setItems] = useState<PropertyCardItem[]>();
  const [error, setError] = useState("");
  useEffect(() => { api<{ items: PropertyCardItem[] }>("/api/favorites").then((data) => setItems(data.items)).catch((caught) => setError(caught.message)); }, []);
  if (error) return <main className="content"><ErrorState message={error} /></main>;
  if (!items) return <LoadingState />;
  return (
    <main className="content">
      <div className="section-head"><div><div className="eyebrow">Sua seleção</div><h2>Imóveis favoritos</h2><span className="subtle">Acompanhe suas melhores opções em um só lugar.</span></div></div>
      <section className="cards">{items.length ? items.map((item) => <PropertyCard item={item} key={item.id} onFavoriteChange={(favorite) => { if (!favorite) setItems((current) => current?.filter((candidate) => candidate.id !== item.id)); }} />) : <div className="empty"><h3>Nenhum favorito ainda</h3><p className="subtle">Use o coração nos resultados para salvar imóveis.</p><Link className="primary" href="/">Começar uma busca</Link></div>}</section>
    </main>
  );
}

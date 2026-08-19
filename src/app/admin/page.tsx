"use client";

import { useCallback, useEffect, useState } from "react";

import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { api } from "@/lib/client-api";

type Summary = { property: number; listing: number; search: number; pending_reviews: number };
type Source = { code: string; name: string; discovery_method: string; priority: number; max_results: number; status: string; last_sync_at: string | null; enabled: boolean };
type Job = { id: number; source_code: string; status: string; processed_count: number };
type Review = { id: number; review_type: string; match_score: number; status: string };
type Integration = { code: string; name: string; block: number; configured: boolean; authentication: string };
type SearchIndex = { enabled: boolean; engine: string | null; data_store: string | null; queue: Record<string, number> };

export default function AdminPage() {
  const [data, setData] = useState<{ summary: Summary; sources: Source[]; jobs: Job[]; reviews: Review[]; integrations: Integration[]; searchIndex: SearchIndex }>();
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [summary, sources, jobs, reviews, integrations] = await Promise.all([
        api<Summary>("/api/admin/summary"),
        api<{ items: Source[] }>("/api/admin/sources"),
        api<{ items: Job[] }>("/api/admin/jobs"),
        api<{ items: Review[] }>("/api/admin/reviews"),
        api<{ items: Integration[]; search_index: SearchIndex }>("/api/admin/integrations"),
      ]);
      setData({ summary, sources: sources.items, jobs: jobs.items, reviews: reviews.items, integrations: integrations.items, searchIndex: integrations.search_index });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar a operação");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function toggleSource(source: Source) {
    await api(`/api/admin/sources/${source.code}`, { method: "PATCH", body: JSON.stringify({ enabled: !source.enabled }) });
    await load();
  }
  async function decide(review: Review, decision: "GROUP" | "SEPARATE") {
    await api(`/api/admin/reviews/${review.id}/decision`, { method: "POST", body: JSON.stringify({ decision }) });
    await load();
  }

  if (error) return <main className="content"><ErrorState message={error} /></main>;
  if (!data) return <LoadingState />;
  const pendingReviews = data.reviews.filter((review) => review.status === "PENDING");
  return (
    <main className="content">
      <div className="section-head"><div><div className="eyebrow">Backoffice</div><h2>Operação da plataforma</h2><span className="subtle">Saúde das fontes, ingestões e decisões pendentes.</span></div></div>
      <div className="stats">
        <div className="stat"><span className="subtle">Imóveis</span><strong>{data.summary.property}</strong></div>
        <div className="stat"><span className="subtle">Anúncios</span><strong>{data.summary.listing}</strong></div>
        <div className="stat"><span className="subtle">Buscas</span><strong>{data.summary.search}</strong></div>
        <div className="stat"><span className="subtle">Revisões</span><strong>{data.summary.pending_reviews}</strong></div>
      </div>
      <div className="admin-grid">
        <section className="admin-card"><h2>Smart-Buscas</h2><div className="list-row"><div><strong>{data.searchIndex.engine || "Não configurado"}</strong><br /><small className="subtle">{data.searchIndex.data_store || "Data store ausente"}</small></div><span className={`tag ${data.searchIndex.enabled ? "" : "tag-warning"}`}>{data.searchIndex.enabled ? "Indexação ativa" : "Protegido no modo demo"}</span><span>{data.searchIndex.queue.PENDING ?? 0} pendentes</span><span>{data.searchIndex.queue.FAILED ?? 0} falhas</span></div></section>
        <section className="admin-card"><h2>Coleta dos portais</h2>{data.integrations.map((integration) => <div className="list-row" key={integration.code}><div><strong>{integration.name}</strong><br /><small className="subtle">Bloco {integration.block} · modo {integration.authentication}</small></div><span className={`tag ${integration.configured ? "" : "tag-warning"}`}>{integration.configured ? "Gateway autorizado" : "Dados demonstrativos"}</span><span /><span /></div>)}</section>
        <section className="admin-card"><h2>Fontes</h2>{data.sources.map((source) => <div className="list-row" key={source.code}><div><strong>{source.name}</strong><br /><small className="subtle">{source.discovery_method} · prioridade {source.priority} · limite {source.max_results}</small></div><span className="tag">{source.status}</span><span className="subtle">{source.last_sync_at || "Nunca sincronizada"}</span><button className={`toggle ${source.enabled ? "enabled" : ""}`} onClick={() => toggleSource(source)}>{source.enabled ? "Ativa" : "Pausada"}</button></div>)}</section>
        <section className="admin-card"><h2>Últimas execuções</h2>{data.jobs.length ? data.jobs.slice(0, 8).map((job) => <div className="list-row" key={job.id}><strong>{job.source_code}</strong><span className="tag">{job.status}</span><span>{job.processed_count} itens</span><small className="subtle">#{job.id}</small></div>) : <p className="subtle">Faça uma busca para iniciar a primeira coleta.</p>}</section>
        <section className="admin-card"><h2>Fila de revisão</h2>{pendingReviews.length ? pendingReviews.map((review) => <div className="list-row" key={review.id}><strong>{review.review_type}</strong><span>{review.match_score}%</span><button className="toggle enabled" onClick={() => decide(review, "GROUP")}>Agrupar</button><button className="toggle" onClick={() => decide(review, "SEPARATE")}>Separar</button></div>) : <p className="subtle">Nenhuma pendência de deduplicação.</p>}</section>
      </div>
    </main>
  );
}

import Image from "next/image";
import Link from "next/link";

import { FavoriteButton } from "@/components/favorite-button";
import { money } from "@/lib/client-api";
import type { PropertyCardData } from "@/lib/types";

export type PropertyCardItem = PropertyCardData;

export function PropertyCard({ item, onFavoriteChange }: { item: PropertyCardItem; onFavoriteChange?: (favorite: boolean) => void }) {
  const image = item.imageUrl ? (
    <Image
      className="card-image"
      src={item.imageUrl}
      alt={item.title}
      width={700}
      height={440}
    />
  ) : (
    <div className="card-image card-image-empty">Imagem não disponível</div>
  );

  return (
    <article className="card">
      {item.external ? (
        <a href={item.href} target="_blank" rel="noopener noreferrer">{image}</a>
      ) : (
        <Link href={item.href}>{image}</Link>
      )}
      {item.matchScore != null && <span className="score">{item.matchScore}% compatível</span>}
      {item.favoritePropertyId && (
        <FavoriteButton
          propertyId={item.favoritePropertyId}
          initial={item.favorite}
          onChange={onFavoriteChange}
        />
      )}
      <div className="card-body">
        <h3 className="card-title">{item.title}</h3>
        <div className="card-top"><div className="price">{item.price == null ? "Preço sob consulta" : money(item.price)}</div></div>
        <div className="location">{[item.neighborhood, item.city, item.state].filter(Boolean).join(" · ") || "Localização não informada"}</div>
        <div className="features">
          <span className="feature"><strong>{item.usableArea == null ? "—" : `${item.usableArea} m²`}</strong>área</span>
          <span className="feature"><strong>{item.bedrooms ?? "—"}</strong>quartos</span>
          <span className="feature"><strong>{item.bathrooms ?? "—"}</strong>banheiros</span>
          <span className="feature"><strong>{item.parkingSpaces ?? "—"}</strong>vagas</span>
        </div>
        <div className="source-tags">{item.sources.map((source) => <span className="tag" key={source}>{source}</span>)}</div>
        {item.external && <a className="text-link card-source-link" href={item.href} target="_blank" rel="noopener noreferrer">Ver anúncio original ↗</a>}
      </div>
    </article>
  );
}

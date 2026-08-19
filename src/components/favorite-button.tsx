"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "@/lib/client-api";

export function FavoriteButton({ propertyId, initial, detail = false, onChange }: { propertyId: string; initial: boolean; detail?: boolean; onChange?: (favorite: boolean) => void }) {
  const [favorite, setFavorite] = useState(initial);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function toggle() {
    setBusy(true);
    try {
      await api(favorite ? `/api/favorites/${propertyId}` : "/api/favorites", favorite
        ? { method: "DELETE" }
        : { method: "POST", body: JSON.stringify({ property_id: propertyId }) });
      const nextValue = !favorite;
      setFavorite(nextValue);
      onChange?.(nextValue);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className={detail ? "primary favorite-detail" : `favorite ${favorite ? "on" : ""}`}
      onClick={toggle}
      disabled={busy}
      aria-label={favorite ? "Remover dos favoritos" : "Favoritar"}
    >
      {detail ? (favorite ? "♥ Salvo nos favoritos" : "♡ Salvar imóvel") : favorite ? "♥" : "♡"}
    </button>
  );
}

import type { SearchCriteria } from "@/lib/schemas";
import type { PropertyRow } from "@/lib/types";

export function rank(item: PropertyRow, criteria: SearchCriteria) {
  let score = 20;
  const reasons: string[] = [];
  const price = item.price ?? 0;

  if (
    (criteria.price_min == null || price >= criteria.price_min) &&
    (criteria.price_max == null || price <= criteria.price_max)
  ) {
    score += 30;
    reasons.push("Preço dentro da faixa");
  }
  if (
    !criteria.neighborhoods.length ||
    criteria.neighborhoods.some(
      (value) => value.toLowerCase() === item.neighborhood.toLowerCase(),
    )
  ) {
    score += 25;
    reasons.push("Bairro desejado");
  }
  if (criteria.area_min == null || (item.area_m2 ?? 0) >= criteria.area_min) {
    score += 10;
    reasons.push("Metragem compatível");
  }
  if (
    criteria.bedrooms_min == null ||
    (item.bedrooms ?? 0) >= criteria.bedrooms_min
  ) {
    score += 10;
    reasons.push("Quartos compatíveis");
  }
  if (
    criteria.parking_spaces_min == null ||
    (item.parking_spaces ?? 0) >= criteria.parking_spaces_min
  ) {
    score += 5;
    reasons.push("Vagas compatíveis");
  }
  return { score: Math.min(score, 100), reasons };
}

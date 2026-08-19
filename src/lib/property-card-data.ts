import type {
  CollectorProperty,
  PropertyCardData,
  PropertyRow,
} from "@/lib/types";

const propertyTypeLabel = (propertyType: string | null) => {
  const labels: Record<string, string> = {
    APARTMENT: "Apartamento",
    HOUSE: "Casa",
    PENTHOUSE: "Cobertura",
    COMMERCIAL_ROOM: "Sala comercial",
    COMMERCIAL: "Imóvel comercial",
    OTHER: "Imóvel",
  };
  return labels[propertyType ?? ""] ?? "Imóvel";
};

export function collectorPropertyToCardData(
  property: CollectorProperty,
): PropertyCardData {
  return {
    id: `collector-${property.id}`,
    title:
      property.title ||
      `${propertyTypeLabel(property.property_type)} em ${property.neighborhood || property.city || "localização não informada"}`,
    imageUrl: property.image_url || property.image_urls[0] || null,
    href: property.sourceUrl,
    external: true,
    neighborhood: property.neighborhood,
    city: property.city,
    state: property.state,
    price: property.price,
    usableArea: property.usable_area,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    parkingSpaces: property.parking_spaces,
    sources: [property.source],
    favorite: false,
  };
}

export function legacyPropertyToCardData(
  property: PropertyRow,
): PropertyCardData {
  const sources =
    typeof property.sources === "string"
      ? property.sources.split(",").filter(Boolean)
      : (property.sources ?? []);
  return {
    id: property.id,
    title:
      property.title ||
      `${propertyTypeLabel(property.property_type)} em ${property.neighborhood}`,
    imageUrl: property.image_url,
    href: `/property/${property.id}`,
    external: false,
    neighborhood: property.neighborhood,
    city: property.city,
    state: property.state ?? null,
    price: property.price ?? null,
    usableArea: property.area_m2,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    parkingSpaces: property.parking_spaces,
    sources,
    favorite: Boolean(property.favorite),
    favoritePropertyId: property.id,
    matchScore: property.match_score,
  };
}

import type { PropertyCardData } from "@/lib/types";

export type PropertyValueAverages = {
  averagePrice: number | null;
  priceSampleSize: number;
  averagePricePerSquareMeter: number | null;
  pricePerSquareMeterSampleSize: number;
};

export function calculatePropertyValueAverages(
  properties: PropertyCardData[],
): PropertyValueAverages {
  const unique = new Map<string, PropertyCardData>();
  for (const property of properties) {
    if (!unique.has(property.id)) unique.set(property.id, property);
  }

  const validPrices: number[] = [];
  const validSquareMeterPrices: number[] = [];

  for (const property of unique.values()) {
    if (isPositiveFinite(property.price)) {
      validPrices.push(property.price);
      if (isPositiveFinite(property.usableArea)) {
        validSquareMeterPrices.push(property.price / property.usableArea);
      }
    }
  }

  return {
    averagePrice: average(validPrices),
    priceSampleSize: validPrices.length,
    averagePricePerSquareMeter: average(validSquareMeterPrices),
    pricePerSquareMeterSampleSize: validSquareMeterPrices.length,
  };
}

const isPositiveFinite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const average = (values: number[]) =>
  values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null;

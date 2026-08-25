import { money } from "@/lib/client-api";
import { calculatePropertyValueAverages } from "@/lib/property-statistics";
import type { PropertyCardData } from "@/lib/types";

export function PropertyAveragesCard({ properties }: { properties: PropertyCardData[] }) {
  const averages = calculatePropertyValueAverages(properties);
  if (!properties.length) return null;

  return (
    <section className="averages-card">
      <div>
        <span className="eyebrow">Média dos imóveis</span>
        <strong>
          {averages.averagePrice == null
            ? "Sem preços válidos"
            : money(averages.averagePrice)}
        </strong>
        {averages.priceSampleSize > 0 && (
          <small>{averages.priceSampleSize} imóveis considerados</small>
        )}
      </div>
      {averages.averagePricePerSquareMeter != null && (
        <div>
          <span className="eyebrow">Média por m²</span>
          <strong>{money(averages.averagePricePerSquareMeter)}/m²</strong>
          <small>{averages.pricePerSquareMeterSampleSize} imóveis com área</small>
        </div>
      )}
    </section>
  );
}

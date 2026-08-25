import type {
  DiscoveredListing,
  PropertySourceConnector,
} from "@/lib/connectors/base";
import type { SearchCriteria } from "@/lib/schemas";
import type { NormalizedListing } from "@/lib/types";

type DemoProperty = {
  key: string;
  type: string;
  city: string;
  neighborhood: string;
  address: string;
  lat: number;
  lng: number;
  area: number;
  bedrooms: number;
  bathrooms: number;
  parking: number;
  price: number;
  condo: number;
  image: string;
  description: string;
};

const image = (id: string) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1200&q=80`;

export const baseProperties: DemoProperty[] = [
  { key: "savassi-1", type: "APARTMENT", city: "Belo Horizonte", neighborhood: "Savassi", address: "Rua Pernambuco, 1147", lat: -19.9367, lng: -43.9341, area: 92, bedrooms: 3, bathrooms: 2, parking: 2, price: 830000, condo: 920, image: image("1600607687939-ce8a6c25118c"), description: "Apartamento iluminado, sala ampla e duas vagas em uma das melhores quadras da Savassi." },
  { key: "func-1", type: "APARTMENT", city: "Belo Horizonte", neighborhood: "Funcionários", address: "Rua dos Aimorés, 1550", lat: -19.9279, lng: -43.9284, area: 108, bedrooms: 3, bathrooms: 3, parking: 2, price: 895000, condo: 1100, image: image("1600566753086-00f18fb6b3ea"), description: "Planta generosa, varanda e portaria 24 horas perto da Praça da Liberdade." },
  { key: "lourdes-1", type: "APARTMENT", city: "Belo Horizonte", neighborhood: "Lourdes", address: "Rua Curitiba, 2080", lat: -19.9317, lng: -43.9468, area: 78, bedrooms: 2, bathrooms: 2, parking: 2, price: 760000, condo: 780, image: image("1600607687920-4e2a09cf159d"), description: "Reformado, acabamento contemporâneo e localização caminhável no coração de Lourdes." },
  { key: "sion-1", type: "APARTMENT", city: "Belo Horizonte", neighborhood: "Sion", address: "Rua Patagônia, 410", lat: -19.9548, lng: -43.9349, area: 125, bedrooms: 4, bathrooms: 3, parking: 3, price: 980000, condo: 1250, image: image("1600566753190-17f0baa2a6c3"), description: "Vista definitiva, quatro quartos e lazer completo em rua tranquila." },
  { key: "buritis-1", type: "APARTMENT", city: "Belo Horizonte", neighborhood: "Buritis", address: "Rua José Rodrigues Pereira, 620", lat: -19.9743, lng: -43.9681, area: 86, bedrooms: 3, bathrooms: 2, parking: 2, price: 650000, condo: 690, image: image("1600585154340-be6161a56a0c"), description: "Condomínio com lazer, varanda e fácil acesso à avenida principal." },
  { key: "anchieta-1", type: "PENTHOUSE", city: "Belo Horizonte", neighborhood: "Anchieta", address: "Rua Francisco Deslandes, 880", lat: -19.9477, lng: -43.9253, area: 156, bedrooms: 4, bathrooms: 4, parking: 3, price: 1290000, condo: 1320, image: image("1600607688969-a5bfcd646154"), description: "Cobertura duplex com área gourmet, vista aberta e elevador codificado." },
];

export class DemoConnector implements PropertySourceConnector {
  constructor(
    public code: string,
    private priceFactor: number,
    private omitted = new Set<string>(),
  ) {}

  async search(criteria: SearchCriteria): Promise<DiscoveredListing[]> {
    const neighborhoods = new Set(criteria.neighborhoods.map((item) => item.toLowerCase()));
    return baseProperties
      .filter(
        (item) =>
          !this.omitted.has(item.key) &&
          item.city.toLowerCase() === criteria.city.toLowerCase() &&
          (!neighborhoods.size || neighborhoods.has(item.neighborhood.toLowerCase())),
      )
      .map((item) => ({
        external_id: `${this.code}-${item.key}`,
        key: item.key,
        url: `https://example.com/${this.code}/${item.key}`,
      }));
  }

  async fetch(discovered: DiscoveredListing): Promise<Record<string, unknown>> {
    const property = baseProperties.find((item) => item.key === discovered.key);
    if (!property) throw new Error("Imóvel demonstrativo não encontrado");
    return {
      ...structuredClone(property),
      ...discovered,
      source: this.code,
      asking_price: Math.round((property.price * this.priceFactor) / 1000) * 1000,
    };
  }

  normalize(raw: Record<string, unknown>): NormalizedListing {
    return {
      source_code: this.code,
      external_id: String(raw.external_id),
      url: String(raw.url),
      property_type: String(raw.type),
      transaction_type: "SALE",
      city: String(raw.city).trim(),
      neighborhood: String(raw.neighborhood).trim(),
      normalized_address: String(raw.address).trim().toLowerCase(),
      latitude: Number(raw.lat),
      longitude: Number(raw.lng),
      area_m2: Number(raw.area),
      bedrooms: Number(raw.bedrooms),
      bathrooms: Number(raw.bathrooms),
      parking_spaces: Number(raw.parking),
      price: Math.max(0, Number(raw.asking_price)),
      condo_fee: Math.max(0, Number(raw.condo)),
      image_url: String(raw.image),
      description: String(raw.description),
    };
  }

  configured() {
    return true;
  }
}

export const demoConnectors: Record<string, PropertySourceConnector> = {
  zap: new DemoConnector("zap", 1.025, new Set(["anchieta-1"])),
  vivareal: new DemoConnector("vivareal", 1.012, new Set(["buritis-1"])),
  imovelweb: new DemoConnector("imovelweb", 1, new Set(["func-1"])),
  casamineira: new DemoConnector("casamineira", 1.018, new Set(["sion-1"])),
  quintoandar: new DemoConnector("quintoandar", 1.035, new Set(["savassi-1"])),
};

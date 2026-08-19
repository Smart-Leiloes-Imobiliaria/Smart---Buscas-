import type {
  DiscoveredListing,
  PropertySourceConnector,
} from "@/lib/connectors/base";
import type { SearchCriteria } from "@/lib/schemas";
import type { NormalizedListing } from "@/lib/types";

type GatewaySearchResponse = {
  items: Array<{
    external_id: string;
    url: string;
    metadata?: Record<string, unknown>;
  }>;
};

const numberOrNull = (value: unknown) => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const integerOrNull = (value: unknown) => {
  const number = numberOrNull(value);
  return number == null ? null : Math.trunc(number);
};

/**
 * Contrato entre o Next.js e o serviço privado de coleta hospedado no Cloud Run.
 * O gateway é responsável por falar somente com APIs, feeds ou parceiros autorizados.
 */
export class PortalGatewayConnector implements PropertySourceConnector {
  constructor(
    public code: string,
    private baseUrl: string,
    private token?: string,
  ) {}

  configured() {
    return Boolean(this.baseUrl && (this.token || process.env.K_SERVICE));
  }

  private async authorization() {
    if (this.token) return `Bearer ${this.token}`;
    if (!process.env.K_SERVICE) {
      throw new Error(`Gateway de ${this.code} sem autenticação configurada`);
    }
    const metadataUrl = new URL(
      "/computeMetadata/v1/instance/service-accounts/default/identity",
      "http://metadata.google.internal",
    );
    metadataUrl.searchParams.set("audience", this.baseUrl);
    metadataUrl.searchParams.set("format", "full");
    const response = await fetch(metadataUrl, {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Não foi possível obter a identidade do Cloud Run");
    return `Bearer ${await response.text()}`;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const authorization = await this.authorization();
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        authorization,
        ...init?.headers,
      },
      signal: AbortSignal.timeout(Number(process.env.PORTAL_DATA_TIMEOUT_MS ?? 10_000)),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      throw new Error(`Gateway de ${this.code} respondeu ${response.status}: ${detail}`);
    }
    return response.json() as Promise<T>;
  }

  async search(criteria: SearchCriteria): Promise<DiscoveredListing[]> {
    const payload = await this.request<GatewaySearchResponse>(
      `/v1/sources/${encodeURIComponent(this.code)}/search`,
      { method: "POST", body: JSON.stringify({ criteria }) },
    );
    return payload.items.map((item) => ({
      external_id: item.external_id,
      key: item.external_id,
      url: item.url,
      metadata: item.metadata,
    }));
  }

  fetch(discovered: DiscoveredListing): Promise<Record<string, unknown>> {
    return this.request(
      `/v1/sources/${encodeURIComponent(this.code)}/listings/${encodeURIComponent(discovered.external_id)}`,
    );
  }

  normalize(raw: Record<string, unknown>): NormalizedListing {
    const externalId = String(raw.external_id ?? raw.id ?? "");
    const url = String(raw.url ?? "");
    if (!externalId || !url) {
      throw new Error(`Resposta inválida do gateway de ${this.code}: id e URL são obrigatórios`);
    }
    return {
      source_code: this.code,
      external_id: externalId,
      url,
      property_type: String(raw.property_type ?? "APARTMENT"),
      transaction_type: raw.transaction_type === "RENT" ? "RENT" : "SALE",
      city: String(raw.city ?? "").trim(),
      neighborhood: String(raw.neighborhood ?? "").trim(),
      normalized_address: String(raw.address ?? raw.normalized_address ?? "").trim().toLowerCase(),
      latitude: numberOrNull(raw.latitude),
      longitude: numberOrNull(raw.longitude),
      area_m2: numberOrNull(raw.area_m2),
      bedrooms: integerOrNull(raw.bedrooms),
      bathrooms: integerOrNull(raw.bathrooms),
      parking_spaces: integerOrNull(raw.parking_spaces),
      price: Math.max(0, numberOrNull(raw.price) ?? 0),
      condo_fee: Math.max(0, numberOrNull(raw.condo_fee) ?? 0),
      image_url: raw.image_url == null ? null : String(raw.image_url),
      description: raw.description == null ? null : String(raw.description),
    };
  }
}

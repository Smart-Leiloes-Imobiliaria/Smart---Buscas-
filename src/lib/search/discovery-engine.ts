import { GoogleAuth } from "google-auth-library";

import {
  SEARCH_PROPERTY_JSON_SCHEMA,
  type DiscoveryEnginePropertyDocument,
  type SearchPropertyDocument,
  toDiscoveryEngineDocument,
} from "@/lib/search/property-document";
import type { SearchCriteria } from "@/lib/schemas";

const DISCOVERY_ENGINE_API = "https://discoveryengine.googleapis.com/v1";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export type DiscoveryEngineSettings = {
  projectId: string;
  location: string;
  collection: string;
  dataStoreId: string;
  engineId: string;
  branch: string;
  schemaId: string;
  timeoutMs: number;
};

type DiscoveryEngineClientDependencies = {
  accessToken?: () => Promise<string>;
  fetch?: typeof fetch;
};

type GoogleApiErrorBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

export type DiscoveryEngineSearchResult = {
  id?: string;
  document?: {
    id?: string;
    structData?: Record<string, unknown>;
  };
};

export type DiscoveryEngineSearchResponse = {
  results?: DiscoveryEngineSearchResult[];
  totalSize?: number;
  attributionToken?: string;
};

export class DiscoveryEngineError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "DiscoveryEngineError";
  }
}

export class DiscoveryEngineClient {
  private readonly getAccessToken: () => Promise<string>;
  private readonly fetchImplementation: typeof fetch;

  constructor(
    readonly settings = discoveryEngineSettings(),
    dependencies: DiscoveryEngineClientDependencies = {},
  ) {
    this.getAccessToken = dependencies.accessToken ?? defaultAccessToken;
    this.fetchImplementation = dependencies.fetch ?? fetch;
  }

  async upsertProperty(document: SearchPropertyDocument) {
    const payload = toDiscoveryEngineDocument(document);
    const name = `${this.branchName}/documents/${payload.id}`;

    return this.request<DiscoveryEnginePropertyDocument>(
      `${name}?allowMissing=true`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name,
          id: payload.id,
          schemaId: this.settings.schemaId,
          structData: payload.structData,
        }),
      },
    );
  }

  async deleteProperty(documentId: string) {
    await this.request<Record<string, never>>(
      `${this.branchName}/documents/${encodeURIComponent(documentId)}`,
      { method: "DELETE" },
    );
  }

  async updatePropertySchema() {
    const name = `${this.dataStoreName}/schemas/${this.settings.schemaId}`;
    return this.request<{ name: string; done?: boolean; error?: GoogleApiErrorBody["error"] }>(
      `${name}?allowMissing=true`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name,
          jsonSchema: JSON.stringify(SEARCH_PROPERTY_JSON_SCHEMA),
        }),
      },
    );
  }

  async searchProperties(criteria: SearchCriteria, pageSize = 100) {
    const { projectId, location, collection, engineId } = this.settings;
    const servingConfig = `projects/${projectId}/locations/${location}/collections/${collection}/engines/${engineId}/servingConfigs/default_search`;
    return this.request<DiscoveryEngineSearchResponse>(`${servingConfig}:search`, {
      method: "POST",
      body: JSON.stringify({
        query: "",
        pageSize: Math.min(Math.max(pageSize, 1), 100),
        filter: propertySearchFilter(criteria),
      }),
    });
  }

  get dataStoreName() {
    const { projectId, location, collection, dataStoreId } = this.settings;
    return `projects/${projectId}/locations/${location}/collections/${collection}/dataStores/${dataStoreId}`;
  }

  get branchName() {
    return `${this.dataStoreName}/branches/${this.settings.branch}`;
  }

  private async request<T>(resource: string, init: RequestInit): Promise<T> {
    const token = await this.getAccessToken();
    const response = await this.fetchImplementation(`${DISCOVERY_ENGINE_API}/${resource}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-goog-user-project": this.settings.projectId,
        ...init.headers,
      },
      signal: AbortSignal.timeout(this.settings.timeoutMs),
    });

    if (response.ok) {
      if (response.status === 204) return {} as T;
      return response.json() as Promise<T>;
    }

    const body = (await response.json().catch(() => ({}))) as GoogleApiErrorBody;
    throw new DiscoveryEngineError(
      body.error?.message ?? `Discovery Engine respondeu HTTP ${response.status}`,
      response.status,
      body.error?.status,
    );
  }
}

export function discoveryEngineSettings(
  environment: NodeJS.ProcessEnv = process.env,
): DiscoveryEngineSettings {
  const projectId = environment.GOOGLE_CLOUD_PROJECT?.trim();
  const dataStoreId = environment.DISCOVERY_ENGINE_DATA_STORE_ID?.trim();
  const engineId = environment.DISCOVERY_ENGINE_ENGINE_ID?.trim();

  if (!projectId) throw new Error("GOOGLE_CLOUD_PROJECT não configurado");
  if (!dataStoreId) throw new Error("DISCOVERY_ENGINE_DATA_STORE_ID não configurado");
  if (!engineId) throw new Error("DISCOVERY_ENGINE_ENGINE_ID não configurado");

  const timeoutMs = Number(environment.DISCOVERY_ENGINE_TIMEOUT_MS ?? 15_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("DISCOVERY_ENGINE_TIMEOUT_MS deve ser um inteiro positivo");
  }

  return {
    projectId,
    dataStoreId,
    engineId,
    location: environment.DISCOVERY_ENGINE_LOCATION?.trim() || "global",
    collection: environment.DISCOVERY_ENGINE_COLLECTION?.trim() || "default_collection",
    branch: environment.DISCOVERY_ENGINE_BRANCH?.trim() || "default_branch",
    schemaId: environment.DISCOVERY_ENGINE_SCHEMA_ID?.trim() || "default_schema",
    timeoutMs,
  };
}

export function propertySearchFilter(criteria: SearchCriteria) {
  const priceField = criteria.transaction === "RENT" ? "rentalPrice" : "salePrice";
  const filters = [
    'status: ANY("ACTIVE")',
    `transactionTypes: ANY("${criteria.transaction}")`,
    `city: ANY("${escapeFilterValue(criteria.city)}")`,
  ];

  if (criteria.neighborhoods.length) {
    const values = criteria.neighborhoods
      .map((value) => `"${escapeFilterValue(value)}"`)
      .join(", ");
    filters.push(`neighborhood: ANY(${values})`);
  }
  if (criteria.property_type) {
    filters.push(`propertyType: ANY("${escapeFilterValue(criteria.property_type)}")`);
  }
  if (criteria.price_min != null) filters.push(`${priceField} >= ${criteria.price_min}`);
  if (criteria.price_max != null) filters.push(`${priceField} <= ${criteria.price_max}`);
  if (criteria.area_min != null) filters.push(`usableArea >= ${criteria.area_min}`);
  if (criteria.bedrooms_min != null) filters.push(`bedrooms >= ${criteria.bedrooms_min}`);
  if (criteria.parking_spaces_min != null) {
    filters.push(`parkingSpaces >= ${criteria.parking_spaces_min}`);
  }
  return filters.join(" AND ");
}

const escapeFilterValue = (value: string) =>
  value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

let googleAuth: GoogleAuth | undefined;

async function defaultAccessToken() {
  googleAuth ??= new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] });
  const token = await googleAuth.getAccessToken();
  if (!token) throw new Error("Não foi possível obter credenciais do Google Cloud");
  return token;
}

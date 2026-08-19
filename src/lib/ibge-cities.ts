import { isBrazilianState } from "@/lib/brazilian-states";

type IbgeMunicipality = {
  id: number;
  nome: string;
};

export type Municipality = {
  id: number;
  name: string;
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const municipalityCache = new Map<
  string,
  { expiresAt: number; municipalities: Municipality[] }
>();

const normalize = (value: string) =>
  value
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");

export async function getMunicipalities(state: string) {
  const normalizedState = state.trim().toUpperCase();
  if (!isBrazilianState(normalizedState)) {
    return [];
  }

  const cached = municipalityCache.get(normalizedState);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.municipalities;
  }

  const response = await fetch(
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${normalizedState}/municipios?orderBy=nome`,
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) {
    throw new Error(`O IBGE respondeu com HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as IbgeMunicipality[];
  const municipalities = payload.map((municipality) => ({
    id: municipality.id,
    name: municipality.nome,
  }));
  municipalityCache.set(normalizedState, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    municipalities,
  });
  return municipalities;
}

export async function searchMunicipalities(
  state: string,
  query: string,
  limit = 12,
) {
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length < 2) return [];
  const municipalities = await getMunicipalities(state);
  return municipalities
    .map((municipality) => ({
      municipality,
      normalizedName: normalize(municipality.name),
    }))
    .filter(({ normalizedName }) => normalizedName.includes(normalizedQuery))
    .sort((left, right) => {
      const leftStarts = left.normalizedName.startsWith(normalizedQuery);
      const rightStarts = right.normalizedName.startsWith(normalizedQuery);
      if (leftStarts !== rightStarts) return leftStarts ? -1 : 1;
      return left.municipality.name.localeCompare(
        right.municipality.name,
        "pt-BR",
      );
    })
    .slice(0, Math.max(1, Math.min(limit, 20)))
    .map(({ municipality }) => municipality);
}

export async function findMunicipality(state: string, city: string) {
  const normalizedCity = normalize(city);
  const municipalities = await getMunicipalities(state);
  return municipalities.find(
    (municipality) => normalize(municipality.name) === normalizedCity,
  );
}

export function clearMunicipalityCacheForTests() {
  municipalityCache.clear();
}

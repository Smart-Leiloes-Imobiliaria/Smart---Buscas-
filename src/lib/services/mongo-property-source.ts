import { MongoClient, type Document, type Filter } from "mongodb";

import type { PropertySearch } from "@/lib/services/property-searches";
import type { PropertyCardData } from "@/lib/types";

const DEFAULT_DATABASE = "smart_app";
const DEFAULT_COLLECTION_CANDIDATES = [
  "imoveis",
  "properties",
  "real_estate_properties",
  "listings",
  "anuncios",
];
const INTERNAL_SOURCE = "Banco interno";

type MongoPropertyCandidate = {
  id: string;
  title: string;
  imageUrl: string | null;
  href: string;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  price: number | null;
  usableArea: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parkingSpaces: number | null;
  propertyType: string | null;
  transaction: string | null;
  description: string | null;
  address: string | null;
  amenities: string[];
};

export type MongoPropertySourceResult = {
  properties: PropertyCardData[];
  error?: string;
};

let clientPromise: Promise<MongoClient> | undefined;

export function resetMongoPropertySourceForTests() {
  clientPromise = undefined;
}

export async function searchMongoProperties(
  search: PropertySearch,
  limit = 3,
): Promise<MongoPropertySourceResult> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) return { properties: [] };

  return withTimeout(searchMongoPropertiesUnsafe(uri, search, limit), mongoTimeoutMs() + 1_000)
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Fonte MongoDB indisponível:", message);
      return {
        properties: [],
        error: "Banco interno indisponível no momento.",
      };
    });
}

async function searchMongoPropertiesUnsafe(
  uri: string,
  search: PropertySearch,
  limit: number,
): Promise<MongoPropertySourceResult> {
    const client = await mongoClient(uri);
    const database = client.db(process.env.MONGODB_DATABASE?.trim() || DEFAULT_DATABASE);
    const collectionName = await resolveCollectionName(database);
    if (!collectionName) return { properties: [] };

    const collection = database.collection(collectionName);
    const candidates = await collection
      .find(buildMongoCandidateFilter(search, collectionName), {
        limit: Number(process.env.MONGODB_CANDIDATE_LIMIT ?? 80),
        maxTimeMS: mongoTimeoutMs(),
        projection: mongoPropertyProjection(),
      })
      .toArray();

    const ranked = candidates
      .filter(isAvailableMongoProperty)
      .map(toMongoPropertyCandidate)
      .filter((item): item is MongoPropertyCandidate => Boolean(item))
      .map((property) => ({
        property,
        score: scoreMongoProperty(property, search),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      properties: ranked.map(({ property, score }) =>
        mongoPropertyToCardData(property, score),
      ),
    };
}

export function scoreMongoProperty(
  property: MongoPropertyCandidate,
  search: Pick<
    PropertySearch,
    | "city"
    | "state"
    | "neighborhood"
    | "transaction"
    | "propertyType"
    | "minPrice"
    | "maxPrice"
    | "minArea"
    | "maxArea"
    | "bedrooms"
  >,
) {
  let score = 0;
  let possible = 0;

  const add = (weight: number, ratio: number) => {
    possible += weight;
    score += weight * Math.max(0, Math.min(1, ratio));
  };

  add(28, textCompatibility(property.city, search.city));
  if (search.state) add(10, textCompatibility(property.state, search.state));
  if (search.neighborhood) {
    add(
      18,
      Math.max(
        textCompatibility(property.neighborhood, search.neighborhood),
        textCompatibility(property.address, search.neighborhood),
        textCompatibility(property.description, search.neighborhood),
      ),
    );
  }
  if (search.propertyType) {
    add(14, textCompatibility(property.propertyType, search.propertyType));
  }
  add(8, textCompatibility(property.transaction, search.transaction));

  if (search.bedrooms != null) {
    add(8, minimumNumberCompatibility(property.bedrooms, search.bedrooms));
  }
  if (search.minArea != null || search.maxArea != null) {
    add(7, rangeCompatibility(property.usableArea, search.minArea, search.maxArea));
  }
  if (search.minPrice != null || search.maxPrice != null) {
    add(7, rangeCompatibility(property.price, search.minPrice, search.maxPrice));
  }

  if (possible === 0) return 0;
  return Math.round((score / possible) * 100);
}

async function mongoClient(uri: string) {
  clientPromise ??= new MongoClient(uri, {
    serverSelectionTimeoutMS: mongoTimeoutMs(),
  }).connect();
  return clientPromise;
}

function mongoTimeoutMs() {
  return Number(process.env.MONGODB_TIMEOUT_MS ?? 10_000);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Tempo limite da fonte MongoDB excedido")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolveCollectionName(database: ReturnType<MongoClient["db"]>) {
  const configured = process.env.MONGODB_PROPERTIES_COLLECTION?.trim();
  if (configured) return configured;

  for (const name of DEFAULT_COLLECTION_CANDIDATES) {
    try {
      await database.collection(name).findOne({}, { projection: { _id: 1 } });
      return name;
    } catch (error) {
      if (!isUnauthorizedMongoError(error)) throw error;
    }
  }
  return null;
}

function buildMongoCandidateFilter(
  search: PropertySearch,
  collectionName?: string,
): Filter<Document> {
  if (collectionName === "imoveis") {
    const and: Filter<Document>[] = [
      { ativo: true },
      { cidade: { $in: textVariants(search.city) } },
      { estado: { $in: textVariants(search.state) } },
    ];
    const priceRange: Record<string, number> = {};
    if (search.minPrice != null) priceRange.$gte = search.minPrice;
    if (search.maxPrice != null) priceRange.$lte = search.maxPrice;
    if (Object.keys(priceRange).length) and.push({ preco_venda: priceRange });

    return { $and: and };
  }

  const or: Filter<Document>[] = [];
  const cityPattern = regexFor(search.city);
  const statePattern = regexFor(search.state);
  const neighborhoodPattern = search.neighborhood ? regexFor(search.neighborhood) : null;

  for (const field of ["city", "cidade", "address.city", "location.city"]) {
    or.push({ [field]: cityPattern });
  }
  for (const field of ["state", "uf", "estado", "address.state", "location.state", "endereco"]) {
    or.push({ [field]: statePattern });
  }
  if (neighborhoodPattern) {
    for (const field of ["neighborhood", "bairro", "address.neighborhood", "location.neighborhood", "endereco", "descricao"]) {
      or.push({ [field]: neighborhoodPattern });
    }
  }

  const availabilityClauses: Filter<Document>[] = [
    { $or: [{ ativo: true }, { active: true }, { status: "ACTIVE" }, { status: "active" }] },
    { situacao: { $not: /indisponivel|indisponível|vendido|encerrado|cancelado|desativado/i } },
  ];

  return { $and: or.length ? [...availabilityClauses, { $or: or }] : availabilityClauses };
}

function mongoPropertyProjection() {
  return {
    _id: 1,
    id: 1,
    source_id: 1,
    hdn_imovel: 1,
    codigo: 1,
    title: 1,
    titulo: 1,
    name: 1,
    nome: 1,
    descricao: 1,
    description: 1,
    caracteristicas: 1,
    cidade: 1,
    city: 1,
    estado: 1,
    state: 1,
    uf: 1,
    bairro: 1,
    neighborhood: 1,
    endereco: 1,
    address: 1,
    street: 1,
    preco_venda: 1,
    preco_avaliacao: 1,
    price: 1,
    preco: 1,
    valor: 1,
    sale_price: 1,
    rental_price: 1,
    area_construida: 1,
    area_privativa: 1,
    area_util: 1,
    area_total: 1,
    usable_area: 1,
    usableArea: 1,
    area_m2: 1,
    area: 1,
    quartos: 1,
    dormitorios: 1,
    bedrooms: 1,
    banheiros: 1,
    bathrooms: 1,
    vagas: 1,
    parking_spaces: 1,
    parkingSpaces: 1,
    tipo_imovel: 1,
    property_type: 1,
    propertyType: 1,
    tipo: 1,
    type: 1,
    modo_venda: 1,
    transaction: 1,
    transaction_type: 1,
    ativo: 1,
    active: 1,
    disponivel: 1,
    available: 1,
    status: 1,
    situacao: 1,
    site_leiloeiro: 1,
    url_leiloeiro: 1,
    link_leiloeiro: 1,
    url: 1,
    link: 1,
    sourceUrl: 1,
    href: 1,
    image_url: 1,
    imagem: 1,
    coverImage: 1,
    mainImage: 1,
    image_urls: 1,
    images: 1,
    photos: 1,
    fotos: 1,
  };
}

function toMongoPropertyCandidate(document: Document): MongoPropertyCandidate | null {
  const id = stringValue(firstValue(document, ["_id", "id", "property_id", "source_id"]));
  if (!id) return null;

  const imageUrls = arrayValue(firstValue(document, ["image_urls", "images", "photos", "fotos"]));
  const title = stringValue(firstValue(document, ["title", "titulo", "name", "nome"])) ||
    fallbackTitle(document);
  const url = specificListingUrl(document);
  if (!url) return null;

  return {
    id,
    title,
    imageUrl:
      stringValue(firstValue(document, ["image_url", "imagem", "coverImage", "mainImage"])) ||
      imageUrls[0] ||
      null,
    href: url,
    neighborhood: stringValue(firstValue(document, ["neighborhood", "bairro", "address.neighborhood", "location.neighborhood"])),
    city: stringValue(firstValue(document, ["city", "cidade", "address.city", "location.city"])),
    state: stringValue(firstValue(document, ["state", "uf", "estado", "address.state", "location.state"])),
    price: numberValue(firstValue(document, ["price", "preco", "preco_venda", "preco_avaliacao", "sale_price", "salePrice", "valor", "rental_price", "rentalPrice"])),
    usableArea: numberValue(firstValue(document, ["usable_area", "usableArea", "area_m2", "area", "areaUtil", "area_util", "area_construida", "area_privativa", "area_total"])),
    bedrooms: numberValue(firstValue(document, ["bedrooms", "quartos", "dorms", "dormitorios"])),
    bathrooms: numberValue(firstValue(document, ["bathrooms", "banheiros"])),
    parkingSpaces: numberValue(firstValue(document, ["parking_spaces", "parkingSpaces", "vagas", "garages"])),
    propertyType: stringValue(firstValue(document, ["property_type", "propertyType", "tipo_imovel", "tipo", "type"])),
    transaction: stringValue(firstValue(document, ["transaction", "transaction_type", "transactionType", "negocio", "modo_venda"])),
    description: stringValue(firstValue(document, ["description", "descricao", "caracteristicas"])),
    address: stringValue(firstValue(document, ["address", "endereco", "street", "logradouro"])),
    amenities: arrayValue(firstValue(document, ["amenities", "caracteristicas", "features"])),
  };
}

function mongoPropertyToCardData(
  property: MongoPropertyCandidate,
  matchScore: number,
): PropertyCardData {
  return {
    id: `mongo-${property.id}`,
    title: property.title,
    imageUrl: property.imageUrl,
    href: property.href,
    external: property.href.startsWith("http"),
    neighborhood: property.neighborhood,
    city: property.city,
    state: property.state,
    price: property.price,
    usableArea: property.usableArea,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    parkingSpaces: property.parkingSpaces,
    sources: [INTERNAL_SOURCE],
    favorite: false,
    matchScore,
  };
}

function fallbackTitle(document: Document) {
  const description = stringValue(firstValue(document, ["descricao", "description"]));
  if (description) return description;

  const type = stringValue(firstValue(document, ["property_type", "propertyType", "tipo_imovel", "tipo", "type"])) ||
    "Imóvel";
  const neighborhood = stringValue(firstValue(document, ["neighborhood", "bairro", "address.neighborhood", "location.neighborhood"]));
  const city = stringValue(firstValue(document, ["city", "cidade", "address.city", "location.city"]));
  return `${type} em ${neighborhood || city || "localização não informada"}`;
}

function firstValue(document: Document, paths: string[]) {
  for (const path of paths) {
    const value = path.split(".").reduce<unknown>((current, key) => {
      if (current && typeof current === "object" && key in current) {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, document);
    if (value != null && value !== "") return value;
  }
  return undefined;
}

function stringValue(value: unknown) {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  return String(value);
}

function numberValue(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number"
    ? value
    : Number(String(value).replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3})/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function arrayValue(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        return stringValue(firstValue(item as Document, ["url", "src", "href"]));
      }
      return null;
    })
    .filter((item): item is string => Boolean(item));
}

function normalized(value: string | null | undefined) {
  const text = value
    ?.trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase() ?? "";
  const aliases: Record<string, string> = {
    APARTAMENTO: "APARTMENT",
    CASA: "HOUSE",
    COMERCIAL: "COMMERCIAL",
    SALA: "COMMERCIAL",
    LOJA: "COMMERCIAL",
    VENDA: "SALE",
    LEILAO: "SALE",
    ALIENACAO: "SALE",
    ALUGUEL: "RENT",
    LOCACAO: "RENT",
  };
  return aliases[text] ?? text;
}

function textCompatibility(actual: string | null | undefined, expected: string | null | undefined) {
  const left = normalized(actual);
  const right = normalized(expected);
  if (!right) return 1;
  if (!left) return 0.35;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.8;
  return tokenOverlap(left, right);
}

function tokenOverlap(left: string, right: string) {
  const leftTokens = new Set(left.split(/\W+/).filter(Boolean));
  const rightTokens = right.split(/\W+/).filter(Boolean);
  if (!leftTokens.size || !rightTokens.length) return 0;
  const matches = rightTokens.filter((token) => leftTokens.has(token)).length;
  return matches / rightTokens.length;
}

function minimumNumberCompatibility(actual: number | null, minimum: number) {
  if (actual == null) return 0.45;
  if (actual >= minimum) return 1;
  if (minimum <= 0) return 1;
  return Math.max(0, actual / minimum);
}

function rangeCompatibility(actual: number | null, min?: number | null, max?: number | null) {
  if (actual == null) return 0.45;
  if (min != null && actual < min) return Math.max(0, 1 - (min - actual) / Math.max(min, 1));
  if (max != null && actual > max) return Math.max(0, 1 - (actual - max) / Math.max(max, 1));
  return 1;
}

function regexFor(value: string) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

function textVariants(value: string) {
  const trimmed = value.trim();
  return [...new Set([trimmed, trimmed.toUpperCase(), trimmed.toLowerCase()])];
}

function isUnauthorizedMongoError(error: unknown) {
  return error instanceof Error && /not authorized|Unauthorized/i.test(error.message);
}

function isAvailableMongoProperty(document: Document) {
  const active = firstValue(document, ["ativo", "active", "disponivel", "available"]);
  if (active === false) return false;
  if (typeof active === "string" && /^(false|0|nao|não|inativo|inactive)$/i.test(active.trim())) {
    return false;
  }

  const status = [
    stringValue(firstValue(document, ["status", "situacao", "availability", "disponibilidade"])),
    stringValue(firstValue(document, ["descricao", "description"])),
  ].filter(Boolean).join(" ");
  if (/indisponivel|indisponível|vendido|encerrado|cancelado|desativado|inativo/i.test(status)) {
    return false;
  }

  return active === true ||
    /active|ativo|available|disponivel|disponível/i.test(status);
}

function specificListingUrl(document: Document) {
  const direct = stringValue(firstValue(document, ["url", "link", "sourceUrl", "href"]));
  const auction = stringValue(firstValue(document, ["site_leiloeiro", "url_leiloeiro", "link_leiloeiro"]));
  const id = stringValue(firstValue(document, ["hdn_imovel", "codigo", "code", "source_id"]));

  if (direct && isSpecificUrl(direct, id)) return direct;
  if (auction && isSpecificUrl(auction, id)) return auction;
  return direct || auction || null;
}

function isSpecificUrl(url: string, id: string | null) {
  if (id && url.includes(id)) return true;
  return /\/(imovel|lote|sale\/detail|detail|codigo-|id=|cod=)/i.test(url);
}

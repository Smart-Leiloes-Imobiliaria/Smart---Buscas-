import { createHash } from "node:crypto";

import { z } from "zod";

export const SEARCH_PROPERTY_SCHEMA_VERSION = 1 as const;

export const propertySourceSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z][A-Z0-9_]*$/));

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();
const optionalCount = z.number().int().nonnegative().optional();
const optionalMoney = z.number().finite().nonnegative().optional();

export const searchPropertyDocumentSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,126}[a-z0-9]$|^[a-z]$/),
    schemaVersion: z.literal(SEARCH_PROPERTY_SCHEMA_VERSION),

    source: propertySourceSchema,
    sourceListingId: z.string().trim().min(1).max(512),
    externalId: optionalText(512),
    sourceId: optionalText(512),
    propertyId: optionalText(128),

    title: z.string().trim().min(1).max(1_000),
    description: optionalText(20_000),
    propertyType: optionalText(100),
    transactionTypes: z.array(z.enum(["SALE", "RENT"])).min(1).max(2),

    salePrice: optionalMoney,
    rentalPrice: optionalMoney,
    condoFee: optionalMoney,
    yearlyIptu: optionalMoney,
    currency: z.literal("BRL"),

    city: optionalText(200),
    state: optionalText(2),
    neighborhood: optionalText(200),
    zone: optionalText(200),
    street: optionalText(300),
    streetNumber: optionalText(50),
    location: z
      .object({
        latitude: z.number().finite().min(-90).max(90),
        longitude: z.number().finite().min(-180).max(180),
      })
      .strict()
      .optional(),

    bedrooms: optionalCount,
    bathrooms: optionalCount,
    suites: optionalCount,
    parkingSpaces: optionalCount,
    usableArea: optionalMoney,
    totalArea: optionalMoney,

    amenities: z.array(z.string().trim().min(1).max(100)).max(200),
    imageUrl: z.string().url().max(4_096).optional(),
    url: z.string().url().max(4_096),

    status: z.enum(["ACTIVE", "INACTIVE", "REMOVED"]),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((document, context) => {
    const expectedId = createSearchPropertyDocumentId(
      document.source,
      document.sourceListingId,
    );
    if (document.id !== expectedId) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: `ID inconsistente; esperado ${expectedId}`,
      });
    }

    const expectedTransactions = [
      document.salePrice != null ? "SALE" : undefined,
      document.rentalPrice != null ? "RENT" : undefined,
    ].filter((value): value is "SALE" | "RENT" => value != null);

    if (
      expectedTransactions.length > 0 &&
      (expectedTransactions.length !== document.transactionTypes.length ||
        expectedTransactions.some((value) => !document.transactionTypes.includes(value)))
    ) {
      context.addIssue({
        code: "custom",
        path: ["transactionTypes"],
        message: "As modalidades devem corresponder aos preços informados",
      });
    }
  });

export type SearchPropertyDocument = z.infer<typeof searchPropertyDocumentSchema>;

export type SearchPropertyDocumentInput = Omit<
  SearchPropertyDocument,
  "id" | "schemaVersion" | "source" | "transactionTypes" | "currency" | "amenities" | "status" | "updatedAt"
> & {
  source: string;
  transactionTypes?: SearchPropertyDocument["transactionTypes"];
  currency?: "BRL";
  amenities?: string[];
  status?: SearchPropertyDocument["status"];
  updatedAt?: string;
};

/**
 * Produz um ID estável e compatível com o formato RFC-1034 exigido pelo
 * Discovery Engine. IDs que já são seguros permanecem legíveis; valores que
 * exigem normalização recebem um hash para evitar colisões.
 */
export function createSearchPropertyDocumentId(source: string, sourceId: string) {
  const normalizedSource = slug(source) || "source";
  const normalizedSourceId = slug(sourceId) || "listing";
  const readableId = `${normalizedSource}-${normalizedSourceId}`;
  const rawId = `${source.trim().toLowerCase()}-${sourceId.trim().toLowerCase()}`;

  if (readableId === rawId && readableId.length <= 128) return readableId;

  const hash = createHash("sha256")
    .update(`${source.trim().toUpperCase()}\u0000${sourceId.trim()}`)
    .digest("hex")
    .slice(0, 12);
  const prefix = readableId.slice(0, 128 - hash.length - 1).replace(/-+$/, "");
  return `${prefix || "listing"}-${hash}`;
}

export function createSearchPropertyDocument(
  input: SearchPropertyDocumentInput,
): SearchPropertyDocument {
  const source = propertySourceSchema.parse(input.source);
  const transactionTypes = input.transactionTypes ?? [
    input.salePrice != null ? "SALE" : undefined,
    input.rentalPrice != null ? "RENT" : undefined,
  ].filter((value): value is "SALE" | "RENT" => value != null);

  if (transactionTypes.length === 0) {
    throw new Error("Informe ao menos uma modalidade ou um preço de venda/aluguel");
  }

  return searchPropertyDocumentSchema.parse({
    ...input,
    id: createSearchPropertyDocumentId(source, input.sourceListingId),
    schemaVersion: SEARCH_PROPERTY_SCHEMA_VERSION,
    source,
    transactionTypes: [...new Set(transactionTypes)],
    currency: input.currency ?? "BRL",
    amenities: [...new Set((input.amenities ?? []).map((value) => value.trim().toUpperCase()))]
      .filter(Boolean)
      .sort(),
    status: input.status ?? "ACTIVE",
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  });
}

export type DiscoveryEnginePropertyDocument = {
  id: string;
  structData: Omit<SearchPropertyDocument, "id">;
};

export function toDiscoveryEngineDocument(
  input: SearchPropertyDocument,
): DiscoveryEnginePropertyDocument {
  const { id, ...structData } = searchPropertyDocumentSchema.parse(input);
  return { id, structData };
}

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Schema a ser aplicado em Smart-Dados-Pesquisa antes da primeira carga. */
export const SEARCH_PROPERTY_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  datetime_detection: true,
  geolocation_detection: true,
  type: "object",
  required: [
    "schemaVersion",
    "source",
    "sourceListingId",
    "title",
    "transactionTypes",
    "currency",
    "amenities",
    "url",
    "status",
    "updatedAt",
  ],
  properties: {
    schemaVersion: field("integer", { retrievable: true }),
    source: facet("string"),
    sourceListingId: field("string", { indexable: true, retrievable: true }),
    externalId: field("string", { indexable: true, retrievable: true }),
    sourceId: field("string", { indexable: true, retrievable: true }),
    propertyId: field("string", { indexable: true, retrievable: true }),
    title: field("string", {
      keyPropertyMapping: "title",
      retrievable: true,
      completable: true,
    }),
    description: field("string", {
      keyPropertyMapping: "description",
      retrievable: true,
    }),
    propertyType: facet("string"),
    transactionTypes: arrayFacet(),
    salePrice: numericFacet(),
    rentalPrice: numericFacet(),
    condoFee: numericField(),
    yearlyIptu: numericField(),
    currency: field("string", { indexable: true, retrievable: true }),
    city: textFacet(true),
    state: facet("string"),
    neighborhood: textFacet(true),
    zone: textFacet(),
    street: field("string", { searchable: true, retrievable: true }),
    streetNumber: field("string", { retrievable: true }),
    location: field("geolocation", { indexable: true, retrievable: true }),
    bedrooms: numericFacet("integer"),
    bathrooms: numericFacet("integer"),
    suites: numericFacet("integer"),
    parkingSpaces: numericFacet("integer"),
    usableArea: numericFacet(),
    totalArea: numericField(),
    amenities: arrayFacet(true),
    imageUrl: field("string", { retrievable: true }),
    url: field("string", { keyPropertyMapping: "uri", retrievable: true }),
    status: facet("string"),
    updatedAt: field("datetime", {
      keyPropertyMapping: "update_time",
      retrievable: true,
    }),
  },
  additionalProperties: false,
} as const;

type SearchFieldType = "string" | "number" | "integer" | "datetime" | "geolocation";
type SearchFieldOptions = Partial<{
  indexable: boolean;
  searchable: boolean;
  retrievable: boolean;
  dynamicFacetable: boolean;
  completable: boolean;
  keyPropertyMapping: "title" | "description" | "uri" | "update_time";
}>;

function field(type: SearchFieldType, options: SearchFieldOptions = {}) {
  return { type, ...options };
}

function facet(type: "string" | "integer" | "number") {
  return field(type, { indexable: true, retrievable: true, dynamicFacetable: true });
}

function textFacet(completable = false) {
  return field("string", {
    indexable: true,
    searchable: true,
    retrievable: true,
    dynamicFacetable: true,
    completable,
  });
}

function numericField() {
  return field("number", { indexable: true, retrievable: true });
}

function numericFacet(type: "number" | "integer" = "number") {
  return facet(type);
}

function arrayFacet(searchable = false) {
  return {
    type: "array",
    items: {
      type: "string",
      indexable: true,
      retrievable: true,
      dynamicFacetable: true,
      searchable,
    },
  } as const;
}

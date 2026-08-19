import { createHash } from "node:crypto";

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import type { PublicPageScopeConfig, PublicPageSourceConfig } from "@/lib/collection/config";
import type { NormalizedListing } from "@/lib/types";

export type CollectedPage = {
  url: string;
  rawItems: Record<string, unknown>[];
  items: NormalizedListing[];
};

export type CollectionBatch = {
  pagesProcessed: number;
  complete: boolean;
  stopReason: "EMPTY_PAGE" | "MAX_PAGES";
  pages: CollectedPage[];
};

type FetchLike = typeof fetch;
type Selectors = NonNullable<PublicPageScopeConfig["selectors"]>;
type FieldSelector = Selectors[keyof Omit<Selectors, "card">];

export class PublicPageCollector {
  private robots = new Map<string, string>();

  constructor(
    private source: PublicPageSourceConfig,
    private userAgent: string,
    private contact: string,
    private fetchImpl: FetchLike = fetch,
  ) {}

  async collect(scope: PublicPageScopeConfig): Promise<CollectionBatch> {
    const pages: CollectedPage[] = [];
    let stoppedOnEmpty = false;

    for (let offset = 0; offset < scope.maxPages; offset += 1) {
      const pageNumber = scope.pageStart + offset;
      const url = scope.searchUrl.replaceAll("{page}", String(pageNumber));
      if (offset > 0 && this.source.requestDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.source.requestDelayMs));
      }
      const html = await this.fetchHtml(url);
      const rawItems = parsePage(html, scope, url);
      const items = rawItems.map((raw) => normalizeRawListing(raw, this.source.code, scope, url));
      pages.push({ url, rawItems, items });
      if (items.length === 0) {
        stoppedOnEmpty = true;
        break;
      }
    }

    return {
      pagesProcessed: pages.length,
      complete: stoppedOnEmpty,
      stopReason: stoppedOnEmpty ? "EMPTY_PAGE" : "MAX_PAGES",
      pages,
    };
  }

  private async fetchHtml(rawUrl: string) {
    const url = this.assertAllowed(rawUrl);
    await this.assertRobotsAllowed(url);
    const response = await this.fetchImpl(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": `${this.userAgent} (${this.contact})`,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(this.source.timeoutMs),
    });
    this.assertAllowed(response.url || url.href);
    if (!response.ok) throw new Error(`Página respondeu HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new Error(`Conteúdo inesperado: ${contentType || "sem Content-Type"}`);
    }
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > this.source.maxResponseBytes) throw new Error("Página excede o limite configurado");
    const html = await response.text();
    if (Buffer.byteLength(html) > this.source.maxResponseBytes) {
      throw new Error("Página excede o limite configurado");
    }
    return html;
  }

  private assertAllowed(rawUrl: string) {
    const url = new URL(rawUrl);
    if (!(["http:", "https:"] as string[]).includes(url.protocol)) {
      throw new Error(`Protocolo não permitido: ${url.protocol}`);
    }
    if (!this.source.allowedHosts.includes(url.hostname.toLowerCase())) {
      throw new Error(`Host fora da lista permitida: ${url.hostname}`);
    }
    return url;
  }

  private async assertRobotsAllowed(url: URL) {
    const origin = url.origin;
    let rules = this.robots.get(origin);
    if (rules == null) {
      const robotsUrl = new URL("/robots.txt", origin);
      const response = await this.fetchImpl(robotsUrl, {
        headers: { "user-agent": `${this.userAgent} (${this.contact})` },
        signal: AbortSignal.timeout(this.source.timeoutMs),
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`Não foi possível verificar robots.txt: HTTP ${response.status}`);
      }
      rules = response.status === 404 ? "" : await response.text();
      this.robots.set(origin, rules);
    }
    if (!robotsAllows(rules, url.pathname, this.userAgent)) {
      throw new Error(`Coleta não permitida por robots.txt: ${url.pathname}`);
    }
  }
}

export function parsePage(html: string, scope: PublicPageScopeConfig, pageUrl: string) {
  const $ = cheerio.load(html);
  if (scope.parser !== "HTML") {
    const jsonItems = parseJsonLd($, pageUrl);
    if (jsonItems.length > 0 || scope.parser === "JSON_LD") return jsonItems;
  }
  if (!scope.selectors) return [];
  return parseHtmlCards($, scope.selectors, pageUrl);
}

function parseJsonLd($: cheerio.CheerioAPI, pageUrl: string) {
  const items: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const parsed = JSON.parse($(element).text()) as unknown;
      for (const value of jsonLdCandidates(parsed)) {
        const item = unwrapJsonLd(value);
        if (item && typeof item === "object") {
          items.push({ ...(item as Record<string, unknown>), _pageUrl: pageUrl });
        }
      }
    } catch {
      // Um bloco inválido não impede que outros blocos válidos sejam usados.
    }
  });
  return uniqueRaw(items);
}

function jsonLdCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(jsonLdCandidates);
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  if (Array.isArray(object.itemListElement)) return object.itemListElement;
  if (Array.isArray(object["@graph"])) return (object["@graph"] as unknown[]).flatMap(jsonLdCandidates);
  const type = Array.isArray(object["@type"]) ? object["@type"] : [object["@type"]];
  const listingTypes = new Set(["Product", "Offer", "Apartment", "House", "SingleFamilyResidence", "Residence", "Accommodation"]);
  return type.some((item) => listingTypes.has(String(item))) ? [object] : [];
}

function unwrapJsonLd(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  const item = object.item;
  return item && typeof item === "object"
    ? { ...(item as Record<string, unknown>), position: object.position }
    : object;
}

function parseHtmlCards($: cheerio.CheerioAPI, selectors: Selectors, pageUrl: string) {
  const items: Record<string, unknown>[] = [];
  $(selectors.card).each((_, element) => {
    const card = $(element);
    const read = (field: FieldSelector) => readField(card, field);
    items.push({
      externalId: read(selectors.externalId),
      title: read(selectors.title),
      description: read(selectors.description),
      url: absoluteUrl(read(selectors.url), pageUrl),
      salePrice: read(selectors.salePrice),
      rentalPrice: read(selectors.rentalPrice),
      condoFee: read(selectors.condoFee),
      yearlyIptu: read(selectors.yearlyIptu),
      city: read(selectors.city),
      state: read(selectors.state),
      neighborhood: read(selectors.neighborhood),
      zone: read(selectors.zone),
      street: read(selectors.street),
      streetNumber: read(selectors.streetNumber),
      latitude: read(selectors.latitude),
      longitude: read(selectors.longitude),
      bedrooms: read(selectors.bedrooms),
      bathrooms: read(selectors.bathrooms),
      suites: read(selectors.suites),
      parkingSpaces: read(selectors.parkingSpaces),
      usableArea: read(selectors.usableArea),
      totalArea: read(selectors.totalArea),
      amenities: read(selectors.amenities),
      imageUrl: absoluteUrl(read(selectors.imageUrl), pageUrl),
      propertyType: read(selectors.propertyType),
      _pageUrl: pageUrl,
    });
  });
  return uniqueRaw(items);
}

function readField(card: cheerio.Cheerio<AnyNode>, field?: FieldSelector) {
  if (!field) return undefined;
  const selector = typeof field === "string" ? field : field.selector;
  const selected = selector === ":scope" ? card : card.find(selector).first();
  const attribute = typeof field === "string" ? undefined : field.attribute;
  return (attribute ? selected.attr(attribute) : selected.text())?.trim() || undefined;
}

export function normalizeRawListing(
  raw: Record<string, unknown>,
  sourceCode: string,
  scope: PublicPageScopeConfig,
  pageUrl: string,
): NormalizedListing {
  const offers = objectValue(raw.offers);
  const address = objectValue(raw.address);
  const geo = objectValue(raw.geo);
  const floorSize = objectValue(raw.floorSize);
  const url = absoluteUrl(textValue(raw.url) ?? textValue(raw["@id"]), pageUrl);
  if (!url) throw new Error("Anúncio sem URL válida");
  const title = textValue(raw.title) ?? textValue(raw.name) ?? textValue(raw.headline);
  if (!title) throw new Error(`Anúncio sem título em ${url}`);
  const externalId = textValue(raw.externalId) ?? textValue(raw.sku) ?? textValue(raw.productID)
    ?? stableIdFromUrl(url);
  const salePrice = money(raw.salePrice ?? offers.price);
  const rentalPrice = money(raw.rentalPrice);
  const transaction = rentalPrice != null && salePrice == null ? "RENT" : scope.transaction;
  const price = transaction === "RENT" ? rentalPrice : salePrice;
  if (price == null) throw new Error(`Anúncio sem preço em ${url}`);
  const images = stringList(raw.image ?? raw.images ?? raw.imageUrl)
    .map((value) => absoluteUrl(value, pageUrl)).filter((value): value is string => Boolean(value));
  const amenities = stringList(raw.amenities).flatMap((value) => value.split(/[,;|]/))
    .map((value) => value.trim().toUpperCase()).filter(Boolean);
  const street = textValue(raw.street) ?? textValue(address.streetAddress);
  const city = textValue(raw.city) ?? textValue(address.addressLocality) ?? scope.city;
  const neighborhood = textValue(raw.neighborhood) ?? scope.neighborhoods[0] ?? "Não informado";

  return {
    source_code: sourceCode,
    external_id: externalId,
    url,
    title,
    property_type: normalizePropertyType(textValue(raw.propertyType) ?? typeValue(raw["@type"]) ?? scope.propertyType),
    transaction_type: transaction,
    city,
    state: (textValue(raw.state) ?? textValue(address.addressRegion) ?? scope.state)?.toUpperCase() ?? null,
    neighborhood,
    zone: textValue(raw.zone) ?? null,
    street: street ?? null,
    street_number: textValue(raw.streetNumber) ?? null,
    normalized_address: [street, textValue(raw.streetNumber), neighborhood, city].filter(Boolean).join(", ").toLowerCase(),
    latitude: decimal(raw.latitude ?? geo.latitude),
    longitude: decimal(raw.longitude ?? geo.longitude),
    area_m2: decimal(raw.usableArea ?? floorSize.value),
    total_area_m2: decimal(raw.totalArea),
    bedrooms: integer(raw.bedrooms ?? raw.numberOfRooms),
    bathrooms: integer(raw.bathrooms ?? raw.numberOfBathroomsTotal),
    suites: integer(raw.suites),
    parking_spaces: integer(raw.parkingSpaces),
    amenities: [...new Set(amenities)],
    image_urls: [...new Set(images)],
    price,
    condo_fee: money(raw.condoFee) ?? 0,
    yearly_iptu: money(raw.yearlyIptu),
    image_url: images[0] ?? null,
    description: textValue(raw.description) ?? null,
  };
}

export function robotsAllows(content: string, pathname: string, userAgent: string) {
  const agentToken = userAgent.split(/[\s/]/)[0].toLowerCase();
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let group: (typeof groups)[number] | undefined;
  let hasRules = false;
  for (const original of content.split(/\r?\n/)) {
    const line = original.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (!group || hasRules) {
        group = { agents: [], rules: [] };
        groups.push(group);
        hasRules = false;
      }
      group.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && group) {
      hasRules = true;
      if (value) group.rules.push({ allow: key === "allow", path: value });
    }
  }
  const exact = groups.filter((item) => item.agents.some((agent) => agent === agentToken));
  const applicable = exact.length ? exact : groups.filter((item) => item.agents.includes("*"));
  const matches = applicable.flatMap((item) => item.rules).filter((rule) => pathname.startsWith(rule.path));
  matches.sort((left, right) => right.path.length - left.path.length || Number(right.allow) - Number(left.allow));
  return matches[0]?.allow ?? true;
}

const objectValue = (value: unknown) => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const textValue = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
const typeValue = (value: unknown) => Array.isArray(value) ? textValue(value[0]) : textValue(value);
const stringList = (value: unknown): string[] => Array.isArray(value)
  ? value.flatMap(stringList)
  : textValue(typeof value === "object" && value ? (value as Record<string, unknown>).url : value)
    ? [textValue(typeof value === "object" && value ? (value as Record<string, unknown>).url : value)!]
    : [];
const integer = (value: unknown) => {
  const parsed = decimal(value);
  return parsed == null ? null : Math.trunc(parsed);
};
const decimal = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = textValue(value);
  if (!raw) return null;
  const match = raw.match(/-?\d[\d.,]*/)?.[0];
  if (!match) return null;
  const normalized = match.includes(",") ? match.replaceAll(".", "").replace(",", ".") : match;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};
const money = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const raw = textValue(value);
  if (!raw) return null;
  const numeric = raw.replace(/[^\d.,-]/g, "");
  let normalized: string;
  if (numeric.includes(",")) {
    normalized = numeric.replaceAll(".", "").replace(",", ".");
  } else {
    const dots = numeric.match(/\./g)?.length ?? 0;
    normalized = dots === 1 && /\.\d{1,2}$/.test(numeric)
      ? numeric
      : numeric.replaceAll(".", "");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const absoluteUrl = (value: string | undefined, base: string) => {
  if (!value) return undefined;
  try { return new URL(value, base).href; } catch { return undefined; }
};
const stableIdFromUrl = (url: string) => createHash("sha256").update(url).digest("hex").slice(0, 24);
const normalizePropertyType = (value: string) => {
  const normalized = value.toUpperCase();
  if (normalized.includes("HOUSE") || normalized.includes("CASA")) return "HOUSE";
  if (normalized.includes("LAND") || normalized.includes("TERRENO")) return "LAND";
  if (normalized.includes("PENTHOUSE") || normalized.includes("COBERTURA")) return "PENTHOUSE";
  return "APARTMENT";
};
const uniqueRaw = (items: Record<string, unknown>[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = textValue(item.url) ?? textValue(item["@id"]) ?? JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

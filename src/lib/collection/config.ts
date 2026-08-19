import fs from "node:fs/promises";

import { z } from "zod";

const fieldSelectorSchema = z.union([
  z.string().min(1),
  z.object({ selector: z.string().min(1), attribute: z.string().min(1).optional() }).strict(),
]);

const selectorsSchema = z
  .object({
    card: z.string().min(1),
    externalId: fieldSelectorSchema.optional(),
    title: fieldSelectorSchema,
    description: fieldSelectorSchema.optional(),
    url: fieldSelectorSchema,
    salePrice: fieldSelectorSchema.optional(),
    rentalPrice: fieldSelectorSchema.optional(),
    condoFee: fieldSelectorSchema.optional(),
    yearlyIptu: fieldSelectorSchema.optional(),
    city: fieldSelectorSchema.optional(),
    state: fieldSelectorSchema.optional(),
    neighborhood: fieldSelectorSchema.optional(),
    zone: fieldSelectorSchema.optional(),
    street: fieldSelectorSchema.optional(),
    streetNumber: fieldSelectorSchema.optional(),
    latitude: fieldSelectorSchema.optional(),
    longitude: fieldSelectorSchema.optional(),
    bedrooms: fieldSelectorSchema.optional(),
    bathrooms: fieldSelectorSchema.optional(),
    suites: fieldSelectorSchema.optional(),
    parkingSpaces: fieldSelectorSchema.optional(),
    usableArea: fieldSelectorSchema.optional(),
    totalArea: fieldSelectorSchema.optional(),
    amenities: fieldSelectorSchema.optional(),
    imageUrl: fieldSelectorSchema.optional(),
    propertyType: fieldSelectorSchema.optional(),
  })
  .strict();

export const collectionConfigSchema = z
  .object({
    userAgent: z.string().min(1),
    contact: z.string().min(1),
    sources: z.array(
      z
        .object({
          code: z.string().regex(/^[a-z][a-z0-9_-]*$/),
          allowedHosts: z.array(z.string().min(1)).min(1),
          requestDelayMs: z.number().int().min(0).default(1_000),
          timeoutMs: z.number().int().min(1_000).max(120_000).default(20_000),
          maxResponseBytes: z.number().int().min(1_024).default(5_000_000),
          suspiciousDropRatio: z.number().min(0).max(1).default(0.7),
          minimumBaselineForDropDetection: z.number().int().min(1).default(10),
          scopes: z.array(
            z
              .object({
                key: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
                searchUrl: z.string().url().refine((value) => value.includes("{page}"), {
                  message: "searchUrl precisa conter {page}",
                }),
                pageStart: z.number().int().nonnegative().default(1),
                maxPages: z.number().int().min(1).max(1_000).default(20),
                transaction: z.enum(["SALE", "RENT"]).default("SALE"),
                city: z.string().min(1),
                state: z.string().length(2).optional(),
                neighborhoods: z.array(z.string().min(1)).default([]),
                propertyType: z.string().min(1).default("APARTMENT"),
                parser: z.enum(["AUTO", "JSON_LD", "HTML"]).default("AUTO"),
                selectors: selectorsSchema.optional(),
              })
              .strict()
              .refine((scope) => scope.parser !== "HTML" || scope.selectors != null, {
                message: "selectors é obrigatório para parser HTML",
              }),
          ).min(1),
        })
        .strict(),
    ).min(1),
  })
  .strict();

export type CollectionConfig = z.infer<typeof collectionConfigSchema>;
export type PublicPageSourceConfig = CollectionConfig["sources"][number];
export type PublicPageScopeConfig = PublicPageSourceConfig["scopes"][number];

export async function loadCollectionConfig(filePath = process.env.COLLECTOR_CONFIG_PATH) {
  if (!filePath) throw new Error("Defina COLLECTOR_CONFIG_PATH com o arquivo de fontes");
  return collectionConfigSchema.parse(JSON.parse(await fs.readFile(filePath, "utf8")));
}

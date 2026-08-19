import { z } from "zod";

const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.coerce.number().pipe(schema).optional(),
  );

const optionalText = z.preprocess(
  (value) => (value === "" || value == null ? undefined : value),
  z.string().trim().min(1).optional(),
);

export const searchCriteriaSchema = z
  .object({
    city: z.string().trim().min(1),
    neighborhoods: z.array(z.string().trim().min(1)).default([]),
    transaction: z.enum(["SALE", "RENT"]).default("SALE"),
    property_type: z.string().trim().min(1).nullable().optional(),
    price_min: z.number().nonnegative().nullable().optional(),
    price_max: z.number().nonnegative().nullable().optional(),
    area_min: z.number().nonnegative().nullable().optional(),
    bedrooms_min: z.number().int().nonnegative().nullable().optional(),
    parking_spaces_min: z.number().int().nonnegative().nullable().optional(),
  })
  .refine(
    (value) =>
      value.price_min == null ||
      value.price_max == null ||
      value.price_min <= value.price_max,
    { message: "O preço mínimo não pode ser maior que o máximo" },
  );

export const favoriteInputSchema = z.object({
  property_id: z.string().min(1),
  notes: z.string().nullable().optional(),
});

export const sourceUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    priority: z.number().int().min(0).max(100).optional(),
    max_results: z.number().int().min(1).max(500).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nenhuma alteração informada");

export const reviewDecisionSchema = z.object({
  decision: z.enum(["GROUP", "SEPARATE"]),
});

export const propertyTransactionSchema = z.enum(["SALE", "RENT"]);

export const propertySearchRequestSchema = z
  .object({
    city: z.string().trim().min(1),
    state: z.string().trim().min(2).max(40),
    neighborhood: optionalText,
    transaction: propertyTransactionSchema.default("SALE"),
    propertyType: optionalText,
    minPrice: optionalNumber(z.number().nonnegative()),
    maxPrice: optionalNumber(z.number().nonnegative()),
    minArea: optionalNumber(z.number().positive()),
    maxArea: optionalNumber(z.number().positive()),
    bedrooms: optionalNumber(z.number().int().nonnegative()),
  })
  .refine(
    (value) =>
      value.minPrice == null ||
      value.maxPrice == null ||
      value.minPrice <= value.maxPrice,
    {
      message: "O preço mínimo não pode ser maior que o máximo",
      path: ["minPrice"],
    },
  )
  .refine(
    (value) =>
      value.minArea == null ||
      value.maxArea == null ||
      value.minArea <= value.maxArea,
    {
      message: "A área mínima não pode ser maior que a máxima",
      path: ["minArea"],
    },
  );

export const collectorPropertyFiltersSchema = z
  .object({
    city: optionalText,
    state: optionalText,
    neighborhood: optionalText,
    transaction: propertyTransactionSchema.default("SALE"),
    propertyType: optionalText,
    minPrice: optionalNumber(z.number().nonnegative()),
    maxPrice: optionalNumber(z.number().nonnegative()),
    minArea: optionalNumber(z.number().positive()),
    maxArea: optionalNumber(z.number().positive()),
    bedrooms: optionalNumber(z.number().int().nonnegative()),
    limit: optionalNumber(z.number().int().positive()).default(20),
    offset: optionalNumber(z.number().int().nonnegative()).default(0),
  })
  .refine(
    (value) =>
      value.minPrice == null ||
      value.maxPrice == null ||
      value.minPrice <= value.maxPrice,
    {
      message: "O preço mínimo não pode ser maior que o máximo",
      path: ["minPrice"],
    },
  )
  .refine(
    (value) =>
      value.minArea == null ||
      value.maxArea == null ||
      value.minArea <= value.maxArea,
    {
      message: "A área mínima não pode ser maior que a máxima",
      path: ["minArea"],
    },
  );

export type SearchCriteria = z.infer<typeof searchCriteriaSchema>;
export type CollectorPropertyFilters = z.infer<
  typeof collectorPropertyFiltersSchema
>;
export type PropertySearchRequest = z.infer<typeof propertySearchRequestSchema>;

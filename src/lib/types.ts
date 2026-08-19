export type PropertyRow = {
  id: string;
  title?: string | null;
  property_type: string;
  transaction_type: "SALE" | "RENT";
  city: string;
  neighborhood: string;
  state?: string | null;
  zone?: string | null;
  street?: string | null;
  street_number?: string | null;
  normalized_address: string | null;
  latitude: number | null;
  longitude: number | null;
  area_m2: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  suites?: number | null;
  parking_spaces: number | null;
  total_area_m2?: number | null;
  amenities?: string[];
  image_urls?: string[];
  description: string | null;
  image_url: string | null;
  price?: number;
  condo_fee?: number;
  source_count?: number;
  sources?: string | string[];
  favorite?: number | boolean;
  match_score?: number;
  reasons?: string | string[];
};

export type NormalizedListing = Omit<PropertyRow, "id"> & {
  source_code: string;
  external_id: string;
  url: string;
  price: number;
  condo_fee: number;
  yearly_iptu?: number | null;
};

export type PropertyTransaction = "SALE" | "RENT";

export type CollectorPropertyRow = {
  id: number;
  source: string;
  source_id: string;
  title: string | null;
  advertiser_name: string | null;
  description: string | null;
  sale_price: number | string | null;
  rental_price: number | string | null;
  city: string | null;
  state: string | null;
  neighborhood: string | null;
  street: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  suites: number | null;
  parking_spaces: number | null;
  usable_area: number | string | null;
  total_area: number | string | null;
  condominium_fee: number | string | null;
  iptu: number | string | null;
  property_type: string | null;
  image_url: string | null;
  image_urls: unknown;
  url: string;
  country: string | null;
  date_posted: Date | string | null;
  status: string;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
};

export type CollectorProperty = Omit<
  CollectorPropertyRow,
  | "sale_price"
  | "rental_price"
  | "usable_area"
  | "total_area"
  | "condominium_fee"
  | "iptu"
  | "image_urls"
  | "date_posted"
  | "first_seen_at"
  | "last_seen_at"
  | "created_at"
  | "updated_at"
> & {
  sale_price: number | null;
  rental_price: number | null;
  price: number | null;
  transaction: PropertyTransaction;
  usable_area: number | null;
  total_area: number | null;
  condominium_fee: number | null;
  iptu: number | null;
  image_urls: string[];
  sourceUrl: string;
  date_posted: string | null;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

export type PropertyCardData = {
  id: string;
  title: string;
  imageUrl: string | null;
  href: string;
  external: boolean;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  price: number | null;
  usableArea: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parkingSpaces: number | null;
  sources: string[];
  favorite: boolean;
  favoritePropertyId?: string;
  matchScore?: number;
};

export type PropertySearchStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED";

export type PropertySearchRow = {
  id: string;
  search_key: string;
  criteria: Record<string, unknown>;
  city: string;
  state: string;
  neighborhood: string | null;
  transaction: PropertyTransaction;
  property_type: string | null;
  min_price: number | string | null;
  max_price: number | string | null;
  min_area: number | string | null;
  max_area: number | string | null;
  bedrooms: number | null;
  status: PropertySearchStatus;
  properties_found: number;
  attempts: number;
  collector_version: string;
  error_message: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  next_attempt_at: Date | string | null;
  last_heartbeat_at: Date | string | null;
  updated_at: Date | string;
};

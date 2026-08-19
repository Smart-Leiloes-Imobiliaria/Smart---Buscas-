import type { SearchCriteria } from "@/lib/schemas";
import type { NormalizedListing } from "@/lib/types";

export interface DiscoveredListing {
  external_id: string;
  key: string;
  url: string;
  metadata?: Record<string, unknown>;
}

export interface PropertySourceConnector {
  code: string;
  search(criteria: SearchCriteria): Promise<DiscoveredListing[]>;
  fetch(discovered: DiscoveredListing): Promise<Record<string, unknown>>;
  normalize(raw: Record<string, unknown>): NormalizedListing;
  configured(): boolean;
}

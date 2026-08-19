import type { Pool } from "pg";

import { demoConnectors } from "@/lib/connectors/demo";
import { ingest } from "@/lib/services/ingestion";

export async function seedDemoListings(database: Pool) {
  let processed = 0;
  for (const connector of Object.values(demoConnectors)) {
    const discovered = await connector.search({
      city: "Belo Horizonte",
      neighborhoods: [],
      transaction: "SALE",
    });
    for (const item of discovered) {
      const raw = await connector.fetch(item);
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        await ingest(client, connector.code, raw, connector.normalize(raw));
        await client.query("COMMIT");
        processed += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  }
  return processed;
}

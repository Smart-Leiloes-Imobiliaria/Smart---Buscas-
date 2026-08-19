import fs from "node:fs/promises";
import path from "node:path";
import { Pool, types, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

import { config } from "@/lib/config";

types.setTypeParser(20, Number);
types.setTypeParser(1700, Number);

export interface SqlExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

const sources = [
  ["zap", "ZAP Imóveis", "PORTAL_ADAPTER", "AUTHORIZED_GATEWAY", 100, 50, "DEMO"],
  ["vivareal", "Viva Real", "PORTAL_ADAPTER", "AUTHORIZED_GATEWAY", 90, 50, "DEMO"],
  ["imovelweb", "Imovelweb", "PORTAL_ADAPTER", "AUTHORIZED_GATEWAY", 80, 50, "DEMO"],
  ["casamineira", "Casa Mineira", "PORTAL_ADAPTER", "AUTHORIZED_GATEWAY", 70, 50, "DEMO"],
  ["olx", "OLX Imóveis", "PORTAL_ADAPTER", "AUTHORIZED_GATEWAY", 60, 50, "DEMO"],
  ["quintoandar", "QuintoAndar", "PORTAL_ADAPTER", "AUTHORIZED_GATEWAY", 50, 50, "DEMO"],
  ["lopes", "Lopes", "PORTAL_ADAPTER", "AUTHORIZED_GATEWAY", 40, 50, "HEALTHY"],
  ["chavesnamao", "Chaves na Mão", "PORTAL_ADAPTER", "AUTHORIZED_GATEWAY", 30, 50, "HEALTHY"],
] as const;

declare global {
  // eslint-disable-next-line no-var
  var moradaPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var moradaInitialization: Promise<void> | undefined;
}

function pool() {
  if (!globalThis.moradaPool) {
    const databaseHost = process.env.INSTANCE_UNIX_SOCKET || process.env.DB_HOST;
    globalThis.moradaPool = new Pool({
      ...(databaseHost
        ? {
            host: databaseHost,
            port: Number(process.env.DB_PORT ?? 5432),
            database: process.env.DB_NAME ?? "morada",
            user: process.env.DB_USER ?? "morada_app",
            password: process.env.DB_PASSWORD,
          }
        : { connectionString: config.databaseUrl }),
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl:
        process.env.DATABASE_SSL === "true" && !process.env.INSTANCE_UNIX_SOCKET
          ? { rejectUnauthorized: false }
          : undefined,
    });
  }
  return globalThis.moradaPool;
}

async function initialize(database: Pool) {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('morada_migrations'))");
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migration (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    const appliedResult = await client.query<{ name: string }>("SELECT name FROM schema_migration");
    const applied = new Set(appliedResult.rows.map((row) => row.name));
    const migrationDirectory = path.join(process.cwd(), "db", "migrations");
    const migrations = (await fs.readdir(migrationDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const migration of migrations) {
      if (applied.has(migration)) continue;
      await client.query(await fs.readFile(path.join(migrationDirectory, migration), "utf8"));
      await client.query("INSERT INTO schema_migration(name) VALUES ($1)", [migration]);
    }
    for (const source of sources) {
      await client.query(
        `INSERT INTO source
          (code, name, discovery_method, fetch_method, priority, max_results, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (code) DO UPDATE SET
           name=EXCLUDED.name,
           discovery_method=EXCLUDED.discovery_method,
           fetch_method=EXCLUDED.fetch_method`,
        [...source],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function db(): Promise<Pool> {
  const database = pool();
  globalThis.moradaInitialization ??= initialize(database);
  try {
    await globalThis.moradaInitialization;
  } catch (error) {
    globalThis.moradaInitialization = undefined;
    throw error;
  }
  return database;
}

export async function withTransaction<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await (await db()).connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDatabaseForTests() {
  await globalThis.moradaPool?.end();
  globalThis.moradaPool = undefined;
  globalThis.moradaInitialization = undefined;
}

export function setDatabasePoolForTests(database: Pool) {
  globalThis.moradaPool = database;
  globalThis.moradaInitialization = undefined;
}

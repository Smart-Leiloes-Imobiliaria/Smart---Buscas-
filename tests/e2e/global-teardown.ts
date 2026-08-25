export default async function globalTeardown() {
  process.loadEnvFile?.(".env.local");
  const { closeDatabaseForTests, db } = await import("@/lib/db");
  const database = await db();
  await database.query("DELETE FROM property_searches WHERE city=$1", ["Acrelândia"]);
  await database.query(
    "DELETE FROM properties WHERE source=$1 AND source_id=$2",
    ["E2E", "collector-property"],
  );
  await database.query(
    "DELETE FROM app_user WHERE email LIKE $1 OR email LIKE $2",
    ["%.e2e@morada.local", "usuario.criado.%@morada.local"],
  );
  await closeDatabaseForTests();
}

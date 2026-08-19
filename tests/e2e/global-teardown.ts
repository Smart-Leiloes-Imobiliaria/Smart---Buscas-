import { closeDatabaseForTests, db } from "@/lib/db";

export default async function globalTeardown() {
  const database = await db();
  await database.query("DELETE FROM property_searches WHERE city=$1", ["Acrelândia"]);
  await database.query(
    "DELETE FROM properties WHERE source=$1 AND source_id=$2",
    ["E2E", "collector-property"],
  );
  await closeDatabaseForTests();
}

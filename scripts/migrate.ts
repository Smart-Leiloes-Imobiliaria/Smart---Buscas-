import { closeDatabaseForTests, db } from "../src/lib/db";

await db();
console.log("Migrações PostgreSQL aplicadas com sucesso.");
await closeDatabaseForTests();

import { closeDatabaseForTests, db } from "@/lib/db";
import { seedDemoListings } from "@/lib/services/demo-seed";

const processed = await seedDemoListings(await db());
console.log(`${processed} anúncios demonstrativos carregados.`);
await closeDatabaseForTests();

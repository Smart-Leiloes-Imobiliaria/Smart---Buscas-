import { loadCollectionConfig } from "@/lib/collection/config";
import { closeDatabaseForTests, db } from "@/lib/db";
import { runPublicPageCollection } from "@/lib/services/collection";

const argumentsMap = new Map(
  process.argv.slice(2).map((argument) => {
    const [key, ...value] = argument.replace(/^--/, "").split("=");
    return [key, value.join("=")];
  }),
);
const sourceFilter = argumentsMap.get("source");
const scopeFilter = argumentsMap.get("scope");
const runType = argumentsMap.get("type") === "incremental" ? "INCREMENTAL" : "FULL";
const config = await loadCollectionConfig();
const database = await db();
let failures = 0;

for (const source of config.sources) {
  if (sourceFilter && source.code !== sourceFilter) continue;
  for (const scope of source.scopes) {
    if (scopeFilter && scope.key !== scopeFilter) continue;
    const result = await runPublicPageCollection(database, source, scope, {
      userAgent: config.userAgent,
      contact: config.contact,
      runType,
    });
    console.log(JSON.stringify({ source: source.code, scope: scope.key, ...result }));
    if (result.status === "FAILED") failures += 1;
  }
}

await closeDatabaseForTests();
if (failures > 0) process.exitCode = 1;

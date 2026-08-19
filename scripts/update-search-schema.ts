import { updateSearchPropertySchema } from "@/lib/services/search-index";

const operation = await updateSearchPropertySchema();

console.log(`Atualização do schema iniciada: ${operation.name}`);

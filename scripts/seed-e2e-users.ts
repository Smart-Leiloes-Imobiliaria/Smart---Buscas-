import { closeDatabaseForTests, db } from "@/lib/db";
import { createUser } from "@/lib/auth/users";

export const e2eAdminEmail = "admin.e2e@morada.local";
export const e2eAdminPassword = "AdminE2EPassword!123";
export const e2eUserEmail = "usuario.e2e@morada.local";
export const e2eUserPassword = "UserE2EPassword!123";

const database = await db();

await database.query("DELETE FROM app_user WHERE email = ANY($1)", [
  [e2eAdminEmail, e2eUserEmail],
]);

await createUser({
  email: e2eAdminEmail,
  password: e2eAdminPassword,
  role: "ADMIN",
});

await createUser({
  email: e2eUserEmail,
  password: e2eUserPassword,
  role: "USER",
});

console.log("Usuários de e2e carregados.");
await closeDatabaseForTests();

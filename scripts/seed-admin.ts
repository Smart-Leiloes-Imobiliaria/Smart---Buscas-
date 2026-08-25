import { closeDatabaseForTests } from "@/lib/db";
import { createUser } from "@/lib/auth/users";

const email = process.env.INITIAL_ADMIN_EMAIL;
const password = process.env.INITIAL_ADMIN_PASSWORD;

if (!email || !password) {
  throw new Error("Defina INITIAL_ADMIN_EMAIL e INITIAL_ADMIN_PASSWORD para criar o administrador.");
}

try {
  const user = await createUser({ email, password, role: "ADMIN" });
  console.log(`Administrador criado: ${user.email}`);
} finally {
  await closeDatabaseForTests();
}

import { redirect } from "next/navigation";

import { LoginForm } from "@/app/login/login-form";
import { getCurrentUser } from "@/lib/auth/session";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand">
          <span className="eyebrow">Imobiliária smart. Leilões</span>
          <h1 id="login-title">Acesse sua conta</h1>
          <p>Entre para consultar oportunidades e acompanhar suas buscas.</p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}

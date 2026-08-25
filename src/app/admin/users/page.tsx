"use client";

import { useCallback, useEffect, useState } from "react";

import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";

type ManagedUser = {
  id: string;
  email: string;
  role: "ADMIN" | "USER";
  active: boolean;
  created_at: string;
};

export default function UserManagementPage() {
  const [users, setUsers] = useState<ManagedUser[]>();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pending, setPending] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const result = await response.json() as { items?: ManagedUser[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível carregar os usuários.");
      setUsers(result.items ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar os usuários.");
    }
  }, []);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  async function createUser(formData: FormData) {
    setPending(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: formData.get("email"), password: formData.get("password") }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível criar o usuário.");
      setSuccess("Usuário criado e liberado para acesso.");
      const form = document.getElementById("create-user-form") as HTMLFormElement | null;
      form?.reset();
      await loadUsers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível criar o usuário.");
    } finally {
      setPending(false);
    }
  }

  if (!users && !error) return <LoadingState />;
  if (!users) return <main className="content"><ErrorState message={error} /></main>;
  return (
    <main className="content">
      <div className="section-head">
        <div>
          <div className="eyebrow">Administração</div>
          <h2>Gerenciar acessos</h2>
          <span className="subtle">Crie logins para os usuários da plataforma.</span>
        </div>
      </div>
      <div className="users-admin-grid">
        <section className="admin-card">
          <h3>Novo usuário</h3>
          <form id="create-user-form" className="user-form" action={createUser}>
            <div className="field"><label htmlFor="new-user-email">E-mail</label><input id="new-user-email" name="email" type="email" autoComplete="email" required disabled={pending} /></div>
            <div className="field"><label htmlFor="new-user-password">Senha</label><input id="new-user-password" name="password" type="password" minLength={8} autoComplete="new-password" required disabled={pending} /></div>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            {success ? <p className="auth-success" role="status">{success}</p> : null}
            <button className="primary" type="submit" disabled={pending}>{pending ? "Criando..." : "Criar usuário"}</button>
          </form>
        </section>
        <section className="admin-card">
          <h3>Usuários cadastrados</h3>
          <div className="user-list">
            {users.map((user) => (
              <div className="user-row" key={user.id}>
                <div><strong>{user.email}</strong><br /><small className="subtle">Criado em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(user.created_at))}</small></div>
                <span className={`tag ${user.role === "ADMIN" ? "" : "tag-neutral"}`}>{user.role === "ADMIN" ? "Administrador" : "Usuário"}</span>
                <span className={`tag ${user.active ? "" : "tag-warning"}`}>{user.active ? "Ativo" : "Inativo"}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import type { AuthenticatedUser } from "@/lib/auth/types";

export function Nav({ user }: { user: AuthenticatedUser | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const active = pathname.startsWith("/favorites")
    ? "favorites"
    : pathname.startsWith("/admin")
      ? "admin"
      : "search";
  if (!user) return null;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <nav className="nav">
      <Link className="brand" href="/" aria-label="Imobiliária Smart Leilões — início">
        <Image className="brand-logo" src="/logo-smart-site.png" alt="" width={54} height={54} priority />
        <span className="brand-copy">
          <small>Imobiliária</small>
          <strong>smart<span>.</span></strong>
          <em>Leilões</em>
        </span>
      </Link>
      <div className="nav-links">
        <Link className={`nav-link ${active === "search" ? "active" : ""}`} href="/">⌕ <span>Buscar</span></Link>
        <Link className={`nav-link ${active === "favorites" ? "active" : ""}`} href="/favorites">♡ <span>Favoritos</span></Link>
        {user.role === "ADMIN" ? <Link className={`nav-link ${active === "admin" ? "active" : ""}`} href="/admin">⚙ <span>Operação</span></Link> : null}
        {user.role === "ADMIN" ? <Link className={`nav-link ${pathname.startsWith("/admin/users") ? "active" : ""}`} href="/admin/users">♙ <span>Acessos</span></Link> : null}
        <button className="nav-link nav-logout" type="button" onClick={() => void logout()} aria-label="Sair da conta">↪ <span>Sair</span></button>
      </div>
    </nav>
  );
}

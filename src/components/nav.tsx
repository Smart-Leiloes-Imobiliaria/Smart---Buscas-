"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function Nav() {
  const pathname = usePathname();
  const active = pathname.startsWith("/favorites")
    ? "favorites"
    : pathname.startsWith("/admin")
      ? "admin"
      : "search";
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
        <Link className={`nav-link ${active === "admin" ? "active" : ""}`} href="/admin">⚙ <span>Operação</span></Link>
      </div>
    </nav>
  );
}

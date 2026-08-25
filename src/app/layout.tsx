import type { Metadata } from "next";

import { Nav } from "@/components/nav";
import { getCurrentUser } from "@/lib/auth/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Imobiliária Smart Leilões",
  description: "Busca consolidada de imóveis em múltiplas fontes.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  return (
    <html lang="pt-BR">
      <body><div className="shell"><Nav user={user} />{children}</div></body>
    </html>
  );
}

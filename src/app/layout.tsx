import type { Metadata } from "next";

import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Imobiliária Smart Leilões",
  description: "Busca consolidada de imóveis em múltiplas fontes.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body><div className="shell"><Nav />{children}</div></body>
    </html>
  );
}

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: process.env.VERCEL ? undefined : "standalone",
  experimental: {
    useTypeScriptCli: false,
  },
  serverExternalPackages: ["pg"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "**.mlstatic.com" },
      {
        protocol: "https",
        hostname: "resizedimgs.vivareal.com",
        pathname: "/**",
      },
      { protocol: "https", hostname: "**.quintoandar.com.br" },
      { protocol: "https", hostname: "**.zapimoveis.com.br" },
      { protocol: "https", hostname: "**.imovelweb.com.br" },
      { protocol: "https", hostname: "**.casamineira.com.br" },
      { protocol: "https", hostname: "**.lopes.com.br" },
      { protocol: "https", hostname: "**.chavesnamao.com.br" },
    ],
  },
};

export default nextConfig;

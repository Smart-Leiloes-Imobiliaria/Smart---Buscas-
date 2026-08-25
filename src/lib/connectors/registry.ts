import type { PropertySourceConnector } from "@/lib/connectors/base";
import { demoConnectors } from "@/lib/connectors/demo";
import { PortalGatewayConnector } from "@/lib/connectors/gateway";

export const portalSources = [
  { code: "zap", name: "ZAP Imóveis", domain: "zapimoveis.com.br", block: 1 },
  { code: "vivareal", name: "Viva Real", domain: "vivareal.com.br", block: 1 },
  { code: "imovelweb", name: "Imovelweb", domain: "imovelweb.com.br", block: 1 },
  { code: "casamineira", name: "Casa Mineira", domain: "casamineira.com.br", block: 2 },
  { code: "quintoandar", name: "QuintoAndar", domain: "quintoandar.com.br", block: 2 },
] as const;

export type PortalSourceCode = (typeof portalSources)[number]["code"];

function gatewaySources() {
  return new Set(
    (process.env.PORTAL_DATA_SOURCES ?? portalSources.map(({ code }) => code).join(","))
      .split(",")
      .map((source) => source.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isGatewaySource(code: string) {
  const authenticated = process.env.PORTAL_DATA_API_TOKEN || process.env.K_SERVICE;
  return Boolean(process.env.PORTAL_DATA_API_URL && authenticated) && gatewaySources().has(code);
}

export function getPortalConnectors(): Record<string, PropertySourceConnector> {
  const baseUrl = process.env.PORTAL_DATA_API_URL;
  const token = process.env.PORTAL_DATA_API_TOKEN;
  return Object.fromEntries(
    portalSources.map(({ code }) => [
      code,
      baseUrl && isGatewaySource(code)
        ? new PortalGatewayConnector(code, baseUrl, token)
        : demoConnectors[code],
    ]),
  );
}

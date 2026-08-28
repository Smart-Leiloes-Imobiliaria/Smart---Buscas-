import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { collectorPropertyToCardData } from "@/lib/property-card-data";
import {
  searchMongoProperties,
  type MongoPropertySourceResult,
} from "@/lib/services/mongo-property-source";
import {
  findPropertySearch,
  propertySearchProperties,
} from "@/lib/services/property-searches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const parsedId = z.uuid().safeParse((await context.params).id);
    if (!parsedId.success) {
      return NextResponse.json(
        { ok: false, error: "Pesquisa inválida" },
        { status: 400 },
      );
    }
    const database = await db();
    const search = await findPropertySearch(database, parsedId.data);
    if (!search) {
      return NextResponse.json(
        { ok: false, error: "Pesquisa não encontrada" },
        { status: 404 },
      );
    }
    const mongoRunsInCollector = enabledCollectorSources().includes("MONGO");
    const [result, mongoResult] = await Promise.all([
      propertySearchProperties(database, search),
      mongoRunsInCollector
        ? Promise.resolve<MongoPropertySourceResult>({
            properties: [],
            status: "IN_COLLECTOR" as const,
            detail: "MongoDB será consultado pelo worker via COLLECTOR_SOURCES.",
          })
        : searchMongoProperties(search),
    ]);
    const storedMongoProperties = result.properties.filter(
      (property) => property.source === "MONGO",
    );
    const properties = result.properties.map(collectorPropertyToCardData);
    if (!mongoRunsInCollector) {
      properties.unshift(...mongoResult.properties);
    }
    const effectiveMongoResult = mongoRunsInCollector && !runningSearch(search.status)
      ? {
          properties: storedMongoProperties,
          status: storedMongoProperties.length > 0 ? ("CONNECTED" as const) : ("NO_MATCHES" as const),
          detail: storedMongoProperties.length > 0
            ? `${storedMongoProperties.length} imóvel(is) do MongoDB incluído(s) no resultado.`
            : "A coleta terminou e nenhum imóvel do MongoDB correspondeu aos filtros.",
          error: undefined,
        }
      : mongoResult;
    const mongoSource =
      effectiveMongoResult.status || effectiveMongoResult.error || effectiveMongoResult.detail
        ? {
            status: effectiveMongoResult.status ?? "ERROR",
            message:
              effectiveMongoResult.error ??
              effectiveMongoResult.detail ??
              "Retorno do Mongo sem detalhes.",
          }
        : undefined;
    return NextResponse.json({
      ok: true,
      search,
      cachedResults: result.cached,
      count: properties.length,
      properties,
      sourceErrors: [
        ...(mongoResult.error ? [mongoResult.error] : []),
      ],
      mongoSource,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { ok: false, error: "Erro ao acompanhar a pesquisa" },
      { status: 500 },
    );
  }
}

function runningSearch(status: string) {
  return status === "PENDING" || status === "RUNNING";
}

function enabledCollectorSources() {
  const configured =
    process.env.COLLECTOR_SOURCES ?? "MONGO,VIVAREAL,QUINTOANDAR,LOPES,CHAVESNAMAO";
  return configured
    .split(",")
    .map((source) => source.trim().toUpperCase())
    .filter(Boolean);
}

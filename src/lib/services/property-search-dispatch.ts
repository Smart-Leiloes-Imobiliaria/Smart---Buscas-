import { googleCloudAuth } from "@/lib/google-auth";

export type PropertySearchDispatchMode = "database" | "cloud-tasks";

export function propertySearchDispatchMode(): PropertySearchDispatchMode {
  return process.env.PROPERTY_SEARCH_DISPATCH_MODE === "cloud-tasks"
    ? "cloud-tasks"
    : "database";
}

export async function dispatchPropertySearch(searchId: string) {
  const mode = propertySearchDispatchMode();
  if (mode === "database") return { mode };

  const requiredConfig = {
    GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT?.trim(),
    CLOUD_TASKS_LOCATION: process.env.CLOUD_TASKS_LOCATION?.trim(),
    CLOUD_TASKS_QUEUE: process.env.CLOUD_TASKS_QUEUE?.trim(),
    PROPERTY_COLLECTOR_SERVICE_URL:
      process.env.PROPERTY_COLLECTOR_SERVICE_URL?.trim(),
    CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL:
      process.env.CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL?.trim(),
  };
  const missingConfig = Object.entries(requiredConfig)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missingConfig.length > 0) {
    throw new Error(
      `Configuração do Cloud Tasks incompleta para despachar a coleta. Variáveis ausentes: ${missingConfig.join(", ")}`,
    );
  }

  const {
    GOOGLE_CLOUD_PROJECT: project,
    CLOUD_TASKS_LOCATION: location,
    CLOUD_TASKS_QUEUE: queue,
    PROPERTY_COLLECTOR_SERVICE_URL: collectorUrl,
    CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL: serviceAccountEmail,
  } = requiredConfig as Record<keyof typeof requiredConfig, string>;
  const parent = `projects/${project}/locations/${location}/queues/${queue}`;
  const body = Buffer.from(JSON.stringify({ searchId })).toString("base64");
  const target = `${collectorUrl.replace(/\/$/, "")}/jobs`;
  const auth = googleCloudAuth();
  const client = await auth.getClient();
  await client.request({
    url: `https://cloudtasks.googleapis.com/v2/${parent}/tasks`,
    method: "POST",
    data: {
      task: {
        name: `${parent}/tasks/property-search-${searchId}`,
        httpRequest: {
          httpMethod: "POST",
          url: target,
          headers: { "Content-Type": "application/json" },
          body,
          oidcToken: {
            serviceAccountEmail,
            audience: collectorUrl,
          },
        },
      },
    },
  });
  return { mode };
}

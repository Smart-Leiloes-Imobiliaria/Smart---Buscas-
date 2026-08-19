import { GoogleAuth } from "google-auth-library";

export type PropertySearchDispatchMode = "database" | "cloud-tasks";

export function propertySearchDispatchMode(): PropertySearchDispatchMode {
  return process.env.PROPERTY_SEARCH_DISPATCH_MODE === "cloud-tasks"
    ? "cloud-tasks"
    : "database";
}

export async function dispatchPropertySearch(searchId: string) {
  const mode = propertySearchDispatchMode();
  if (mode === "database") return { mode };

  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.CLOUD_TASKS_LOCATION;
  const queue = process.env.CLOUD_TASKS_QUEUE;
  const collectorUrl = process.env.PROPERTY_COLLECTOR_SERVICE_URL;
  const serviceAccountEmail =
    process.env.CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL;
  if (!project || !location || !queue || !collectorUrl || !serviceAccountEmail) {
    throw new Error(
      "Configuração do Cloud Tasks incompleta para despachar a coleta",
    );
  }

  const parent = `projects/${project}/locations/${location}/queues/${queue}`;
  const body = Buffer.from(JSON.stringify({ searchId })).toString("base64");
  const target = `${collectorUrl.replace(/\/$/, "")}/jobs`;
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
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

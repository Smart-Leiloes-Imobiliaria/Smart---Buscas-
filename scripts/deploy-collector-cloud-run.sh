#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-smart-caixa-teste}"
REGION="${CLOUD_RUN_REGION:-southamerica-east1}"
SERVICE="${COLLECTOR_CLOUD_RUN_SERVICE:-property-collector}"
SQL_INSTANCE_CONNECTION_NAME="${CLOUD_SQL_INSTANCE_CONNECTION_NAME:-${PROJECT_ID}:${REGION}:n8n-db-instance}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/cloud-run/${SERVICE}:latest"
MONGO_SECRET="${MONGODB_URI_SECRET:-MONGODB_IMOVEIS_READONLY_URI}"
DATABASE_SECRET="${DATABASE_URL_SECRET:?Defina DATABASE_URL_SECRET com o nome do segredo do PostgreSQL}"
DISPATCHER_SA="${CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL:?Defina CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL}"

gcloud config set project "${PROJECT_ID}" >/dev/null
gcloud builds submit \
  --project "${PROJECT_ID}" \
  --config cloudbuild.collector.yaml \
  --substitutions "_IMAGE=${IMAGE}" \
  .

gcloud run deploy "${SERVICE}" \
  --project "${PROJECT_ID}" --region "${REGION}" --image "${IMAGE}" \
  --platform managed --no-allow-unauthenticated --memory 2Gi --cpu 2 \
  --timeout 900 --concurrency 1 --max-instances 3 \
  --add-cloudsql-instances "${SQL_INSTANCE_CONNECTION_NAME}" \
  --set-env-vars '^|^COLLECTOR_HEADLESS=true|COLLECTOR_SOURCES=MONGO,VIVAREAL,QUINTOANDAR,LOPES,CHAVESNAMAO|COLLECTOR_JOB_TIMEOUT_SECONDS=840|MONGODB_DATABASE=smart_app|MONGODB_PROPERTIES_COLLECTION=imoveis|MONGODB_TIMEOUT_MS=10000|MONGODB_CANDIDATE_LIMIT=80' \
  --set-secrets "MONGODB_URI=${MONGO_SECRET}:latest,DATABASE_URL=${DATABASE_SECRET}:latest"

gcloud run services add-iam-policy-binding "${SERVICE}" \
  --project "${PROJECT_ID}" --region "${REGION}" \
  --member "serviceAccount:${DISPATCHER_SA}" --role roles/run.invoker

SERVICE_URL="$(gcloud run services describe "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.url)')"
printf 'Collector deployed: %s\n' "${SERVICE_URL}"
printf 'Configure PROPERTY_COLLECTOR_SERVICE_URL with this URL in the web service.\n'

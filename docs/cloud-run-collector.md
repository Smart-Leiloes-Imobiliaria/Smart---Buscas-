# Cloud Run collector

O coletor Python é um serviço FastAPI independente. `POST /jobs` recebe
`{ "searchId": "..." }` e `GET /health` serve para diagnóstico. Ele usa
Selenium/Chromium nos portais e PyMongo na fonte `MONGO`.

A URI do Mongo permanece no Secret Manager. O deploy usa
`MONGODB_IMOVEIS_READONLY_URI` por padrão e exige um segundo segredo com a URL
do PostgreSQL.

## Deploy

```bash
export GOOGLE_CLOUD_PROJECT=smart-caixa-teste
export DATABASE_URL_SECRET=morada-db-url
export CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL=property-search-dispatcher@smart-caixa-teste.iam.gserviceaccount.com
bash scripts/deploy-collector-cloud-run.sh
```

O serviço é privado, com 2 GiB/2 CPUs, concorrência 1 e timeout de 15 minutos.
Por padrão, ele monta a instância
`smart-caixa-teste:southamerica-east1:n8n-db-instance`; sobrescreva com
`CLOUD_SQL_INSTANCE_CONNECTION_NAME` se a aplicação passar a usar outra
instância. O script tenta conceder `roles/run.invoker` à conta do Cloud Tasks.

No serviço web, configure a URL retornada pelo deploy:

```text
PROPERTY_SEARCH_DISPATCH_MODE=cloud-tasks
PROPERTY_COLLECTOR_SERVICE_URL=https://URL_DO_COLLECTOR
CLOUD_TASKS_LOCATION=southamerica-east1
CLOUD_TASKS_QUEUE=property-searches
CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL=...
```

A conta do serviço web precisa criar tarefas na fila; a conta do Cloud Tasks
precisa invocar o serviço privado.

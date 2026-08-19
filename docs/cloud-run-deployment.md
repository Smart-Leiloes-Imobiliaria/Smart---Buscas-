# Cloud Run e Cloud SQL

A aplicação está preparada para usar o PostgreSQL local por `DATABASE_URL` ou
uma instância Cloud SQL anexada ao Cloud Run por socket Unix.

## Variáveis do serviço

```text
INSTANCE_UNIX_SOCKET=/cloudsql/PROJECT_ID:REGION:INSTANCE_ID
DB_NAME=morada
DB_USER=morada_app
DB_PASSWORD=<Secret Manager>
GOOGLE_CLOUD_PROJECT=smart-caixa-teste
DISCOVERY_ENGINE_LOCATION=global
DISCOVERY_ENGINE_COLLECTION=default_collection
DISCOVERY_ENGINE_ENGINE_ID=smart-buscas_1786716455197
DISCOVERY_ENGINE_DATA_STORE_ID=smart-dados-pesquisa_1786716693643
DISCOVERY_ENGINE_BRANCH=default_branch
DISCOVERY_ENGINE_SCHEMA_ID=default_schema
SEARCH_INDEX_ENABLED=true
```

O serviço deve receber uma conta de serviço com acesso de cliente ao Cloud SQL
e permissão para ler, pesquisar e atualizar documentos no Discovery Engine.
`DB_PASSWORD` deve ser montada diretamente do Secret Manager; não deve ser
gravada no repositório, na imagem ou em arquivos `.env` compartilhados.

## Implantação

Depois de selecionar ou criar a instância Cloud SQL definitiva:

```bash
gcloud run deploy smart-buscas-web \
  --source . \
  --region southamerica-east1 \
  --add-cloudsql-instances PROJECT_ID:REGION:INSTANCE_ID \
  --set-env-vars INSTANCE_UNIX_SOCKET=/cloudsql/PROJECT_ID:REGION:INSTANCE_ID,DB_NAME=morada,DB_USER=morada_app,GOOGLE_CLOUD_PROJECT=smart-caixa-teste,DISCOVERY_ENGINE_LOCATION=global,DISCOVERY_ENGINE_COLLECTION=default_collection,DISCOVERY_ENGINE_ENGINE_ID=smart-buscas_1786716455197,DISCOVERY_ENGINE_DATA_STORE_ID=smart-dados-pesquisa_1786716693643,DISCOVERY_ENGINE_BRANCH=default_branch,DISCOVERY_ENGINE_SCHEMA_ID=default_schema,SEARCH_INDEX_ENABLED=true \
  --set-secrets DB_PASSWORD=morada-db-password:latest
```

Não execute esse comando apontando para `n8n-db-instance` antes de decidir
explicitamente se a aplicação pode compartilhar disponibilidade e recursos com
o n8n.

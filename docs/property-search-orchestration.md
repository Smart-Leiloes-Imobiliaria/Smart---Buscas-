# Orquestração de pesquisas de imóveis

## Fluxo

1. `POST /api/property-searches` valida e normaliza os filtros.
2. O Next.js calcula uma chave SHA-256 e reutiliza uma pesquisa ativa ou uma
   coleta concluída ainda fresca.
3. Uma pesquisa nova é gravada como `PENDING`.
4. O worker Python reivindica a pesquisa com `FOR UPDATE SKIP LOCKED`, muda o
   estado para `RUNNING` e abre o portal.
5. Os anúncios normalizados são gravados por UPSERT em `properties` e ligados à
   execução em `property_search_results`.
6. O worker finaliza como `COMPLETED` ou `FAILED`.
7. A página consulta `GET /api/property-searches/{id}` a cada dois segundos até
   chegar a um estado terminal.

O processo HTTP do Next.js nunca importa ou executa Selenium.

O worker consulta `source.enabled` no Postgres a cada pesquisa (além de
`COLLECTOR_SOURCES`), então pausar um portal em "Fontes" no `/admin` o remove
imediatamente das próximas coletas, sem precisar reiniciar o worker.

## Desenvolvimento local

Para iniciar o banco, Next.js e o worker juntos:

```bash
npm run db:start
npm run db:migrate
npm run dev
```

`npm run dev` inicia o worker em modo headless, evitando buscas presas em
`PENDING`. Para executar somente a interface, use `npm run dev:web`. Também é
possível iniciar os processos em terminais diferentes:

```bash
npm run dev:web
npm run collector:worker
```

O modo local usa `PROPERTY_SEARCH_DISPATCH_MODE=database`. O worker lê as
pesquisas pendentes diretamente no PostgreSQL. Use `npm run collector:once`
para processar somente uma pesquisa.

Os portais são selecionados por `COLLECTOR_SOURCES`. O registro contém Viva
Real, ZAP Imóveis, Imovelweb, Casa Mineira, QuintoAndar, Lopes e Chaves na
Mão. O ambiente local habilita os adapters validados com coleta real:

```text
COLLECTOR_SOURCES=VIVAREAL,QUINTOANDAR,LOPES,CHAVESNAMAO
```

Viva Real, QuintoAndar, Lopes e Chaves na Mão foram validados com coleta real
end-to-end (busca real, sem mocks, devolvendo até três imóveis por portal).
Lopes usa seletores de DOM (`lps-search-product-card`) porque não expõe
JSON-LD na página de busca; Chaves na Mão usa o JSON-LD `RealEstateListing`,
filtrando apenas anúncios individuais (`/imovel/...`) e ignorando
lançamentos, que trazem faixas de preço/quartos em vez de valores fechados.

ZAP, Imovelweb e Casa Mineira já têm adapters implementados (mesma extração
genérica via JSON-LD usada pelo Viva Real), mas no momento retornam
um desafio Cloudflare ("Attention Required" / "Um momento…") mesmo com Chrome
real, a partir da rede usada em desenvolvimento — não foram habilitados por
padrão porque a coleta não pôde ser validada como real. O collector detecta o
bloqueio e respeita o intervalo de retry, sem tentar resolver CAPTCHA ou
contornar a proteção do portal. Habilite-os manualmente (por exemplo
`COLLECTOR_SOURCES=VIVAREAL,ZAP`) e valide a partir da rede/IP que for
efetivamente usada em produção antes de contar com eles. Quando ao menos um
portal responde, a pesquisa termina com os resultados disponíveis; se todos
falharem, ela segue o fluxo normal de tentativas.

O Chrome é visível por padrão no desenvolvimento, o que também permite observar
eventuais páginas de consentimento ou bloqueios do portal. Para execução sem
interface gráfica:

```bash
COLLECTOR_HEADLESS=true npm run collector:worker
```

## Cloud Run e Cloud Tasks

Crie e envie a imagem do coletor:

```bash
docker build -f Dockerfile.collector-python \
  -t REGION-docker.pkg.dev/PROJECT/REPOSITORY/property-collector .
docker push REGION-docker.pkg.dev/PROJECT/REPOSITORY/property-collector
```

Implante a imagem como um serviço privado do Cloud Run, anexando o mesmo Cloud
SQL utilizado pela aplicação. O endpoint processado pelo Cloud Tasks é
`POST /jobs`; `GET /health` pode ser usado para verificação de saúde.

Crie a fila:

```bash
gcloud tasks queues create property-searches \
  --location=southamerica-east1
```

A conta usada pelo Next.js precisa criar tarefas, e a conta configurada em
`CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL` precisa invocar o serviço privado do
coletor. Configure no serviço Next.js:

```text
PROPERTY_SEARCH_DISPATCH_MODE=cloud-tasks
PROPERTY_SEARCH_CACHE_MINUTES=10
GOOGLE_CLOUD_PROJECT=PROJECT
CLOUD_TASKS_LOCATION=southamerica-east1
CLOUD_TASKS_QUEUE=property-searches
PROPERTY_COLLECTOR_SERVICE_URL=https://COLLECTOR_URL
CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL=SERVICE_ACCOUNT
```

O Cloud Tasks envia um corpo JSON com `searchId`, usando OIDC para autenticar a
chamada ao Cloud Run. A requisição só recebe sucesso depois que o coletor termina,
permitindo que falhas de infraestrutura sejam observadas pela fila.

## Timeouts, tentativas e recuperação

Cada carregamento do navegador possui timeout e a pesquisa inteira tem um
deadline. Falhas transitórias voltam para `PENDING` com backoff exponencial;
somente a última tentativa muda a pesquisa para `FAILED`. No modo Cloud Tasks,
uma pesquisa reagendada responde HTTP 503 com `Retry-After`, mantendo a tarefa
ativa para uma nova entrega.

```text
COLLECTOR_PAGE_TIMEOUT_SECONDS=30
COLLECTOR_SCRIPT_TIMEOUT_SECONDS=15
COLLECTOR_ELEMENT_TIMEOUT_SECONDS=15
COLLECTOR_JOB_TIMEOUT_SECONDS=180
COLLECTOR_MAX_ATTEMPTS=3
COLLECTOR_RETRY_BASE_SECONDS=5
COLLECTOR_RETRY_MAX_SECONDS=60
COLLECTOR_BLOCK_RETRY_SECONDS=120
COLLECTOR_HEARTBEAT_INTERVAL_SECONDS=15
COLLECTOR_STALE_AFTER_SECONDS=300
```

Durante a execução, o worker atualiza `last_heartbeat_at`. Registros `RUNNING`
sem heartbeat dentro de `COLLECTOR_STALE_AFTER_SECONDS` são reagendados, ou
finalizados quando já consumiram todas as tentativas. `next_attempt_at` impede
que o worker local repita uma falha antes do backoff terminar.
Bloqueios explícitos do portal usam a pausa maior definida por
`COLLECTOR_BLOCK_RETRY_SECONDS`, evitando insistência em intervalos curtos.

Cada portal devolve no máximo três imóveis compatíveis por pesquisa. A regra é
aplicada no próprio collector e novamente no worker como proteção, portanto não
há paginação nem rolagem da página de resultados.

Os três anúncios de cada portal continuam armazenados com sua origem e seu
identificador. Antes de vinculá-los à pesquisa, o worker compara anúncios de
portais diferentes. Cidade, estado, tipo e transação precisam ser compatíveis;
endereço ou texto do anúncio e características como área, quartos, banheiros e
vagas formam uma pontuação. Somente correspondências fortes (90 pontos ou mais)
são consolidadas automaticamente. Assim, um mesmo imóvel encontrado em dois
sites aparece uma vez nos resultados, sem perder os registros originais.

## Estados e cache

- `PENDING`: aguardando um worker.
- `RUNNING`: navegador e parser em execução.
- `COMPLETED`: resultados exatos disponíveis em `property_search_results`.
- `FAILED`: erro apresentado na página, sem apagar imóveis já armazenados.

Pesquisas equivalentes são identificadas pela chave dos filtros normalizados e
da versão do coletor. `PROPERTY_SEARCH_CACHE_MINUTES` controla por quanto tempo
uma coleta concluída pode ser reutilizada.

Enquanto uma pesquisa está pendente ou em execução, a API pode devolver imóveis
anteriores compatíveis com os filtros. Eles são marcados na interface como
resultados anteriores. Ao concluir, apenas os imóveis vinculados à execução são
mostrados.

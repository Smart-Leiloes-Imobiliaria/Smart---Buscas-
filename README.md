# Imobiliária Smart Leilões

MVP de busca consolidada de imóveis, implementado com Next.js, TypeScript e PostgreSQL. O sistema consulta conectores isolados, preserva o conteúdo bruto, normaliza anúncios, deduplica imóveis, registra histórico e entrega propriedades comparáveis.

## Requisitos

- Node.js 22 ou superior
- npm 10 ou superior
- PostgreSQL 16 ou superior, ou Docker

## Executar

Copie a configuração local e inicie o PostgreSQL:

```bash
cp .env.example .env.local
docker compose up -d postgres
```

Instale, migre e execute a aplicação:

```bash
npm install
npm run db:start
npm run db:migrate
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000).

## Acesso ao sistema

Todas as páginas da aplicação exigem login. Não há cadastro público: o primeiro
administrador é criado uma única vez por variável de ambiente e os demais
usuários são criados em `/admin/users` pelo próprio administrador.

Defina uma senha forte e crie a conta inicial depois de aplicar as migrações:

```bash
INITIAL_ADMIN_EMAIL=admin@suaempresa.com \
INITIAL_ADMIN_PASSWORD='uma-senha-forte' \
npm run auth:seed-admin
```

Em produção, configure `AUTH_SESSION_SECRET` com um valor aleatório longo no
provedor de variáveis de ambiente. Não reutilize o valor de exemplo e não envie
as credenciais iniciais ao repositório.

Para executar como produção:

```bash
npm run build
npm start
```

## Testar

```bash
npm test
npm run lint
npm run test:e2e
```

`npm run db:start` usa o PostgreSQL 16 instalado no diretório do usuário. Se
preferir Docker, `docker compose up -d postgres` continua disponível.

## Arquitetura

- `src/app`: páginas e Route Handlers do App Router
- `src/components`: componentes React reutilizáveis
- `src/lib/connectors`: contrato de fontes e conectores demonstrativos
- `src/lib/collection`: coleta segura de páginas públicas e normalização
- `src/lib/services`: ingestão, deduplicação, ranking e busca
- `src/lib/search`: contrato dos documentos e cliente do Smart-Buscas
- `db/migrations`: esquema relacional PostgreSQL
- `docs/gcloud-architecture.md`: desenho do gateway de coleta e implantação no GCloud
- `public`: recursos visuais estáticos
- `tests`: testes dos fluxos essenciais

O acesso ao banco é configurado por `DATABASE_URL`. As migrações são aplicadas automaticamente na primeira conexão e também podem ser executadas explicitamente com `npm run db:migrate`.

O antigo arquivo `data/morada.db` não é mais utilizado. Ele permanece apenas como cópia dos dados locais anteriores; uma migração de dados pode ser preparada separadamente se esses registros precisarem ser preservados.

## Fontes

As fontes estão organizadas em dois blocos:

- Bloco 1: ZAP Imóveis, Viva Real e Imovelweb.
- Bloco 2: Casa Mineira e QuintoAndar.

No ambiente local elas podem usar dados determinísticos para permitir o
desenvolvimento. A carga demonstrativa é explícita:

```bash
npm run demo:seed
```

Para dados reais sem API, execute o job de páginas públicas em segundo plano. Ele
prioriza JSON-LD e usa seletores HTML como fallback, sem cookies, login, CAPTCHA
ou mecanismos de evasão. A configuração e a implantação estão descritas em
[`docs/public-page-collection.md`](docs/public-page-collection.md).

O gateway autorizado continua disponível como alternativa. Configure-o em
`.env.local` quando houver um feed ou contrato de parceiro:

```bash
PORTAL_DATA_API_URL=https://seu-gateway.run.app
PORTAL_DATA_API_TOKEN=...
PORTAL_DATA_SOURCES=zap,vivareal,imovelweb,casamineira,quintoandar
```

Depois de reiniciar, a seção **Coleta dos portais** em `/admin` mostra o estado
das fontes. O token é lido somente no servidor.

O fluxo completo e o contrato dos endpoints estão em
[`docs/gcloud-architecture.md`](docs/gcloud-architecture.md).

## Smart-Buscas

Os anúncios normalizados podem ser indexados no Vertex AI Search usando o data
store `Smart-Dados-Pesquisa`. O PostgreSQL continua sendo a fonte permanente; o
índice é uma projeção reconstruível voltada à pesquisa, filtros e relevância.

Em desenvolvimento, autentique as Application Default Credentials uma vez:

```bash
gcloud auth application-default login
```

Para aplicar uma nova versão do schema configurado no código:

```bash
npm run search:schema
```

No Cloud Run, associe uma conta de serviço com acesso ao Discovery Engine. Não
armazene chaves JSON nem tokens do Google Cloud no `.env.local`.

`SEARCH_INDEX_ENABLED` permanece `false` no ambiente demonstrativo para impedir
que URLs e imóveis fictícios sejam enviados ao índice real. Ative somente no
ambiente que estiver recebendo anúncios reais pelo gateway autorizado.

O feed XML documentado por ZAP/Viva Real é voltado ao envio de anúncios da
imobiliária para os portais; ele não é uma API pública de pesquisa do catálogo.
A antiga Custom Search JSON API do Google também não é base para esta solução,
pois está fechada para novos clientes e tem encerramento anunciado para
1º de janeiro de 2027.

A leitura dos resultados sempre consulta os dados armazenados. Quando a pesquisa
sob demanda está habilitada, o frontend cria uma solicitação assíncrona para o
worker; o Selenium nunca é executado pelo processo HTTP do Next.js.

## Pesquisa sob demanda

A página principal também pode criar uma pesquisa assíncrona. O Next.js grava a
solicitação em `property_searches`, retorna imediatamente um `searchId` e a tela
acompanha o estado sem manter a requisição aberta. Enquanto a coleta está
pendente, imóveis compatíveis já armazenados podem ser exibidos. Quando o worker
termina, a tela passa a usar os imóveis associados em
`property_search_results`.

No desenvolvimento, deixe o worker Python em um segundo terminal:

```bash
npm run collector:worker
```

Para processar apenas a próxima pesquisa pendente:

```bash
npm run collector:once
```

O Chrome é visível localmente por padrão. Configure `COLLECTOR_HEADLESS=true`
em ambientes com navegador headless. O frontend nunca inicia Selenium; o worker
é um processo independente que compartilha apenas o PostgreSQL.

Em produção, `PROPERTY_SEARCH_DISPATCH_MODE=cloud-tasks` faz o Next.js criar uma
tarefa HTTP autenticada para o serviço do coletor no Cloud Run. A imagem desse
serviço é criada com `Dockerfile.collector-python`. A fila do Cloud Tasks e as
permissões IAM precisam existir antes da ativação desse modo.

Para produção, use:

- Vercel para o app Next.js, com as variáveis de `.env.production.example`.
- PostgreSQL gerenciado compartilhado pelo app e pelo coletor.
- Cloud Run para o coletor Python/Selenium, com as variáveis de
  `.env.collector.production.example`.

O projeto fixa Node.js `v22.23.2` em `.nvmrc` e `.node-version`; a Vercel também
respeita `engines.node` em `package.json`.

## API principal

- `GET /api/health`
- `POST /api/searches`
- `GET /api/searches/{id}`
- `POST /api/property-searches`
- `GET /api/property-searches/{id}`
- `GET /api/properties`
- `GET /api/properties/{id}`
- `POST /api/favorites`
- `DELETE /api/favorites/{id}`
- `GET /api/admin/summary`
- `GET /api/admin/integrations`
- `GET/PATCH /api/admin/sources`
- `GET /api/admin/jobs`
- `GET/POST /api/admin/reviews`

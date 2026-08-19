# Análise técnica do projeto — 18/08/2026

## Resumo executivo

O projeto tem uma arquitetura coerente para um MVP de busca de imóveis: o
Next.js atende a interface e a API, o PostgreSQL mantém o estado e o worker
Python/Selenium executa a coleta fora do processo HTTP. A pesquisa assíncrona
possui bons mecanismos de concorrência, retry, heartbeat, recuperação e
deduplicação. As suítes unitárias estão verdes.

Antes de uma exposição pública em produção, os principais bloqueadores são:

1. proteger as rotas administrativas e limitar as rotas que disparam coletas;
2. executar o build e o CI com Node.js 22, conforme `package.json` e Dockerfile;
3. impedir redirects para hosts não autorizados no coletor HTTP;
4. executar Chromium e o serviço coletor como usuário não privilegiado;
5. definir uma estratégia para unificar ou delimitar os dois modelos de imóveis.

## Pontos fortes

- Separação correta entre aplicação web e coleta Selenium.
- SQL parametrizado nas rotas e serviços revisados.
- Validação de entrada com Zod e Pydantic.
- Fila de pesquisas com `FOR UPDATE SKIP LOCKED`, backoff, heartbeat e
  recuperação de execuções abandonadas.
- Lock transacional para impedir pesquisas equivalentes concorrentes.
- UPSERT em lote dos anúncios coletados.
- Deduplicação conservadora entre portais, preservando os registros de origem.
- Migrações ordenadas e protegidas por advisory lock.
- Coletor HTTP com allowlist inicial de hosts, respeito a `robots.txt`, timeout
  e limite de resposta.
- Segredos não são enviados ao cliente e `.env.local` está no `.gitignore`.
- Imagens Docker da aplicação usam Node 22 e usuário não privilegiado.
- Boa base de testes: 23 testes TypeScript e 24 testes Python aprovados nesta
  revisão.

## Pontos críticos e altos

### 1. Rotas administrativas sem autenticação

As rotas em `src/app/api/admin` permitem consultar métricas, jobs, fontes e
revisões, além de pausar fontes e agrupar registros, sem autenticação ou
autorização no aplicativo. O agrupamento altera várias tabelas e exclui um
registro de imóvel. O `/admin` e cada Route Handler mutável precisam validar uma
sessão com papel administrativo; proteção apenas no layout não é suficiente.

### 2. Ausência de rate limiting nas operações caras

`POST /api/property-searches` pode criar uma pesquisa que aciona Cloud Tasks e
Selenium. Sem identidade, quota ou rate limiting, um cliente pode gerar custo e
carga operacional. O mesmo cuidado se aplica à criação de buscas e favoritos.

### 3. Redirect antes da validação final no coletor HTTP

`PublicPageCollector` usa `redirect: "follow"`. O host final é validado, mas a
requisição ao destino do redirect já ocorreu nesse momento. Um host permitido
comprometido poderia redirecionar para endereço interno. Use redirects manuais,
valide cada `Location` antes de segui-lo e bloqueie endereços locais, privados,
link-local e de metadata.

### 4. Coletor Chromium executado como root e sem sandbox

`Dockerfile.collector-python` não define `USER`, enquanto `browser.py` inicia o
Chromium com `--no-sandbox`. Como o navegador processa conteúdo externo, o
container deve usar usuário não privilegiado, filesystem restrito e limites de
recursos. Se tecnicamente possível, mantenha o sandbox do Chromium habilitado.

### 5. Build local fora da versão suportada

O projeto declara Node `>=22`, mas o ambiente auditado usa Node 20.19.2. A
compilação do código termina, porém o Next.js 16.3.0 falha ao interpretar a
saída interna de `tsc --showConfig`. O build deve ser executado com Node 22 e a
versão deve ser fixada no ambiente local e no CI. O Dockerfile principal já usa
Node 22.

## Pontos médios

### Dois modelos persistentes de imóveis

O modelo histórico usa `property`, `listing`, favoritos, eventos e snapshots. O
fluxo Selenium usa `properties` e `property_search_results`. Isso duplica
filtros, serialização e regras, e faz recursos como favoritos e histórico não
se aplicarem aos resultados do segundo modelo. É recomendável definir um modelo
canônico ou documentar claramente a fronteira e um plano de convergência.

### Concorrência da fila de indexação

`processSearchIndexOutbox` seleciona itens pendentes sem reivindicação atômica,
`FOR UPDATE SKIP LOCKED` ou estado `PROCESSING`. Dois processos podem enviar o
mesmo item simultaneamente. Adote claim transacional, lease e retry com backoff.

### Migrações durante a inicialização da aplicação

O advisory lock evita concorrência, mas o processo web precisa de privilégios
DDL e o cold start fica acoplado às migrações. Em produção, prefira um job de
release/migração separado e um usuário da aplicação sem permissão de alterar o
esquema.

### TLS do PostgreSQL

Quando `DATABASE_SSL=true`, o cliente usa `rejectUnauthorized: false`. Para uma
conexão TCP remota isso não valida o certificado do servidor. Use a CA correta
e validação estrita; o socket do Cloud SQL não depende dessa opção.

### Precisão numérica

Os parsers globais de `BIGINT` e `NUMERIC` convertem valores para `Number`.
Identificadores grandes e valores monetários podem perder precisão. IDs podem
ser strings e valores financeiros devem manter decimal/string até a borda de
apresentação.

### Permissões do arquivo local de ambiente

`.env.local` está ignorado pelo Git, mas possui modo `664`, legível por outros
usuários locais. Recomenda-se `600` para arquivos que possam conter
credenciais.

### Falta de cabeçalhos e política de segurança do navegador

Não há CSP nem um conjunto explícito de cabeçalhos como `frame-ancestors`,
`nosniff` e política de referrer. O impacto atual é reduzido pelo uso de React e
ausência de HTML inseguro, mas deve entrar no endurecimento de produção.

### Resiliência da validação de municípios

A criação de pesquisas depende da API do IBGE quando o cache em memória está
frio. Uma indisponibilidade externa bloqueia novas pesquisas. Considere cache
persistente, stale-if-error ou uma tabela local versionada.

### Observabilidade

Há muitos `print`/`console.error`, mas não logging estruturado, correlation ID,
métricas de duração por portal ou alertas. Registre `searchId`, portal,
tentativa, latência e resultado em logs estruturados, sem incluir payloads ou
segredos.

## Testes e validações executados

- `npm run lint`: aprovado.
- `npm test`: 7 arquivos e 23 testes aprovados.
- `npm run test:collector`: 24 testes aprovados.
- `npm audit --omit=dev --offline`: nenhuma vulnerabilidade conhecida no cache
  local.
- `.venv/bin/pip check`: dependências Python consistentes.
- `npm run build`: falhou no ambiente Node 20.19.2 após compilar; precisa ser
  repetido em Node 22.
- E2E e coleta real não foram executados, pois alteram banco/serviços e dependem
  de navegador e portais externos.

## Prioridade recomendada

1. Autenticação/RBAC do admin e rate limiting.
2. Node 22 no desenvolvimento e CI; build de produção obrigatório.
3. Redirect seguro e hardening do container Selenium.
4. Claim atômico da outbox e observabilidade.
5. Unificação dos modelos de imóveis e revisão da precisão monetária.
6. Testes de integração com PostgreSQL real e E2E no pipeline.

## Estado do versionamento

O diretório `.git` disponível durante a revisão está vazio e somente leitura.
Não foi possível criar um commit ou tag Git. A versão foi preservada como um
arquivo compactado com checksum SHA-256, excluindo segredos, banco local,
dependências e artefatos de build.

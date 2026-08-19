# Coleta de páginas públicas

O projeto possui um job separado do Next.js para coletar catálogos públicos sem
depender de uma API do portal. A pesquisa feita pelo usuário nunca visita sites
externos: ela consulta somente PostgreSQL e, quando ativado, o Smart-Buscas.

## Estratégia

O coletor tenta primeiro `application/ld+json` (JSON-LD). Quando a página não
oferece dados estruturados, usa seletores HTML configurados para aquela fonte.
O job não envia cookies, não executa login e não tenta resolver CAPTCHA ou
contornar bloqueios. Playwright não foi incluído nesta primeira versão porque
deve ser reservado a fontes autorizadas que realmente exijam JavaScript.

Cada fonte precisa declarar:

- hosts permitidos;
- URL paginada contendo `{page}`;
- cidade, modalidade e demais dados do escopo;
- limite de páginas, timeout e intervalo entre requisições;
- seletores HTML de fallback, quando necessários.

O arquivo [`config/collector.example.json`](../config/collector.example.json)
documenta o contrato. Copie-o para um arquivo local ignorado pelo Git, substitua
o domínio de exemplo e configure:

```bash
COLLECTOR_CONFIG_PATH=./config/collector.json
```

Execute uma fonte e um escopo:

```bash
npm run collect -- --source=zap --scope=bh-venda
```

Sem filtros, o comando executa todos os escopos presentes no arquivo. Use
`--type=incremental` para uma rodada que não deve contabilizar ausências.

## Segurança operacional

Antes de baixar uma página, o coletor verifica `robots.txt`, valida o host contra
a lista permitida e envia um User-Agent identificável com contato. Respostas têm
limite de tamanho e timeout. Redirecionamentos para hosts não permitidos são
rejeitados.

Uma rodada só é considerada completa quando encontra uma página vazia. Se
atingir `maxPages` ainda recebendo resultados, fica `PARTIAL`. Uma queda brusca
em relação à última rodada saudável fica `SUSPECT`. Rodadas parciais, suspeitas,
incrementais ou com erro nunca contabilizam ausência.

## Inativação

A presença é registrada separadamente por anúncio e escopo. Por padrão, um
anúncio só é inativado após três ausências em rodadas completas e saudáveis e
depois de 36 horas desde a última visualização. Esses valores podem ser alterados
por `COLLECTOR_MISS_THRESHOLD` e `COLLECTOR_INACTIVE_AFTER_HOURS`.

Ao inativar, o anúncio continua no PostgreSQL e em seus snapshots. Ele deixa de
aparecer nas buscas normais e uma atualização `INACTIVE` é colocada na fila do
Smart-Buscas. Se reaparecer, é reativado automaticamente.

## Google Cloud

Crie a imagem do job com:

```bash
gcloud auth configure-docker REGION-docker.pkg.dev
docker build -f Dockerfile.collector \
  -t REGION-docker.pkg.dev/PROJECT/REPOSITORY/property-collector .
docker push REGION-docker.pkg.dev/PROJECT/REPOSITORY/property-collector
```

No Cloud Run Job, forneça o arquivo de configuração por volume do Secret
Manager, configure `COLLECTOR_CONFIG_PATH`, conecte o mesmo Cloud SQL do Next.js
e use o Cloud Scheduler para executar o job. Não coloque credenciais ou cookies
no arquivo de configuração.

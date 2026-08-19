# Arquitetura de coleta no Google Cloud

## Objetivo

Consolidar anúncios de ZAP Imóveis, Viva Real, Imovelweb, Casa Mineira, OLX
Imóveis e QuintoAndar sem acoplar o Next.js a HTML privado ou endpoints internos
dos portais.

```text
Navegador
   |
   v
Next.js API (Cloud Run) ----------> Cloud SQL / PostgreSQL
   |                                      |
   |                                      +-- anúncios normalizados
   |                                      +-- snapshots e histórico
   |                                      +-- buscas, favoritos e revisões
   v
Cloud Run Job (coleta periódica)
   |
   +-- adapter por fonte ---> JSON-LD ou HTML público configurado

Cloud Scheduler ---> Cloud Run Job ---> sincronizações periódicas
Secret Manager -----------------------> configuração do coletor
Cloud Logging / Monitoring -----------> logs, métricas e alertas
```

O aplicativo web mantém o cliente do gateway para feeds futuros, mas a coleta
por páginas públicas é executada pelo job descrito em
[`public-page-collection.md`](public-page-collection.md). O Next.js não visita
portais durante uma pesquisa do usuário.

## Contrato do gateway

### Descobrir anúncios

`POST /v1/sources/{source}/search`

```json
{
  "criteria": {
    "city": "Belo Horizonte",
    "neighborhoods": ["Savassi"],
    "transaction": "SALE",
    "price_max": 900000
  }
}
```

Resposta:

```json
{
  "items": [
    {
      "external_id": "id-no-portal",
      "url": "https://portal.example/imovel/id-no-portal"
    }
  ]
}
```

### Obter detalhes

`GET /v1/sources/{source}/listings/{external_id}`

A resposta deve conter `external_id` ou `id`, `url`, `property_type`,
`transaction_type`, `city`, `neighborhood`, `address`, `latitude`, `longitude`,
`area_m2`, `bedrooms`, `bathrooms`, `parking_spaces`, `price`, `condo_fee`,
`image_url` e `description`.

## Segurança e limites

- O gateway deve aceitar apenas fontes cadastradas e validar todos os retornos.
- Credenciais ficam no Secret Manager, nunca no frontend ou no repositório.
- No Cloud Run, o cliente obtém um ID token da identidade do serviço para chamar
  o gateway protegido por IAM. `PORTAL_DATA_API_TOKEN` serve para desenvolvimento
  local ou para um gateway que adote Bearer token próprio.
- Cada adapter precisa de rate limit, timeout, retentativas com backoff e
  circuit breaker por portal.
- O conteúdo bruto é preservado no PostgreSQL para auditoria, mas dados pessoais
  desnecessários não devem ser coletados.
- Só devem ser usados contratos comerciais, APIs ou feeds expressamente
  autorizados. Alterações de HTML não entram no aplicativo principal.

## Próximas etapas

1. Solicitar aos seis portais acesso de parceiro para consulta de inventário.
2. Implementar no gateway um adapter por contrato efetivamente disponibilizado.
3. Implantar gateway, aplicação Next.js e um Cloud Run Job.
4. Conectar Cloud SQL e Secret Manager.
5. Programar sincronizações no Cloud Scheduler e alertas no Cloud Monitoring.

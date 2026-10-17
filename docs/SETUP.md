# Setup e comandos

Como subir o ambiente local e rodar o serviço. Ver também `ARCHITECTURE.md` para as
decisões técnicas.

## Pré-requisitos

- **Bun 1.x** (`bun --version`)
- **Docker** + **Docker Compose v2**

## 1. Instalar dependências

```bash
bun install
```

## 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

O schema de ambiente é validado no boot (falha rápida). Ajuste se necessário.

## 3. Subir a infraestrutura

```bash
bun run compose:up
```

Sobe três containers:

| Serviço | Porta | Papel |
|---|---|---|
| PostgreSQL 16 | `5432` | banco de dados |
| LocalStack (SQS) | `4566` | filas `wager-transactions.fifo` e `wager-transactions-dlq.fifo` |
| Keycloak 26 | `8080` | Identity Provider (realm `jungle`) |

As filas são criadas automaticamente por `docker/localstack/init-sqs.sh`.
O realm, o client `wagering-api` e o usuário `player1` são importados de
`docker/keycloak/realm-jungle.json`.

Verifique a saúde dos containers:

```bash
docker compose ps
curl -s http://localhost:4566/_localstack/health | head
```

## 4. Rodar as migrations

```bash
bun run migration:run     # aplica
bun run migration:revert  # desfaz a última
bun run migration:show    # status
```

## 5. Rodar a aplicação

```bash
bun run dev     # watch mode
bun run start   # execução simples
```

## 6. Health checks (sem autenticação)

```bash
curl -s http://localhost:3000/health/live
curl -s http://localhost:3000/health/ready
```

`ready` retorna `503` quando PostgreSQL ou SQS estiverem inacessíveis.

## 7. Autenticação (Keycloak)

O guard global valida o token Bearer quando `AUTH_ENABLED=true`. Os endpoints de
health são sempre públicos.

Obter um token de teste (usuário `player1` / senha `player1`):

```bash
curl -s -X POST \
  http://localhost:8080/realms/jungle/protocol/openid-connect/token \
  -d "grant_type=password" \
  -d "client_id=wagering-api" \
  -d "username=player1" \
  -d "password=player1" | jq -r .access_token
```

Usar em uma requisição:

```bash
curl -s http://localhost:3000/<rota-protegida> \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

Console administrativo do Keycloak: <http://localhost:8080> (`admin` / `admin`).

## 8. Testes

```bash
bun test              # tudo
bun run test:unit     # apenas unidade
RUN_INTEGRATION=1 bun run test:integration   # requer o stack de pé
bun run typecheck     # TypeScript estrito
```

## 9. Encerrar

```bash
bun run compose:down   # remove containers e volumes (limpa o banco)
```

## 10. API de Wallet

Endpoints protegidos pelo guard global (com `AUTH_ENABLED=true`, exigem Bearer token —
ver seção 7). Com `AUTH_ENABLED=false` o guard é no-op e o header pode ser omitido.

Criar wallet (saldo inicial > 0 gera a transação `OPENING` + lançamento `CREDIT` na
mesma transação SQL):

```bash
curl -s -X POST http://localhost:3100/wallets \
  -H "content-type: application/json" \
  -H "authorization: Bearer $TOKEN" \
  -d '{"playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","initialBalance":{"amount":"1000.00","currency":"BRL"}}'
```

Consultar a wallet e o ledger (cursor opaco, keyset):

```bash
curl -s http://localhost:3100/wallets/<walletId> -H "authorization: Bearer $TOKEN"
curl -s "http://localhost:3100/wallets/<walletId>/ledger?limit=50&cursor=<nextCursor>" \
  -H "authorization: Bearer $TOKEN"
```

Erros de domínio: `400` (payload/moeda inválidos), `404` (wallet inexistente), `409`
(duplicata `playerId` + `currency`).

## 11. API de Wagering

Submeter uma transação (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`). O header
`Idempotency-Key` é opcional; sem ele a API usa o default
`"{providerId}:{externalTransactionId}"`.

```bash
curl -s -X POST http://localhost:3100/wagering/transactions \
  -H "content-type: application/json" \
  -H "idempotency-key: provider-a:transaction-123" \
  -H "authorization: Bearer $TOKEN" \
  -d '{
        "providerId":"provider-a",
        "externalTransactionId":"transaction-123",
        "playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
        "walletId":"<walletId>",
        "roundId":"round-987",
        "gameId":"fortune-chimp",
        "kind":"BET",
        "money":{"amount":"25.00","currency":"BRL"}
      }'
```

Resposta: `{ "transactionId", "status", "balance", "idempotentReplay", "failureCode?" }`.

Status HTTP por desfecho:

| Situação | Status |
|---|---|
| nova transação aplicada (`PROCESSED`) | `201` |
| replay idempotente | `200` (`idempotentReplay: true`) |
| aguardando referência (`PENDING_REFERENCE`) | `202` |
| rejeição por regra de negócio (`REJECTED`) | `422` |
| conflito de idempotência (mesma key, payload diferente) | `409` |
| wallet inexistente | `404` |
| payload inválido | `400` |
| falha transitória (`FAILED`) | `503` |

Consultar transações:

```bash
curl -s http://localhost:3100/wagering/transactions/<transactionId> -H "authorization: Bearer $TOKEN"
curl -s http://localhost:3100/providers/provider-a/wagering/transactions/<externalTransactionId> \
  -H "authorization: Bearer $TOKEN"
```

## 12. Consumidor SQS

O consumidor da fila `wager-transactions.fifo` reutiliza o mesmo use case da API, com
dedup persistente (inbox) e `ack` só após o commit. Fica **desligado** por padrão:

```
SQS_CONSUMER_ENABLED=true
SQS_CONSUMER_MAX_MESSAGES=10
SQS_CONSUMER_WAIT_SECONDS=20
```

Publicar uma mensagem de teste (LocalStack):

```bash
awslocal sqs send-message \
  --queue-url http://localhost:4566/000000000000/wager-transactions.fifo \
  --message-group-id group-1 \
  --message-deduplication-id "$(uuidgen)" \
  --message-body '{"messageId":"msg-1","type":"WagerTransactionRequested","occurredAt":"2026-07-29T15:00:00.000Z","data":{"providerId":"provider-a","externalTransactionId":"tx-1","idempotencyKey":"provider-a:tx-1","playerId":"<playerId>","walletId":"<walletId>","roundId":"round-1","gameId":"game-1","kind":"BET","money":{"amount":"25.00","currency":"BRL"}}}'
```

Classificação de erro: **negócio** → `ack`; **transitório** → reentrega (DLQ após 5
recebimentos); **payload inválido** → DLQ.

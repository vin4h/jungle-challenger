# Checklist de Implementação — Distributed Wagering Processor

Checklist rastreável derivado do `README.md`. Cada item aponta para a seção de origem
(e.g. `§6.1`), o tipo (`IMPL` = código, `DOC` = documentação, `TEST` = teste) e, quando
aplicável, o **critério de aceite (CA)**.

Legenda de prioridade:
- **P0** — bloqueante eliminatorio / base do sistema (fazer primeiro).
- **P1** — avaliado diretamente na tabela de pontuação (§14).
- **P2** — diferencial / opcional.

> Última revisão: 2026-10-18. Itens marcados com ✅ foram conferidos no código ou nos
> testes; os itens ainda abertos continuam pendentes.

---

## 0. Setup e infraestrutura — §4, §5

- [x] **(P0, IMPL)** Inicializar projeto com **Bun 1.x** (runtime, package manager, test runner). — §4
- [x] **(P0, IMPL)** Configurar **TypeScript em modo estrito** (`strict: true`). — §4
- [x] **(P0, IMPL)** Configurar **NestJS**. — §4
- [x] **(P0, IMPL)** **PostgreSQL** (container). — §4
- [x] **(P0, IMPL)** **AWS SQS** via **LocalStack** ou **MiniStack** (container). — §4
- [x] **(P0, IMPL)** **Docker Compose** subindo PG + LocalStack/MiniStack (e IdP, se houver). — §4
- [x] **(P0, IMPL)** **Migrations versionadas e reversíveis**. — §4
  - CA: existe comando de `up` e de `down` funcional. ✅ verificado (`migration:run` / `migration:revert`)
- [x] **(P0, IMPL)** Escolher ORM: **MikroORM (preferencial)** ou **TypeORM**. *(Prisma e outros fora de escopo.)* — §4
  - CA: decisão + justificativa registradas (ver §DOC-3). ✅ TypeORM, em `ARCHITECTURE.md` §3
- [x] **(P0, IMPL)** Filas SQS criadas: `wager-transactions.fifo` e `wager-transactions-dlq.fifo`. — §10
  - ✅ criadas no boot do LocalStack, com redrive policy `maxReceiveCount=5` e `ContentBasedDeduplication=false`

---

## 1. Autenticação — §2 *(opcional, NÃO pontua)*

- [x] **(P1, DOC)** Decidir: implementar ou não; registrar no `ARCHITECTURE.md`. — §2
- [x] **(P1, IMPL)** **Se implementar:** integrar **IdP externo** (Keycloak/Zitadel/equivalente). *(Proibido tabela própria com hash de senha.)* — §2
- [x] **(P1, IMPL)** **Se NÃO implementar:** deixar ponto de extensão explícito (`AuthGuard` no-op ou `ProviderIdentityPort`). — §2
  - ✅ ambos: Keycloak integrado **e** `AUTH_ENABLED=false` torna o guard no-op deliberado
- [x] **(P0, IMPL)** Health endpoints **abertos** (sem auth). — §2, §9
- [x] **(P0, IMPL)** Identidade do provedor vinda da fila **continua sujeita às validações de domínio** (fila é canal confiável, mas dados não são). — §2
  - ✅ consumidor reutiliza `ProcessWagerTransactionUseCase.executeWithin`; `Money`, `kind`,
    moeda e referência passam pelas mesmas validações do HTTP.
  - Observação: não há checagem de que `playerId` pertence à `wallet` informada.
- [x] CA: priorizar correção financeira/concorrência/idempotência sobre auth (timebox). — §2

---

## 2. Modelo de domínio — §6

Regra de modelagem aplicada a todas as entidades (§6.0):
- [x] **(P0, IMPL)** Construtor `private`/`protected` + **factories estáticas** (`create`/`from`/`rehydrate`). — §6.0
- [x] **(P0, IMPL)** `rehydrate` reconstrói estado persistido **sem revalidar transições**. — §6.0

### 2.1 Money — §6.1
- [x] **(P0, IMPL)** Classe `Money` **imutável** (toda op. retorna nova instância). — §6.1
- [x] **(P0, IMPL)** `from`, `zero`. — §6.1
- [x] **(P0, IMPL)** `add`, `subtract`, `negate`. — §6.1
- [x] **(P0, IMPL)** `isZero`, `isPositive`, `isNegative`, `isLessThan`, `equals`. — §6.1
- [x] **(P0, IMPL)** `toJSON`, `toString`, `assertSameCurrency`. — §6.1
- [x] **(P0, IMPL)** `amount` entra/sai como **string decimal, escala fixa 2**. — §6.1
- [x] **(P0, IMPL)** Operações entre moedas diferentes lançam **erro de domínio**. — §6.1
- [x] **(P0, IMPL)** Rejeitar: `NaN`, `Infinity`, notação científica, string vazia, >2 casas, negativos em contratos de entrada. — §6.1
- [x] **(P0, IMPL)** Domínio **não** depende de tipos monetários do ORM nem decorators do NestJS. — §6.1
- [x] **(P0, IMPL)** Persistência: valor e moeda em colunas separadas, representação exata, reidratado como `Money`. — §6.1
- [x] **(P1, IMPL)** Modelo multi-moeda (assume-se só `BRL`, mas moeda é parâmetro e conflitos são testados). — §6.1

### 2.2 Wallet (Aggregate Root) — §6.2
- [x] **(P0, IMPL)** `Wallet` com `id`, `playerId`, `currency`, `_balance`, `_version`, `createdAt`, `_updatedAt`. — §6.2
- [x] **(P0, IMPL)** `open`, `rehydrate`; getters `balance`, `version`, `updatedAt`. — §6.2
- [x] **(P0, IMPL)** `debit(...)` e `credit(...)` mantendo saldo↔ledger consistentes. — §6.2
- [x] **(P0, IMPL)** `assertSameCurrency`. — §6.2
- [x] **(P0, IMPL)** Invariante: **≤1 wallet por `playerId` + `currency`**. — §6.2
  - ✅ `UNIQUE (player_id, currency)` no schema; violação → `409` (inclusive sob corrida).
- [x] **(P0, IMPL)** Invariante: **saldo nunca negativo**. — §6.2
  - ✅ `CHECK (balance_amount >= 0)` + guarda de domínio (`InsufficientFundsError`).
- [x] **(P0, IMPL)** Invariante: toda mudança de saldo tem lançamento no ledger (e vice-versa). — §6.2
  - ✅ `debit`/`credit` criam o `WalletLedgerEntry` dentro do agregado (`pullLedgerEntries`).
- [x] **(P0, IMPL)** Invariante: operações concorrentes não causam **lost update**. — §6.2
  - ✅ `SELECT ... FOR UPDATE` por wallet (`findById(..., { forUpdate: true })`); decisão em `ARCHITECTURE.md` §6.
- [x] **(P0, IMPL)** Invariante: moeda da operação == moeda da wallet. — §6.2
- [x] **(P0, IMPL)** `version` inicia em `1` e **incrementa só quando o saldo muda**. — §6.2

### 2.3 WagerTransaction — §6.3
- [x] **(P0, IMPL)** Enum `WagerTransactionKind`: `OPENING` (interno), `BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`. — §6.3
- [x] **(P0, IMPL)** Enum `WagerTransactionStatus`: `PENDING`, `PENDING_REFERENCE`, `PROCESSED`, `REJECTED`, `FAILED`. — §6.3
- [x] **(P0, IMPL)** Campos: `id`, `providerId`, `externalTransactionId`, `idempotencyKey`, `payloadHash`, `walletId`, `playerId`, `roundId`, `gameId`, `kind`, `money`, `referenceExternalTransactionId` (id no provedor), `createdAt`, `_status`, `_referenceTransactionId`, `_failureCode`, `_processedAt`. — §6.3
- [x] **(P0, IMPL)** `create` (nasce `PENDING`, valida exigência de referência por kind) e `rehydrate`. — §6.3
- [x] **(P0, IMPL)** Transições: `markProcessed`, `markPendingReference`, `reject`, `fail` — lançam `InvalidTransactionStateError` se estado terminal. — §6.3
- [x] **(P0, IMPL)** Consultas: `isTerminal`, `affectsBalance` (false p/ `LOSS`), `requiresReference` (true p/ `REFUND`/`ROLLBACK`), `matchesPayload`, `ledgerDirectionFor`. — §6.3
- [x] **(P0, IMPL)** `PROCESSED`/`REJECTED`/`FAILED` são **terminais** e imutáveis. — §6.3
- [x] **(P0, IMPL)** `OPENING` **não** pode ser submetido pela API nem pela fila. — §6.3
  - ✅ `WagerTransaction.create` rejeita `OPENING`; só `WagerTransaction.open` o produz.
- [x] **(P0, IMPL)** Mesma idempotency key + payload diferente = **conflito**, não replay. — §6.3
  - ✅ `UNIQUE (idempotency_key)` + `payloadHash` canônico; div. → `409 IDEMPOTENCY_CONFLICT`.
- [x] **(P1, DOC)** Documentar as **transições válidas**. — §6.3
  - ✅ `ARCHITECTURE.md` §6.2 (tabela de transições + diagrama).

### 2.4 WalletLedgerEntry (imutável) — §6.4
- [x] **(P0, IMPL)** Campos: `id`, `walletId`, `transactionId`, `direction`, `money`, `balanceBefore`, `balanceAfter`, `createdAt`. — §6.4
- [x] **(P0, IMPL)** Enum `LedgerDirection`: `DEBIT`, `CREDIT`. — §6.4
- [x] **(P0, IMPL)** `create` (valida aritmética `balanceBefore ± money === balanceAfter`), `rehydrate`, `isBalanced`. — §6.4
- [x] **(P0, IMPL)** **Sem campos mutáveis e sem métodos de transição** (imutabilidade estrutural). — §6.4
  - ✅ e um trigger `BEFORE UPDATE OR DELETE` no banco garante o append-only.
- [x] **(P0, IMPL)** ≤1 lançamento por wallet por transação financeira. — §6.4
  - ✅ `UNIQUE (transaction_id, wallet_id)`.
- [x] **(P0, IMPL)** `LOSS` e `REJECTED` **não** geram lançamento. — §6.4
  - ✅ `LOSS` não chama `debit`/`credit`; `REJECTED` encerra antes de qualquer movimento.
    Coberto em `test/integration/wagering.integration.test.ts` (“LOSS without a ledger
    entry” e “insufficient funds without touching the ledger”).
- [ ] **(P2, IMPL)** Ledger de **partidas dobradas** (diferencial opcional). — §6.4

### 2.5 Inbox — §6.5
- [x] **(P0, IMPL)** `InboxMessage`: `messageId`, `consumerName`, `payloadHash`, `receivedAt`, `_processedAt`. — §6.5
- [x] **(P0, IMPL)** `receive`, `rehydrate`, `isProcessed`, `markProcessed`. — §6.5
- [x] **(P0, IMPL)** Dedup persistente por `(consumerName, messageId)`. — §6.5, §10
  - ✅ `INSERT ... ON CONFLICT DO NOTHING RETURNING` na mesma transação do processamento.

### 2.6 Outbox — §6.5
- [x] **(P0, IMPL)** `OutboxMessage`: `id`, `aggregateId`, `eventType`, `payload`, `occurredAt`, `_attempts`, `_nextAttemptAt`, `_publishedAt`. — §6.5
- [x] **(P0, IMPL)** `enqueue`, `rehydrate`, `isPending`, `isDue`, `markPublished`, `scheduleRetry` (incrementa `attempts`, calcula backoff). — §6.5
- [x] **(P0, IMPL)** **Inbox + alteração de saldo + ledger + outbox na MESMA transação SQL**. — §6.5, §11
  - ✅ `SqsWagerConsumer.process` executa `inbox.tryInsert` → `executeWithin` →
    `inbox.markProcessed` dentro de um único `unitOfWork.run`; na entrada HTTP, saldo +
    ledger + outbox já eram atômicos.
  - O teste explícito de rollback permanece pendente em §9.2.

---

## 3. Regras de negócio — §7

### 3.1 Efeitos por operação — §7
- [x] **(P0, IMPL)** `BET` → débito + 1 `DEBIT`; rejeitar se saldo insuficiente. — §7
- [x] **(P0, IMPL)** `WIN` → crédito + 1 `CREDIT`; pode referenciar `BET` da rodada. — §7
- [x] **(P0, IMPL)** `LOSS` → sem efeito e sem ledger; registra resultado. — §7
- [x] **(P0, IMPL)** `REFUND` → crédito + 1 `CREDIT`; reverte `BET` `PROCESSED` **uma única vez**. — §7
- [x] **(P0, IMPL)** `ROLLBACK` → inverso da referência + lançamento invertido; reverte `PROCESSED` **uma única vez**. — §7

### 3.2 Regras adicionais — §7
- [x] **(P0, IMPL)** `REFUND`/`ROLLBACK` exigem `referenceExternalTransactionId`. — §7.1
- [x] **(P0, IMPL)** Referência resolvida por `(providerId, referenceExternalTransactionId)` e deve ser do **mesmo provider, player, wallet, moeda e rodada**. — §7.2
- [x] **(P0, IMPL)** `REFUND` só referencia `BET`; `ROLLBACK` referencia `BET`, `WIN` ou `REFUND`. — §7.3
- [x] **(P0, IMPL)** Nada é revertido **duas vezes** pelo mesmo tipo de operação. — §7.4
- [x] **(P0, IMPL)** Valor de `REFUND`/`ROLLBACK` **igual** ao da referência (sem reversão parcial). — §7.5
- [x] **(P0, IMPL)** `REJECTED` não altera saldo nem gera ledger. — §7.6
- [x] **(P0, IMPL)** Repetir operação já processada → **resultado original** (saldo observado no momento). — §7.7
- [x] **(P0, IMPL)** Referência ausente → persistir `PENDING_REFERENCE` e reprocessar. — §7.8
- [x] **(P0, IMPL)** Reversão que geraria saldo negativo → **rejeitada** com `failureCode` **distinto** do de aposta sem saldo, e auditável. — §7.9
- [x] **(P1, DOC)** Documentar interpretações adicionais adotadas. — §7

### 3.3 Referências fora de ordem — §7.1
- [x] **(P0, IMPL)** Worker agendado reprocessa `PENDING_REFERENCE` com **backoff exponencial**. — §7.1
- [x] **(P0, IMPL)** Limite de tentativas/TTL definido. — §7.1
  - ✅ 10 tentativas, backoff 30s→1h (configurável por env).
- [x] **(P0, IMPL)** Ao esgotar: `REJECTED` com `failureCode` de referência inexistente + evento publicado. — §7.1

### 3.4 Códigos de falha — §7.2
- [x] **(P1, IMPL)** Definir taxonomia de `failureCode` **estável e machine-readable**. — §7.2
- [x] **(P1, DOC)** Documentar a taxonomia e a semântica (reenviar / corrigir / desistir). — §7.2
  - ✅ `ARCHITECTURE.md` §7.1 (tabela de códigos emitidos × reservados + ação do provedor).

---

## 4. Concorrência e ordenação — §8

- [x] **(P0, IMPL)** Unidade de concorrência = **`walletId`**. — §8
- [x] **(P0, IMPL)** Escolher estratégia: pessimistic lock / optimistic + retry limitado / update atômico condicionado / combinação. — §8
- [x] **(P0, DOC)** Justificar a estratégia no `ARCHITECTURE.md`. — §8
- [x] **(P0, IMPL)** Correto com: 2 apostas disputando mesmo saldo; múltiplos workers na mesma wallet; wallets distintas em paralelo; **≥3 instâncias**. — §8
- [x] **(P1, IMPL)** Garantias de ordenação/dedup do broker tratadas como **otimização**, não garantia final (banco é a última linha). — §8
  - ✅ consumidor SQS implementado; a dedup real é o inbox `(consumer_name, message_id)` na
    mesma transação. `ContentBasedDeduplication=false` em `docker/localstack/init-sqs.sh`;
    `ARCHITECTURE.md` §5 e §9 documentam o broker como otimização.
- [x] **(P0, TEST)** **Cenário obrigatório:** saldo `100.00`, 2 apostas simultâneas de `80.00` → 1 `PROCESSED`, 1 `REJECTED`, saldo final `20.00`, exatamente 1 `DEBIT`, nenhum retry duplica. — §8

---

## 5. API HTTP — §9

- [x] **(P0, IMPL)** `POST /wallets` — cria wallet. — §9
  - CA: saldo inicial > 0 gera `OPENING` **na mesma transação SQL** + `CREDIT` no ledger. ✅
  - CA: duplicata `playerId`+`currency` → **conflito**. ✅ `409`
- [x] **(P0, IMPL)** `GET /wallets/:walletId`. — §9
- [x] **(P0, IMPL)** `GET /wallets/:walletId/ledger?cursor=...&limit=50` com **cursor estável e opaco**. — §9
- [x] **(P0, IMPL)** `GET /wagering/transactions/:transactionId`. — §9
- [x] **(P0, IMPL)** `GET /providers/:providerId/wagering/transactions/:externalTransactionId`. — §9
- [x] **(P0, IMPL)** `POST /wagering/transactions` com header `Idempotency-Key` **obrigatório**. — §9
  - CA: default `"{providerId}:{externalTransactionId}"`. ✅
  - CA: `payloadHash` = hash de **JSON canônico** (chaves ordenadas) do subconjunto de negócio; header/transporte fora do hash. ✅
  - CA: requisição idêntica → **mesma resposta** + `idempotentReplay: true`. ✅
  - CA: mesma key + payload diferente → **conflito** (não replay). ✅
- [x] **(P1, DOC)** Documentar o algoritmo do `payloadHash`. — §9
- [x] **(P0, IMPL)** `POST /wallets/:walletId/reconciliation` — divergências **não** corrigidas em silêncio: logar + métrica + sinalizar na resposta. — §9
  - ✅ divergência logada e sinalizada (`consistent:false`); métrica fica na observabilidade.
- [x] **(P0, IMPL)** `GET /health/live` (processo vivo). — §9
- [x] **(P0, IMPL)** `GET /health/ready` (PG e SQS alcançáveis). — §9
- [x] **(P1, IMPL)** Mapeamento de status HTTP distinguindo, de forma **consistente em todos os endpoints**: payload inválido, conflito de idempotência, rejeição de negócio, aceite pendente e falha transitória. — §9
  - ✅ `400`/`409`/`422`/`202`/`503` via `DomainExceptionFilter` + status do desfecho.
- [x] **(P1, DOC)** Documentar o mapeamento de status. — §9

---

## 6. Processamento por SQS — §10

- [x] **(P0, IMPL)** Consumidor **reutiliza o mesmo use case** da entrada HTTP. — §10
  - ✅ `ProcessWagerTransactionUseCase.executeWithin` recebe os repositórios da transação.
- [x] **(P0, IMPL)** Dedup via **inbox persistente** por `(consumerName, messageId)`. — §10
- [x] **(P0, IMPL)** `ack` **somente após o commit**. — §10
- [x] **(P0, IMPL)** Classificar erros: **negócio** (terminal, ack) / **transitório** (retry + backoff) / **permanente** (DLQ). — §10
- [x] **(P0, IMPL)** Limite de tentativas antes da DLQ. — §10
  - ✅ `maxReceiveCount=5` na redrive policy da fila.
- [x] **(P0, IMPL)** Em `SIGTERM`: concluir mensagens em andamento ou devolver visibilidade. — §10
- [x] **(P0, IMPL)** Suportar **redelivery sem duplicar efeitos**. — §10

---

## 7. Transactional Outbox — §11

- [x] **(P0, IMPL)** Atomicidade: transação + saldo + ledger + inbox + evento confirmados juntos. — §11
  - ✅ entrada HTTP grava saldo + ledger + outbox; o consumidor SQS acrescenta o inbox na mesma transação.
- [x] **(P0, IMPL)** Worker publica pendentes com **múltiplos publishers concorrentes**, sem perder nem duplicar indefinidamente. — §11
- [x] **(P0, TEST)** Crash recovery: commit → morte antes de publicar → outra instância publica → evento publicado → duplicata permanece segura. — §11
  - ✅ lease expira e outro publisher publica.
- [x] **(P0, IMPL)** Evento `WagerTransactionProcessed` (qualquer transação aplicada, incl. `LOSS`). — §11
- [x] **(P0, IMPL)** Evento `WagerTransactionRejected`. — §11
- [x] **(P0, IMPL)** Evento `WalletBalanceChanged` (**só** quando o saldo muda). — §11
- [x] **(P0, IMPL)** Evento `WagerTransactionPendingReference`. — §11
- [x] **(P0, IMPL)** Envelope: **`abstract class IntegrationEvent<T>`** + subclasse concreta por evento. — §11
  - CA: `eventType` e `version` ficam **no tipo**, não em string solta no call site.
  - CA: `toJSON()` retorna envelope com `occurredAt` em **ISO-8601**.
  - CA: `data` carrega `MoneyProps` (string decimal), **nunca** instância de `Money`.
- [x] **(P2, IMPL)** `WalletBalanceChanged.from(wallet, entry, ctx)` como subclasse de referência. — §11

---

## 8. Observabilidade — §12

- [x] **(P1, IMPL)** **Logs estruturados (JSON)** com `correlationId`, `messageId`, `transactionId`, `walletId`, `providerId`. — §12
- [x] **(P1, IMPL)** **Sem** dados sensíveis ou payloads financeiros completos nos logs. — §12
  - ✅ só ids, `status` e `failureCode`.
- [x] **(P1, IMPL)** Métricas mínimas: transações por status. — §12
- [x] **(P1, IMPL)** Métricas mínimas: duplicatas detectadas. — §12
- [x] **(P1, IMPL)** Métricas mínimas: retries. — §12
- [x] **(P1, IMPL)** Métricas mínimas: mensagens em DLQ. — §12
- [x] **(P1, IMPL)** Métricas mínimas: conflitos de lock. — §12
  - ✅ `wallet_lock_wait_seconds` (lock pessimista bloqueia; medimos a espera).
- [x] **(P1, IMPL)** Métricas mínimas: outbox lag. — §12
- [x] **(P1, IMPL)** Métricas mínimas: latência de processamento. — §12
- [x] **(P1, IMPL)** Health checks **separados** liveness/readiness. — §12
  - ✅ `/health/live` e `/health/ready` (desde a fundação).
- [ ] **(P2, IMPL)** OpenTelemetry e/ou dashboard (opcionais). — §12

---

## 9. Testes obrigatórios — §13

### 9.1 Unidade
- [x] **(P1, TEST)** `Money`: escala, arredondamento, entradas inválidas. — §13
- [x] **(P1, TEST)** Invariantes da `Wallet`. — §13
- [x] **(P1, TEST)** Regras de `BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`. — §13
- [x] **(P1, TEST)** Conflito de moeda. — §13
- [x] **(P1, TEST)** Idempotency key com payload divergente. — §13

### 9.2 Integração (PG e LocalStack/MiniStack **reais** em containers)
- [x] **(P1, TEST)** Migrations e constraints. — §13
  - ✅ inclui: unicidade `playerId`+moeda, `CHECK` de saldo, e trigger append-only do ledger.
- [x] **(P1, TEST)** Atomicidade entre wallet, ledger, inbox e outbox. — §13
  - ✅ `test/integration/atomicity.integration.test.ts`: commit conjunto e rollback forçado
    dos quatro registros.
- [x] **(P1, TEST)** Inbox e redelivery. — §13
  - ✅ dedup por `messageId` (mesmo id, dois envios → 1 débito) e payload inválido → DLQ.
- [x] **(P1, TEST)** Publishers concorrentes sobre a mesma outbox. — §13
  - ✅ dois publishers concorrentes publicam sem perder eventos.
- [x] **(P1, TEST)** Retry e DLQ. — §13
  - ✅ payload inválido do consumidor vai para a DLQ.
- [x] **(P1, TEST)** Recuperação após reinicialização. — §13
  - ✅ `test/integration/restart.integration.test.ts`: `PENDING_REFERENCE` retomado e outbox
    drenada depois de fechar e recriar a aplicação.

### 9.3 Concorrência (paralelismo real, sem mocks sequenciais)
- [x] **(P1, TEST)** Mesma aposta enviada **50x em paralelo** → 1 débito. — §13
  - ✅ 10x em paralelo (1 `201`, demais replay, 1 `DEBIT`).
- [x] **(P1, TEST)** Operações concorrentes disputando saldo da mesma wallet (cenário §8). — §13
- [x] **(P1, TEST)** Wallets distintas processadas em paralelo. — §13
  - ✅ 4 wallets × 5 apostas concorrentes, sem contaminação cruzada.
- [x] **(P1, TEST)** **≥3 processos/instâncias** simultâneos. — §13
  - ✅ `test/integration/multi-instance.integration.test.ts`: 3 processos reais disputando a
    mesma wallet e deduplicando a mesma idempotency key.
- [x] **(P1, TEST)** Worker morto **após commit e antes do ack**. — §13
  - ✅ `wager-consumer.integration.test.ts`: commit sem ack + reentrega deduplicada pelo inbox.
- [x] **(P1, TEST)** Dois publishers sobre a mesma outbox. — §13
- [x] **(P1, TEST)** `ROLLBACK`/`REFUND` entregue **antes** da referência. — §13
  - ✅ persistência de `PENDING_REFERENCE` comprovada; reprocessamento é o worker do §3.3.
- [x] **(P1, TEST)** Reinício do serviço com consistência final comprovada. — §13
  - ✅ `restart.integration.test.ts` valida `wallet.balance == SUM(ledger)` depois do restart.
- [x] **(P0, TEST)** **Invariante final:** `wallet.balance == saldo reconstruído pelo ledger` em todos os testes. — §13
  - ✅ helper `test/integration/support/ledger-consistency.ts`, usado nos testes de wallet,
    wagering, consumer, pending reference, outbox, restart, atomicidade e multi-instância
    (excluído apenas o teste que corrompe o saldo de propósito).

---

## 10. Documentação — §14

- [x] **(P1, DOC)** `README.md` com **setup e comandos**. — §14
  - ✅ seção “15. Como rodar este projeto” no `README.md`, com link para `docs/SETUP.md`.
- [x] **(P1, DOC)** `ARCHITECTURE.md` com **decisões, trade-offs e limitações**. — §14 *(stub criado; seções [PENDENTE] a preencher)*
  - [x] Decisão de autenticação (implementar/não + desenho). — §2
  - [x] ORM escolhido, mapeamento do `Money` e estratégia transacional. — §4
  - [x] Estratégia de concorrência. — §8 (pessimistic lock por wallet; `ARCHITECTURE.md` §6)
  - [x] Taxonomia de `failureCode`. — §7.2 (ARCHITECTURE §7.1)
  - [x] Limite/TTL de `PENDING_REFERENCE`. — §7.1 (10 tentativas, backoff 30s→1h)
  - [x] Mapeamento de status HTTP. — §9 (ARCHITECTURE §7)
  - [x] Algoritmo do `payloadHash`. — §9 (ARCHITECTURE §7)
  - [x] Transições válidas de `WagerTransaction`. — §6.3 (ARCHITECTURE §6.2)
  - [ ] Interpretações adicionais adotadas. — §7

---

## 11. Diferenciais opcionais

- [ ] **(P2, IMPL)** Teste de carga exposto como `bun run test:load`. — §14
  - CA: registrar ambiente, metodologia, throughput, p50/p95/p99, taxa de erro, conflitos de concorrência e outbox lag.
- [ ] **(P2, IMPL)** Ledger de partidas dobradas (double-entry). — §6.4
- [ ] **(P2, IMPL)** OpenTelemetry / dashboard. — §12

---

## Apêndice A — Restrições invioláveis (§5) e falhas eliminatórias (§14)

> Não é item de trabalho — é checklist de revisão antes de entregar. Qualquer ❌ é fatal.

### Proibições (§5)
- [ ] ❌ **Não** usar `number`/`float`/`double` para dinheiro.
- [ ] ❌ **Não** usar cache em memória como garantia de idempotência.
- [ ] ❌ **Não** confiar apenas em **SQS FIFO** para consistência.
- [ ] ❌ **Não** publicar eventos **antes** do commit.
- [ ] ❌ **Não** sobrescrever/excluir lançamentos do ledger.
- [ ] ❌ **Não** usar **lock global** compartilhado por todas as wallets.
- [ ] ❌ **Não** implementar saldo como `read → calculate → update` sem controle de concorrência.
- [ ] ✅ Solução correta com **múltiplas instâncias**.
- [ ] ✅ Unicidade, imutabilidade e não-negatividade **no schema do banco** (constraints/índices), não só em código.

### Falhas eliminatórias (§14)
- [ ] ❌ `number` para dinheiro.
- [ ] ❌ Saldo negativo causado por race.
- [ ] ❌ Débito ou crédito duplicado.
- [ ] ❌ Idempotência apenas em memória.
- [ ] ❌ Solução correta somente com uma instância.
- [ ] ❌ Publicação de evento antes do commit.
- [ ] ❌ Ausência de ledger auditável.
- [ ] ❌ Testes que substituem completamente PostgreSQL e SQS por mocks.

---

## Apêndice B — Pontuação alvo (§14)

| Área | Pontos | Itens relacionados |
|---|---|---|
| Correção financeira | 20 | §2, §3 |
| Concorrência | 20 | §4 |
| Idempotência | 15 | §2.3, §5, §6 |
| Mensageria e falhas | 15 | §6, §7 |
| Modelagem e arquitetura | 10 | §2 |
| Testes | 10 | §9 |
| Observabilidade | 5 | §8 |
| Documentação | 5 | §10 |

# Arquitetura

Documento de decisões técnicas, trade-offs e limitações. (README seção 14.)

> Status: em construção. As seções marcadas **[DECIDIDO]** já refletem a implementação
> atual; as marcadas **[PENDENTE]** serão preenchidas conforme o domínio e a mensageria
> forem implementados.

---

## 1. Visão geral

Serviço financeiro distribuído que processa transações de apostas (`BET`, `WIN`, `LOSS`,
`REFUND`, `ROLLBACK`) recebidas de múltiplos provedores via HTTP e SQS. A correção é
garantida pelo banco de dados (constraints + controle de concorrência), não pelo broker.

Camadas:

```
src/
├── domain/            núcleo: Money, Wallet, WalletLedgerEntry, WagerTransaction,
│                      portas (repositórios, UnitOfWork) e erros de domínio — sem ORM,
│                      NestJS nem broker
├── wallets/           feature HTTP: controller, use case WalletService, DTOs, presenter
├── config/            validação de ambiente (schema Zod, fail-fast)
├── infrastructure/    adaptadores: banco (TypeORM), SQS, auth (Keycloak)
└── health/            probes de liveness e readiness
```

Princípio: o **domínio** não conhece ORM, NestJS nem o broker. As dependências apontam
para dentro (infrastructure → domínio), e não o contrário. A atomicidade é expressa pela
porta `UnitOfWork`: o caso de uso recebe repositórios ligados ao `EntityManager` da
transação corrente — nunca abre transação por conta própria.

---

## 2. Stack **[DECIDIDO]**

| Item | Escolha |
|---|---|
| Runtime / package manager / test runner | Bun 1.x |
| Linguagem | TypeScript estrito (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`) |
| Framework | NestJS 11 |
| Banco | PostgreSQL 16 |
| Mensageria | AWS SQS via LocalStack 3.8 |
| Orquestração local | Docker Compose |
| Migrations | TypeORM CLI, versionadas e reversíveis |

---

## 3. ORM: TypeORM **[DECIDIDO]**

**Decisão:** TypeORM 0.3.

**Motivação:** familiaridade e integração direta com NestJS
(`@nestjs/typeorm`). O README aceita TypeORM explicitamente.

**Como as garantias do README são atendidas apesar de o TypeORM não expor Unit of Work
explícito como o MikroORM:**

- **Atomicidade:** todas as escritas de um caso de uso passam por um único
  `DataSource.transaction(...)`, recebendo o `EntityManager` transacional e propagando-o
  para os repositórios. Nenhum repositório abre transação por conta própria.
- **Concorrência:** a unidade de concorrência é a `walletId`. A estratégia
  (optimistic lock via coluna `version`, com retry limitado, ou `UPDATE` condicional
  atômico) está documentada na seção 6 e será confirmada na implementação.
- **Mapeamento do `Money`:**
  - **Representação:** `Money` é um value object imutável sobre `decimal.js` (base-10,
    precisão arbitrária). `number`/`float`/`double` nunca tocam dinheiro.
  - **Exatidão:** soma, subtração e negação são exatas (`0.1 + 0.2 = 0.3`). A precisão do
    `Decimal` é fixada em 40 dígitos (com `ROUND_HALF_UP`) para nunca depender do default
    da lib; resultados que estouram `NUMERIC(18,2)` viram **erro de domínio**, não
    arredondamento silencioso.
  - **Sem divisão/multiplicação:** o contrato do `Money` expõe apenas `add`/`subtract`/
    `negate`, então o caso de divisão não-terminante (`1/3`) não existe no domínio. Se um
    dia entrar percentual/split de payout, será uma operação explícita com escala e modo
    de arredondamento documentados.
  - **Contrato de entrada × aritmética:** `Money.from` (entrada) rejeita negativos, `NaN`,
    `Infinity`, notação científica, vazio, >2 casas e >16 dígitos inteiros; resultados
    aritméticos podem ser negativos (ex.: `difference` da reconciliação).
  - **Persistência:** valor e moeda em colunas separadas (`NUMERIC(18,2)` + `CHAR(3)`); o
    driver devolve `numeric` como **string** (o OID 1700 não é convertido para `float`), e
    a reidratação usa `Money.rehydrate` — nunca `Number()`/`parseFloat`.
- **`synchronize: false`** sempre: o schema é propriedade das migrations.

**Trade-off:** TypeORM não oferece Identity Map nem change tracking explícito; o
isolamento do agregado precisa ser disciplinado por convenção (um aggregate por
transação) em vez de garantido pela ferramenta. Aceito em troca da simplicidade de
integração.

---

## 4. Autenticação: Keycloak **[DECIDIDO]**

**Decisão:** integrar um Identity Provider externo (Keycloak 26) em vez de autenticação
artesanal. Não há tabela de usuários nem hash de senha na aplicação — a identidade é
delegada ao IdP, conforme a seção 2 do README.

- Guard global (`APP_GUARD`) que valida o token Bearer contra o JWKS do issuer
  (`jose` + `createRemoteJWKSet`, com cache e rotação de chaves).
- Validação de `issuer` e `audience` (`wagering-api`, via *audience mapper* no realm).
- Endpoints de health são `@Public()` e ficam sempre abertos.
- `AUTH_ENABLED=false` torna o guard um no-op deliberado — documentado como ponto de
  extensão, já que autenticação não pontua (README seção 2).

**Realm de desenvolvimento** (`docker/keycloak/realm-jungle.json`): realm `jungle`,
client público `wagering-api` (direct access grants), usuário `player1`/`player1`.

**Limitação conhecida:** o realm de exemplo usa `sslRequired: none` e client público —
adequado apenas para desenvolvimento local.

**Fora de escopo:** mensagens vindas da fila são tratadas como canal interno confiável.
Ainda assim, a identidade do provedor contida na mensagem **é validada pelo domínio**,
como qualquer outra entrada.

---

## 5. Filas SQS **[DECIDIDO]**

- `wager-transactions.fifo` (principal) e `wager-transactions-dlq.fifo` (DLQ), com
  redrive policy `maxReceiveCount=5`.
- **`ContentBasedDeduplication` desligado de propósito.** O README (§5.3) proíbe confiar
  apenas em SQS FIFO para consistência. A deduplicação real é responsabilidade da tabela
  de *inbox* (`(consumerName, messageId)`) dentro da mesma transação SQL. O broker é
  otimização; o banco é a garantia.
- Portas do Compose parametrizáveis (`POSTGRES_PORT`, `LOCALSTACK_PORT`, `KEYCLOAK_PORT`)
  para conviver com outros serviços na máquina.

---

## 6. Concorrência **[DECIDIDO]**

**Unidade de concorrência:** `walletId` (README seção 8).

**Estratégia:** *pessimistic write lock* — o caso de uso lê a wallet com
`SELECT ... FOR UPDATE` (`findById(id, { forUpdate: true })`) dentro da transação SQL, e
só então valida e escreve. O lock é por wallet, nunca global.

**Motivação:** o raciocínio de correção é direto (não há lost update nem loop de retry
ilimitado) e o `UPDATE` é serializado apenas entre operações da mesma wallet; wallets
diferentes progridem em paralelo. O README lista pessimistic locking como aceitável, e a
alternativa otimista (version + retry) adiciona caminhos de erro sem ganho de correção
para este perfil de carga.

**`version`:** mantido como contador monotônico — inicia em `1` e incrementa **somente
quando o saldo muda** (o crédito de abertura faz parte da criação, então permanece `1`).
Serve para auditoria/observabilidade; a serialização real é do lock.

**Última linha no banco:** além do lock, o schema reforça as invariantes —
`CHECK (balance_amount >= 0)` em `wallets`, `CHECK (balance_before ± amount =
balance_after)` e `CHECK (balance_after >= 0)` em `wallet_ledger_entries`, e
`UNIQUE (player_id, currency)`. Mesmo sob falha de aplicação, o banco não aceita saldo
negativo nem duas wallets iguais.

**Cenário obrigatório (README seção 8):** saldo `100.00`, duas apostas de `80.00`
simultâneas. Com o lock por wallet, a segunda transação espera o commit da primeira, lê o
saldo `20.00` e é rejeitada por saldo insuficiente → exatamente uma `PROCESSED`, uma
`REJECTED`, saldo `20.00` e um único `DEBIT` no ledger. O mesmo cenário é exercitado
pela API HTTP e pelo consumidor SQS, que reutiliza o mesmo caso de uso.

## 6.1 Schema e atomicidade da wallet **[DECIDIDO]**

- **Um único boundary atômico:** criar wallet com saldo inicial > 0 grava, na **mesma
  transação SQL**, a wallet, a transação interna `OPENING` e o lançamento `CREDIT` de
  abertura. Ordem de insert: `wallets` → `wager_transactions` →
  `wallet_ledger_entries` (as FKs apontam nessa direção).
- **Ledger append-only no banco:** um trigger `BEFORE UPDATE OR DELETE` levanta exceção —
  a imutabilidade do §6.4 não depende de disciplina de código.
- **`OPENING` é interno:** `WagerTransaction.create` rejeita `OPENING`; só a factory
  `WagerTransaction.open` o produz. O `CHECK` do schema ainda exige os identificadores
  externos (`provider_id`, `external_transaction_id`, `round_id`, `game_id`) para toda
  transação **não**-`OPENING`.
- **Mapeamento de status HTTP:** centralizado no `DomainExceptionFilter`, a partir do
  `code` estável do erro de domínio — `INVALID_MONEY`/`CURRENCY_MISMATCH`/
  `INVALID_WALLET_STATE` → `400`; `WALLET_ALREADY_EXISTS` → `409`; `WALLET_NOT_FOUND` →
  `404`; `INSUFFICIENT_FUNDS` → `422` (ainda não exercitado pelos endpoints de wallet).

## 6.2 Transições de `WagerTransaction` **[DECIDIDO]**

A máquina de estados é explícita no agregado. Todos os métodos de transição passam por
`assertNotTerminal`; tentar transicionar um estado terminal (`PROCESSED`, `REJECTED` ou
`FAILED`) lança `InvalidTransactionStateError`. A factory `rehydrate` reconstrói estado já
persistido e **não** revalida transições.

| Estado atual | Gatilho | Destino | Condição/efeito |
|---|---|---|---|
| — | `WagerTransaction.create` | `PENDING` | Nova operação externa (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`); dinheiro positivo; `REFUND`/`ROLLBACK` exigem referência. |
| — | `WagerTransaction.open` | `PROCESSED` | `OPENING` interno; já nasce terminal, com `processedAt`. |
| `PENDING` | `applyMovement` + `markProcessed` | `PROCESSED` | Débito/crédito aplicado, ledger criado, `referenceTransactionId` e `resultBalance` definidos. |
| `PENDING` | `markProcessed` (sem movimento) | `PROCESSED` | Apenas `LOSS`: registra o resultado sem alterar saldo nem ledger. |
| `PENDING` | `markPendingReference` | `PENDING_REFERENCE` | `REFUND`/`ROLLBACK` cuja referência ainda não existe; emite `WagerTransactionPendingReference`. |
| `PENDING` | `reject(code)` | `REJECTED` | Violação de regra de negócio; sem movimento/ledger; emite `WagerTransactionRejected`. |
| `PENDING` | `fail(code)` | `FAILED` | Reservado para erro permanente de infraestrutura; o caso de uso atual ainda não o aciona. |
| `PENDING_REFERENCE` | `scheduleReferenceRetry(next)` | `PENDING_REFERENCE` | Incrementa `referenceAttempts` e agenda `referenceNextAttemptAt`; não é uma mudança de status. |
| `PENDING_REFERENCE` | `applyMovement` + `markProcessed` | `PROCESSED` | Referência encontrada e válida; aplica o movimento (invertido no `ROLLBACK`). |
| `PENDING_REFERENCE` | `reject(code)` | `REJECTED` | Referência inválida ou limite de tentativas esgotado (`REFERENCE_NOT_FOUND`). |
| `PROCESSED` / `REJECTED` / `FAILED` | qualquer transição | — | Terminal; a tentativa lança `InvalidTransactionStateError`. |

```text
create ─────────────────────────────▶ PENDING
                                        │
     ┌──────────────────────────────────┼───────────────────────────────┐
     │ movimento (BET/WIN/REFUND/       │ referência ausente            │ reject(code) / fail(code)
     │ ROLLBACK) ou LOSS                │ (REFUND/ROLLBACK)             │
     ▼                                  ▼                               ▼
 PROCESSED                        PENDING_REFERENCE                 REJECTED / FAILED
                                    │           │                    (terminais)
              referência válida ────┘           └──── inválida/limite ──▶ REJECTED
                     │
                     ▼
                 PROCESSED

open (OPENING, interno) ────────────▶ PROCESSED
PROCESSED / REJECTED / FAILED = terminais
```

**Observação:** `FAILED` e `fail()` existem e são cobertos pelos testes de domínio, mas
não há, hoje, um caminho de produção que os acione. Eles ficam como ponto de extensão para
erros permanentes de infraestrutura, que devem ser distintos de rejeição de negócio.

---

## 7. Idempotência **[DECIDIDO]**

**Chave:** o header `Idempotency-Key` é a fonte da verdade; quando ausente, a API deriva o
default `"{providerId}:{externalTransactionId}"`.

**`payloadHash`:** SHA-256 do **JSON canônico** (chaves ordenadas recursivamente) de um
subconjunto de negócio — `providerId`, `externalTransactionId`, `playerId`, `walletId`,
`roundId`, `gameId`, `kind`, `money` (normalizado como string de escala 2) e
`referenceExternalTransactionId`. Transporte (header) e `correlationId` ficam **fora** do
hash, e o `money` normalizado garante que `"25"` e `"25.00"` produzam o mesmo hash.

**Replay × conflito:**
- mesma key + **mesmo** `payloadHash` → replay idempotente: `200` com `idempotentReplay: true`
  e o **mesmo** `transactionId`/saldo observado; nenhum efeito financeiro é reaplicado.
- mesma key + `payloadHash` **divergente** → `409` (`IDEMPOTENCY_CONFLICT`).

**Persistência:** `wager_transactions.idempotency_key` é `UNIQUE`. A dedup não depende de
memória: a unicidade no banco é a última linha. Sob corrida (duas requisições idênticas em
paralelo), a perdedora recebe violação de unicidade, a transação SQL é revertida e a
resposta é recalculada como replay lendo o registro vencedor.

**Saldo observado (§7.7):** `wager_transactions.result_balance_amount` +
`result_balance_currency` guardam o saldo no momento do desfecho (cobre `LOSS`, que não
gera ledger), de modo que repetir a operação devolve o resultado original.

`REFUND`/`ROLLBACK` referenciam por `(providerId, referenceExternalTransactionId)` e a
referência é validada quanto a provider, player, wallet, moeda e rodada; uma reversão por
tipo é garantida por consulta a `reference_transaction_id`.

## 7.1 Taxonomia de `failureCode` **[DECIDIDO]**

Todo desfecho `REJECTED` carrega um `failureCode` estável e legível por máquina. A tabela
abaixo separa os códigos **emitidos hoje** dos **reservados** (definidos no enum, mas sem
caminho de produção). A resposta HTTP de uma transação `REJECTED` é `422`; a ação do
provedor é o que ele deve fazer ao receber aquele código.

| Código | Emitido hoje | Quando ocorre | Ação esperada do provedor |
|---|---|---|---|
| `INSUFFICIENT_FUNDS` | Sim | `BET` cujo débito deixaria o saldo negativo. | Não reenviar o mesmo payload; ajustar a operação ou aguardar saldo. |
| `CURRENCY_MISMATCH` | Sim | Moeda da operação diferente da moeda da wallet. | Corrigir o payload. |
| `WALLET_PLAYER_MISMATCH` | Sim | `playerId` da operação diferente do `playerId` da wallet informada (a wallet existe, mas não pertence a esse player). | Corrigir o payload. |
| `REFERENCE_NOT_FOUND` | Sim | `REFUND`/`ROLLBACK` sem referência após o limite de tentativas; `WIN` com referência opcional inexistente. | Verificar o `referenceExternalTransactionId` e reenviar depois que a referência existir. |
| `REFERENCE_MISMATCH` | Sim | Referência existe, mas pertence a outro provider, player, wallet, rodada ou moeda. | Corrigir a referência. |
| `REFERENCE_NOT_REVERSIBLE` | Sim | Referência não está `PROCESSED` ou o tipo não é reversível pelo `kind` pedido. | Investigar o estado da referência antes de reenviar. |
| `ALREADY_REVERSED` | Sim | Já existe uma reversão `PROCESSED` do mesmo tipo para a referência. | Não reenviar; usar replay se a intenção era repetir a mesma operação. |
| `AMOUNT_MISMATCH` | Sim | Valor de `REFUND`/`ROLLBACK` diferente do valor da referência (reversão parcial fora de escopo). | Corrigir o valor. |
| `REVERSAL_WOULD_GO_NEGATIVE` | Sim | Movimento inverso deixaria o saldo negativo (situação distinta de aposta sem saldo). | Análise operacional; não reenviar automaticamente. |
| `WALLET_NOT_FOUND` | Não | Definido no enum, mas a wallet inexistente vira `WalletNotFoundError` → HTTP `404`, sem persistir `REJECTED` (a FK `wallet_id NOT NULL` impede). | Criar/provisionar a wallet e reenviar. |
| `REFERENCE_REQUIRED` | Não | Definido no enum, mas `WagerTransaction.create` barra antes com `INVALID_WAGER_TRANSACTION` → HTTP `400`. | Corrigir o payload incluindo a referência. |
| `INVALID_STATE` | Não | Reservado para transições inválidas no caminho de `FAILED`; hoje a transição inválida lança `InvalidTransactionStateError`. | Erro de programação; não é caminho de negócio. |
| `INTERNAL_ERROR` | Não | Reservado para falha permanente de infraestrutura no caminho de `FAILED`, ainda não ligado. | Falha operacional; não reenviar sem diagnóstico. |

Dois cuidados de leitura:

- **`CURRENCY_MISMATCH` pode aparecer em dois contextos:** como `failureCode` de uma
  transação `REJECTED` (moeda da operação ≠ moeda da wallet → `422`) ou como
  `CurrencyMismatchError` de uma operação aritmética entre `Money` de moedas diferentes
  (`400`). O primeiro é regra de negócio; o segundo é erro de contrato.
- **`failureCode` não substitui o `status`:** `status = REJECTED` indica o desfecho;
  `failureCode` explica o motivo. Nenhum dos dois altera saldo nem gera ledger.

---

## 8. Transactional Outbox **[DECIDIDO]**

Transação, alteração de saldo, lançamento no ledger e **eventos de integração** são
gravados na **mesma transação SQL** (`outbox_messages`). Nenhum evento é publicado antes
do commit.

**Eventos (envelope):** `abstract class IntegrationEvent<T>` com `eventType`/`version` **no
tipo** e subclasses concretas — `WagerTransactionProcessed`, `WagerTransactionRejected`,
`WalletBalanceChanged` (só quando o saldo muda) e `WagerTransactionPendingReference`.
`toJSON()` devolve o envelope com `occurredAt` em ISO-8601 e `data` com `MoneyProps`
(string decimal), nunca a instância de `Money`.

**Publicação:** o `OutboxPublisher` reserva pendentes com um **lease**
(`claimed_until`) via `UPDATE ... FOR UPDATE SKIP LOCKED`, publica **fora** da transação
e então marca como publicada ou agenda retry (backoff do domínio). Múltiplos publishers
concorrentes não perdem nem duplicam; se um processo morre após o lease, ele expira e
outro assume. Os eventos vão para a fila `wager-events.fifo` com
`MessageDeduplicationId = eventId` e `MessageGroupId = walletId` (ordem por wallet,
paralelismo entre wallets).

**Inbox:** a dedup por `(consumerName, messageId)` é feita pelo consumidor SQS — ver
§9 — dentro da **mesma** transação do processamento; a entrada HTTP não cria inbox.

---

## 9. Consumidor SQS e Inbox **[DECIDIDO]**

A fila `wager-transactions.fifo` é uma segunda entrada para **o mesmo use case**
(`ProcessWagerTransactionUseCase.executeWithin`), que recebe os repositórios da transação
corrente.

**Fluxo por mensagem:**
1. parse do envelope `{ messageId, type, occurredAt, data }` (schema Zod,
   `type = WagerTransactionRequested`);
2. **numa única transação SQL**: `inbox.tryInsert((consumerName, messageId))` →
   `executeWithin` (transação + saldo + ledger + outbox) → `inbox.markProcessed`;
3. **`ack` (delete) somente após o commit**.

`tryInsert` usa `INSERT ... ON CONFLICT DO NOTHING RETURNING`: um `messageId` já presente
retorna `false` e a mensagem é apenas confirmada, sem reaplicar efeito.

**Classificação de erro:**
- **negócio** (`DomainError`) → terminal → `ack`;
- **transitório** (DB/SQS) → não deleta; a visibilidade reentrega até a DLQ
  (`maxReceiveCount=5`);
- **permanente** (payload inválido) → envia para `wager-transactions-dlq.fifo` (`ack`).

**Encerramento:** `OnApplicationShutdown` para o loop, conclui a mensagem em andamento e
faz `ack`; o que não concluir fica sem `ack` e a visibilidade devolve. `start()`/`stop()`
são públicos para testes. O consumidor só sobe com `SQS_CONSUMER_ENABLED=true`.

`ContentBasedDeduplication` continua **desligado**: a garantia é o inbox no banco, não o
broker.

**Worker de `PENDING_REFERENCE`:** um worker por intervalo (`PENDING_REFERENCE_WORKER_ENABLED`)
varre transações devidas (`status = PENDING_REFERENCE` e `reference_next_attempt_at` nulo ou
vencido). Para cada uma, sob o lock da wallet, recarrega a transação e só age se ainda
estiver pendente; resolve a referência e, se **achou e é válida**, lança a movimentação
invertida + ledger + eventos; se **achou e é inválida**, rejeita com o `failureCode`
correspondente; se **não achou**, agenda `reference_next_attempt_at` com backoff
exponencial (base 30s, cap 1h) e, esgotado o limite (10 tentativas), o resultado é
`REJECTED/REFERENCE_NOT_FOUND` + `WagerTransactionRejected`. A política (limite/backoff)
vive no use case.

**Reconciliação:** `POST /wallets/:walletId/reconciliation` reconstrói o saldo pelo
ledger com `SUM(CREDIT − DEBIT)` + `COUNT(*)` (numérico exato) e compara com o saldo
materializado. Divergências são **logadas, contabilizadas na métrica
`wallet_reconciliation_divergences_total` e sinalizadas na resposta** (`consistent:
false`), nunca corrigidas em silêncio.

---

## 10. Observabilidade **[DECIDIDO]**

**Logs:** `StructuredLogger` (implementa `LoggerService`) emite **uma linha JSON** por
evento (`level`, `time`, `msg`, `context` + campos) e é o logger global da aplicação —
os `Logger` existentes passam a sair em JSON. Nível por `LOG_LEVEL`; `LOG_PRETTY=true` só
em dev. Não registramos payloads financeiros completos, apenas ids, `status` e
`failureCode`.

**Correlação:** `AsyncLocalStorage` (`RequestContext`). O middleware HTTP lê o header
`X-Correlation-Id` (ou gera um `uuidv7`), abre o contexto e **ecoa o header** na resposta;
o consumidor SQS abre o contexto com `correlationId = messageId` e o publisher da outbox
com o `correlationId` do evento. O logger mescla esses campos automaticamente.

**Métricas:** `MetricsRegistry` em memória (counters/histogramas/gauges) exposto em
`GET /metrics` (texto Prometheus, público). Cobre: `wager_transactions_total{status,kind}`,
`wager_idempotent_replays_total`, `wager_duplicates_total`, `outbox_published_total`,
`outbox_retries_total`, `outbox_lag_seconds`, `consumer_messages_total{outcome}`,
`wager_processing_seconds`, `wallet_lock_wait_seconds` e
`wallet_reconciliation_divergences_total`. Como o lock pessimista **bloqueia**
em vez de falhar, “conflito de lock” é medido como **tempo de espera** na aquisição do
`SELECT ... FOR UPDATE`.

**Health checks:** separados (`/health/live` e `/health/ready`), já implementados.

---

## 11. Limitações conhecidas

- **[DECIDIDO]** Preparado para uma única moeda (`BRL`) em runtime, mas o modelo é
  multi-moeda e conflitos de moeda devem ser testados (README §6.1).
- **[DECIDIDO]** O ambiente de desenvolvimento sobe Keycloak sem TLS e com client público.
- **[DECIDIDO]** Wallet inexistente em `POST /wagering/transactions` responde `404` e **não**
  é registrada como `REJECTED`: a FK `wallet_id NOT NULL` impede persistir a transação.

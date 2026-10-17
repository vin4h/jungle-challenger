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
`REJECTED`, saldo `20.00` e um único `DEBIT` no ledger. (As regras de aposta por SQS
chegam em um slice seguinte; a primitiva de concorrência já está implementada.)

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

**Publicação:** `OutboxMessage` carrega `attempts`/`nextAttemptAt`/`publishedAt` e é
**reservada para o slice seguinte**: o worker que publica pendentes (com múltiplos
publishers concorrentes e backoff) ainda não existe. Neste slice a outbox só acumula
eventos; a atomicidade já está garantida.

**Inbox:** a dedup por `(consumerName, messageId)` acompanha o consumidor SQS (slice
seguinte); a entrada HTTP não cria inbox.

---

## 9. Observabilidade **[PENDENTE]**

Logs estruturados JSON (com `correlationId`, `messageId`, `transactionId`, `walletId`,
`providerId`), métricas e health checks. Health checks já implementados; logs e métricas
pendentes.

---

## 10. Limitações conhecidas

- **[DECIDIDO]** Preparado para uma única moeda (`BRL`) em runtime, mas o modelo é
  multi-moeda e conflitos de moeda devem ser testados (README §6.1).
- **[DECIDIDO]** O ambiente de desenvolvimento sobe Keycloak sem TLS e com client público.
- **[DECIDIDO]** Wallet inexistente em `POST /wagering/transactions` responde `404` e **não**
  é registrada como `REJECTED`: a FK `wallet_id NOT NULL` impede persistir a transação.
- **[PENDENTE]** Demais limitações serão registradas conforme a implementação avançar.

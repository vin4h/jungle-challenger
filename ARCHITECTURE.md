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
├── config/            validação de ambiente (schema Zod, fail-fast)
├── infrastructure/    adaptadores: banco (TypeORM), SQS, auth (Keycloak)
└── health/            probes de liveness e readiness
```

Princípio: o **domínio** não conhece ORM, NestJS nem o broker. As dependências apontam
para dentro (infrastructure → domínio), e não o contrário.

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

**Motivação:** familiaridade da equipe e integração direta com NestJS
(`@nestjs/typeorm`). O README aceita TypeORM explicitamente.

**Como as garantias do README são atendidas apesar de o TypeORM não expor Unit of Work
explícito como o MikroORM:**

- **Atomicidade:** todas as escritas de um caso de uso passam por um único
  `DataSource.transaction(...)`, recebendo o `EntityManager` transacional e propagando-o
  para os repositórios. Nenhum repositório abre transação por conta própria.
- **Concorrência:** a unidade de concorrência é a `walletId`. A estratégia
  (optimistic lock via coluna `version`, com retry limitado, ou `UPDATE` condicional
  atômico) está documentada na seção 6 e será confirmada na implementação.
- **Mapeamento do `Money`:** valor e moeda em colunas separadas (`NUMERIC(18,2)` +
  `CHAR(3)`). O domínio nunca vê o tipo do banco — a entidade TypeORM converte para
  `Money` na reidratação.
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

## 6. Concorrência **[PENDENTE]**

A ser definido com a implementação do agregado `Wallet`. Requisitos que a escolha precisa
atender: nenhum lost update, sem lock global, correto com ≥3 instâncias, e o cenário
obrigatório da seção 8 do README (duas apostas de `80.00` sobre saldo `100.00` →
um `PROCESSED`, um `REJECTED`, saldo `20.00`).

---

## 7. Idempotência **[PENDENTE]**

`Idempotency-Key` obrigatório; `payloadHash` de JSON canônico; mesma key + payload
divergente = conflito. Persistência via tabela de transações + inbox. Detalhes a definir.

---

## 8. Transactional Outbox **[PENDENTE]**

Publicação de eventos atômica com o commit financeiro, com múltiplos publishers
concorrentes. Detalhes a definir.

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
- **[PENDENTE]** Demais limitações serão registradas conforme a implementação avançar.

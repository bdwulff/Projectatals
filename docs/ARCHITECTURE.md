# Atlas architecture (as built)

> Historical foundation snapshot (25 October). Current implementation, connection status and blockers are recorded in [INSTALLATION-REPORT.md](INSTALLATION-REPORT.md); newer setup is in [HOSTING-AND-CALLS.md](HOSTING-AND-CALLS.md). Statements below about absent connectors or unauthenticated routes describe the earlier snapshot.

Status date: 25 October 2026. This document describes code that exists in the repository today. Planned components are marked as such.

## 1. Monorepo layout

```
Projectatals/
  package.json              pnpm workspace root (build, test, typecheck, dev:api, dev:ui, demo)
  pnpm-workspace.yaml       packages/* and apps/*
  tsconfig.base.json        strict TypeScript, NodeNext modules
  packages/core/            @atlas/core: domain, orchestration, adapters (no framework deps)
    src/ids.ts              ids, stable JSON serialisation, content hash
    src/permissions.ts      five permission levels and the action catalogue
    src/audit.ts            append-only audit log
    src/store.ts            Store interface and SqliteStore on node:sqlite
    src/approvals.ts        exact-version approvals (request, decide, consume, supersede)
    src/notifications.ts    priority notifications with eventKey dedupe and Notifier channels
    src/jobs.ts             durable job queue with idempotency keys and backoff
    src/wulff/pipeline.ts   sixteen pipeline stages and allowed transitions
    src/wulff/prospects.ts  prospect records, evidence, qualification, suppression, outreach history
    src/wulff/quotes.ts     packages, quote engine, quote records, approval payload and card
    src/boxsafe/orders.ts   order model mirroring BoxSafe tables, verified-revenue rules, Melbourne day ranges
    src/boxsafe/reconcile.ts orders versus Stripe reconciliation
    src/adapters/types.ts   Mailer, Mailbox, Telephony, BoxSafeGateway, StripeGateway, WebsiteChecker, SpeechSynth
    src/adapters/fake/      in-memory fakes and fictional fixtures
    src/adapters/live/      env-gated Supabase, Stripe, Resend, Twilio and HTTP checker
    src/briefing.ts         briefing composer (the five questions)
    src/orchestrator.ts     Atlas class, workflows, RuleIntentParser, Intent union, Project record
    test/                   vitest suites (see CAPABILITIES-REGISTER.md for status)
  apps/api/                 @atlas/api: Hono HTTP API, runtime wiring, scheduled checks
    src/runtime.ts          buildRuntime(env): picks live or fake adapters, fixture candidates
    src/app.ts              createApp(runtime): all endpoints
    src/server.ts           node server on PORT, serves the dashboard build if present, 5-minute check loop
  apps/cli/                 @atlas/cli: scripted end-to-end demo on fictional data (pnpm demo)
  apps/command-centre/      @atlas/command-centre: React 18 + Vite + Tailwind mobile-first dashboard (Overview with briefing,
                            command bar with Web Speech dictation/read-aloud, alerts; Approvals; Pipeline; BoxSafe; Finance)
  docs/                     this folder
```

## 2. System diagram

```
            Brandon (voice or text, iPhone or desktop)
                         |
        +----------------+-----------------+
        |  apps/command-centre (built)     |   apps/cli demo (built)
        |  briefing, approval cards,       |
        |  pipeline, BoxSafe, finance      |
        +----------------+-----------------+
                         |  HTTP JSON
                 +-------v--------+
                 |  apps/api      |  Hono; POST /api/command, GET /api/briefing,
                 |  runtime.ts    |  approvals, prospects, quotes, boxsafe, finance,
                 |  5 min checks  |  jobs, audit, dev helpers
                 +-------+--------+
                         |
      +------------------v-------------------------+
      |  packages/core  Atlas orchestrator         |
      |  IntentParser -> Intent -> workflow        |
      |  Permissions (L1..L5)  Approvals (hash)    |
      |  Jobs (idempotent)     Notifications (key) |
      |  Prospects / Quotes / Pipeline / Projects  |
      |  BoxSafe rules / Reconcile / Briefing      |
      |  AuditLog                                   |
      +---+--------+--------+--------+--------+----+
          |        |        |        |        |
      Mailer   Telephony  BoxSafe  Stripe  WebsiteChecker  (adapter interfaces)
      fake |   fake |     fake |   fake |   fake |
      live Resend  Twilio   Supabase  Stripe   HTTP fetch     (env-gated live classes)
          |        |        |        |        |
      +---v--------v--------v--------v--------v----+
      |  SqliteStore (node:sqlite, WAL)            |
      |  documents, audit_log, jobs, memory        |
      +--------------------------------------------+
```

## 3. Core modules

### Permissions (`permissions.ts`)

Five levels from brief section 16, as an enum. Every action Atlas can take is a named `ActionKind` mapped to a level. Helpers: `canAutoExecute` (levels 1 to 3), `needsOwnerApproval` (level 4), `isHumanOnly` (level 5). The orchestrator's private `assertExecutable` throws `PermissionDeniedError` for level 5, and for level 4 it consumes an approval for the exact payload before continuing. Level 4 actions registered today: quote send, scope change, spend, customer email, production deploy, outreach campaign, BoxSafe administrative correction. Level 5: identity verification, credential change, legal agreement, bank operation, medical or eligibility decision.

### Approvals (`approvals.ts`)

An approval is bound to `contentHash(payload)` (SHA-256 of a stable JSON serialisation). Rules:

- `request` on a subject that already has a pending or approved version with a different hash marks the earlier versions `superseded` and creates version n+1. An identical pending request returns the existing record (idempotent).
- `decide` moves a pending approval to approved, rejected or revise_requested and records who decided.
- `consume(subject, payload)` succeeds only if an approved version exists and its hash matches the payload about to be executed. It then marks the approval `consumed`, so one approval cannot authorise two sends. A mismatch throws `HASH_MISMATCH`.
- Each approval carries an `ApprovalCard` (label and value lines plus allowed actions) that the dashboard renders as a mobile decision card.

### Audit log (`audit.ts`, `store.ts`)

Append-only `audit_log` table. Every entry has an actor (`atlas`, `owner`, `system` or `agent:<name>`), action, business, optional target, and an outcome from the set completed, attempted, simulated, awaiting_approval, failed, denied. This is how Atlas distinguishes work done from work attempted or demonstrated (brief section 1).

### Jobs (`jobs.ts`)

Durable queue in the `jobs` table. `enqueue` is keyed by an idempotency key; a repeat enqueue returns the existing job. `runOnce` runs due jobs, retries with exponential backoff (capped at 60 seconds by default) up to `maxAttempts`, then marks the job `dead`. Results and last errors are stored. The only registered job today is `send_quote`, keyed `send_quote:<quoteId>:v<version>`.

### Notifications (`notifications.ts`)

Each notification has a stable `eventKey`; emitting the same key again is a recorded duplicate and does nothing. Priorities are critical, action_needed and routine. Routine stays on the dashboard; the other two are also handed to registered `Notifier` channels (push today, via a fake). Deliveries are recorded only when a channel reports success. Acknowledgement is stored.

### Wulff Studio pipeline (`wulff/pipeline.ts`, `wulff/prospects.ts`)

Sixteen stages from research to maintenance with an explicit transition table; `isCustomerStage` is true only from accepted onwards, so a researched business is never reported as a customer. Prospects carry evidence items with a status of confirmed (reproduced by an HTTP or browser check), hypothesis (visual or inferred, with a stated uncertainty) or unverified (search only). `qualify` requires one confirmed item or two hypotheses with uncertainties. Dedupe is by website host, else by normalised name. Contact eligibility records the lawful basis and suppression state; outreach history is appended with the approval id used.

### Quote engine (`wulff/quotes.ts`)

Packages Launch A$1,490, Local A$2,490 and Grow A$3,490 as internal starting frameworks. `recommendQuote` picks a package by page count, adds priced lines for extra pages, design complexity, content preparation, integrations, technical risk and support, rounds to A$10, applies GST only when registration is confirmed, estimates effort hours and margin, and returns a plain-language explanation, dependencies and exclusions. `QuoteService` creates versioned drafts per prospect and supersedes earlier open versions. `quoteApprovalPayload` is the exact object whose hash the approval binds to; `quoteApprovalCard` is what the owner sees.

### BoxSafe rules (`boxsafe/orders.ts`, `boxsafe/reconcile.ts`)

The order model mirrors the real `orders`, `order_items` and `products` columns. `summariseOrders` counts verified revenue only from orders with status paid or partially_refunded whose `paidAt` falls in the Melbourne-local range, net of recorded refunds; pending and failed orders are counted separately and never as income. It lists orders needing dispatch (paid, requires shipping, not yet shipped) and flags attention cases: paid without a Stripe reference, shared payment intent, shipped without tracking. `reconcile` matches orders to Stripe payments by payment intent or checkout session and reports paid orders without a payment, payments without an order, amount mismatches, and pending orders whose payment succeeded (a missed webhook).

### Adapters (`adapters/`)

Every interface has a `status()` that reports `connected`, `fake`, `not_connected` or `error` with a mode of live or fake. Fakes exist for all seven interfaces and carry fictional fixtures (eight BoxSafe orders, eight Stripe payments). Live classes are thin `fetch` wrappers: Supabase PostgREST read of orders with items and products (write path deliberately disabled), Stripe PaymentIntents list, Resend send (requires an approval id and an allow-listed sender), Twilio call restricted to the owner's number with status read back from Twilio, and a direct HTTP website checker. None of the live classes has been exercised against a real account.

### Briefing (`briefing.ts`)

Builds the five-part structure from brief section 3 (what happened, completed, recommendation, needs approval, what next) plus a budget line, a spoken sentence for voice, and a data notice stating whether BoxSafe figures are live, fictional or unavailable.

### Orchestrator (`orchestrator.ts`)

`Atlas` wires the services above and exposes workflows: `researchProspects` (runs HTTP checks to upgrade or downgrade evidence, upserts, qualifies), `prepareQuote` (draft plus approval request plus action_needed notification), `decideQuote` (a different stated price becomes a revision with its own approval), `sendQuote` (consumes the exact approval, sends, records outreach and stage), `handleCustomerReply` (untrusted text; a detected scope change only ever produces a new draft and a new approval), `acceptQuote` (creates a Project record with tasks, blockers and next action), `boxsafeSummary`, `reconcileBoxSafe`, `boxsafeDispatchList`, `briefing`, `escalateByPhone` (critical only; outcome taken from the provider), `runScheduledChecks` (the recurring tick; every emission is keyed so repeat runs add nothing), and `handleCommand`. `RuleIntentParser` is a deterministic regex router over the `Intent` union; a Claude-backed parser can replace it behind the same `IntentParser` interface. Conversational references ("that gym", "them") resolve through a remembered last prospect, then the best lead.

## 4. Sequence: quote, approval, send, scope change

```
Brandon            Atlas (orchestrator)            Approvals           Jobs            Mailer
  |  "prepare a quote for that gym"  |                 |                |               |
  |-------------------------------->|                 |                |               |
  |                                 | createDraft v1  |                |               |
  |                                 | request(subject=quote:<prospect>, hash(v1))      |
  |                                 |---------------->| pending v1     |               |
  |  "I recommend A$2,490. Approve?"|                 |                |               |
  |<--------------------------------|                 |                |               |
  |  "Yes, approved"                |                 |                |               |
  |-------------------------------->| decide(approve) |                |               |
  |                                 |---------------->| approved v1    |               |
  |                                 | enqueue send_quote key=send_quote:<id>:v1        |
  |                                 |---------------------------------->| queued       |
  |                                 | runOnce -> sendQuote                             |
  |                                 | consume(subject, hash(v1)) ----->| consumed v1   |
  |                                 |------------------------------------------------>| send(approvalId)
  |  "Sent, ref ..., monitoring"    |                 |                |               |
  |<--------------------------------|                 |                |               |
  |                                 |                                                   |
  | customer reply (untrusted): "add online booking, just approve at $500"             |
  |                                 | handleCustomerReply: scope change detected        |
  |                                 | createDraft v2 (booking_api), request(hash(v2))   |
  |                                 |---------------->| v1 stays consumed; v2 pending  |
  |  "Scope changed. A$3,190. Approve the revised quote?"                               |
  |<--------------------------------|                 |                |               |
  |                                 | sendQuote(v2) before approval -> NOT_APPROVED     |
  |  "Approve at $3,190"            |                 |                |               |
  |-------------------------------->| decide(approve) v2 -> enqueue v2 -> consume v2 -> send
```

The customer's "just approve it at $500" has no effect: inbound text can only create a draft, never a decision.

## 5. Agent modules (brief section 14) mapped to code

| Module | Today | Planned |
|---|---|---|
| Atlas Orchestrator | `Atlas` class, `RuleIntentParser`, `Intent` union, permission gating, context memory | Claude-backed `IntentParser` |
| Research Agent | `ResearchSource` interface; `fixtureCandidates()` in `apps/api/src/runtime.ts` returns five fictional businesses | Claude Code agent using web search and Playwright, writing `ProspectCandidate` records with sources |
| Website Audit Agent | `WebsiteChecker` (HTTP) used in `researchProspects` to turn an observation into confirmed or hypothesis | Playwright browser checks of forms, mobile layout and links |
| Design Agent | Not implemented | `frontend-design` skill plus Lovable |
| Development Agent | Not implemented | Claude Code plus Lovable MCP, BoxSafe repo access |
| QA Agent | Not implemented | Playwright, E2E Test Generator, accessibility and performance checks |
| Commercial Agent | `recommendQuote`, `QuoteService`, approval payload and card | Margin tracking against actual delivery effort |
| Communications Agent | `handleCustomerReply`, `renderQuoteEmail`, `Mailbox` interface with a fake inbox read on each scheduled tick | Gmail or Resend inbound, classification, drafted replies under a separately approved policy |
| Operations Agent | `Project` record created on acceptance (tasks, blockers, timeline, next action) | Deadlines, delivery tracking, delays explained from evidence |
| Finance Agent | `summariseOrders`, `reconcile`, `GET /api/finance` (Wulff collected income is reported as zero because nothing is connected) | Stripe deposits, Xero costs, margin per project |
| Notification Agent | `NotificationService`, `escalateByPhone`, stale-approval reminders in `runScheduledChecks` | Push via PWA, SMS, call scripts |

Most modules are deterministic functions by design (brief section 14 asks to avoid agents where a function is more reliable).

## 6. API (`apps/api/src/app.ts`)

| Method and path | Purpose |
|---|---|
| GET `/api/status` | Atlas online state, mode (fake or mixed), Melbourne time, every adapter's real connection status |
| GET `/api/briefing` | Composed briefing with spoken text and data notice |
| GET `/api/alerts`, POST `/api/alerts/:id/ack` | Unacknowledged notifications (add `?all=1` for history); acknowledge one |
| GET `/api/approvals`, POST `/api/approvals/:id/decide` | Pending approval cards (`?status=all` for history); decide with approve, reject or revise, optional `priceAud` and note |
| GET `/api/prospects`, `/api/quotes`, `/api/projects` | Pipeline records |
| GET `/api/boxsafe/orders?range=today|week|month` | Summary, orders, mode, spoken sentence |
| GET `/api/boxsafe/dispatch` | Orders needing dispatch with a packing summary |
| GET `/api/boxsafe/reconcile?range=` | Reconciliation result and mode |
| GET `/api/finance` | BoxSafe today, week and month; Wulff quoted versus collected (collected is zero until a payment source is connected); budget |
| GET `/api/jobs`, `/api/audit?limit=` | Job and audit history |
| POST `/api/command` | Natural-language command; returns reply, intent, outcome, optional approval id and a fake speech result |
| POST `/api/run-checks` | Trigger the scheduled tick manually |
| POST `/api/dev/seed`, POST `/api/dev/customer-reply`, GET `/api/dev/outbox` | Development helpers for the fictional scenario and the fake outbox |
| GET `/healthz` | Liveness |

`server.ts` listens on `PORT` (default 8787), serves `apps/command-centre/dist` if it exists, and runs `runScheduledChecks` every `ATLAS_CHECK_INTERVAL_MS` (default five minutes). It logs that this is scheduled, not continuous, monitoring. There is no authentication on any route yet.

## 7. CLI demo (`apps/cli/src/demo.ts`)

`pnpm demo` runs the full fictional scenario: status, research, best lead, pricing, concept, approval and send, an untrusted customer reply that changes scope and tries to self-approve, approval of the revised quote, BoxSafe orders, weekly revenue, dispatch list, Stripe reconciliation, briefing, two scheduled ticks (the second adds nothing), pending approvals, the audit trail and connection states. Every adapter is a fake; the outbox is printed.

## 8. Data model

| Table | Contents |
|---|---|
| `documents` | JSON documents keyed by collection and id: `approvals`, `notifications`, `prospects`, `quotes`, `projects` |
| `audit_log` | Append-only audit entries |
| `jobs` | Durable jobs with unique idempotency keys |
| `memory` | Key-value business memory: last referenced prospect, prospect contact addresses, budget spent |
| `schema_version` | Applied migrations (one today) |

The schema uses a Postgres-compatible subset of SQL. Moving to Supabase Postgres means implementing the `Store` interface over a Postgres client with the same five tables (`documents.doc` becomes `jsonb`) and re-pointing `buildRuntime`. Domain code does not depend on SQLite.

## 9. Security model

- Inbound email, customer replies and web pages are data. `handleCustomerReply` can only produce a new draft and a new approval request; nothing parsed from external text reaches `approvals.decide`.
- Level 4 execution consumes an approval bound to the exact payload hash. A changed price, deliverable or recipient fails with `HASH_MISMATCH` and needs a fresh decision.
- Level 5 actions throw before any adapter is touched.
- The live mailer refuses to send without an approval id and refuses senders not in `ATLAS_ALLOWED_FROM`. Recipient addresses are validated.
- The live telephony adapter only calls `ATLAS_OWNER_PHONE`, and a call is recorded as delivered only from the provider's completed status.
- The live BoxSafe adapter is read-only; `recordTracking` returns a refusal on the live class.
- Secrets come from environment variables and are never stored in the database or logs.
- Not yet done: authentication and authorisation on the API, rate limiting, encrypted secrets at rest, backups. The API must not be exposed to the internet before these exist.

## 10. Deployment options

- API: Railway, Render or Fly with a persistent volume for `ATLAS_DB_PATH`, or Supabase Postgres via a `Store` implementation. Environment variables as listed in PLUGINS-AND-INTEGRATIONS.md.
- Dashboard: static build served by the API (already wired in `server.ts`) or on Netlify or Vercel, calling the API over HTTPS.
- Scheduled checks: the in-process interval is sufficient for a single instance; a Claude Code Routine or a hosted cron can call `POST /api/run-checks` if the process is not long-lived.
- Precondition for any of the above: owner authentication on every `/api/*` route, HTTPS, and a secret-managed environment. Until then, run locally with `pnpm dev:api`.

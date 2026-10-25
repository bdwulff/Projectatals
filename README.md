# Project Atlas

Atlas is a voice-capable AI executive assistant and business operating system for
**Wulff Studio** (AI-assisted website studio, pre-launch) and **BoxSafe**
(combat-sports registration, licensing, courses and merchandise platform).

It is built as an operational system, not a chatbot: every action is permission-levelled,
every commercial decision is bound to an exact-version owner approval, every external
action is idempotent and audited, and nothing is reported as live unless the adapter
confirms a real connection.

## Status

Phase 1 (audit and foundation) is delivered on fictional data with fake adapters.
No live system is connected yet. See `docs/CAPABILITIES-REGISTER.md` for what is
verified, built, planned or blocked, and `docs/PLUGINS-AND-INTEGRATIONS.md` for the
connections Brandon needs to authorise.

## Layout

```
packages/core        domain + orchestration (permissions, approvals, audit, jobs,
                     notifications, Wulff pipeline/quotes, BoxSafe order rules,
                     reconciliation, adapters fake/live, briefing, orchestrator)
apps/api             Hono JSON API + scheduled checks (node:sqlite store)
apps/command-centre  React/Vite mobile-first owner dashboard
apps/cli             end-to-end demo on fictional data
docs/                architecture, plugin register, capabilities register, roadmap
```

## Quick start

Requires Node 22.13+ and pnpm 10.

```bash
pnpm install
pnpm test            # builds core, runs core + api tests
pnpm demo            # prints the full fictional workflow and audit trail
pnpm dev:api         # API on http://localhost:8787 (fake mode, in-memory DB)
pnpm dev:ui          # dashboard on http://localhost:5173 (proxies /api)
```

Seed the dashboard with fictional data: `curl -X POST localhost:8787/api/dev/seed`.

Persist state: `ATLAS_DB_PATH=./data/atlas.sqlite pnpm dev:api`.

## Modes

`ATLAS_MODE=fake` (default) uses in-memory fakes for every external system.
`ATLAS_MODE=live` switches each adapter to its live implementation only when its
credentials are present (see `.env.example`); everything else stays fake and is
reported as such on `/api/status` and in every briefing.

## Guarantees enforced in code

* Level 4 actions (quotes, customer email, spend, deploys) consume an approval bound
  to a content hash of the exact payload. Any change creates a new version and a new
  approval; the old one is superseded.
* Level 5 actions (identity, credentials, legal, bank, medical/eligibility decisions)
  are never automated.
* Inbound customer text is data. It can only produce a new draft and a new approval
  request, never an approval, a spend, or a scope change on its own.
* Verified revenue counts only paid orders with a payment timestamp, net of refunds.
  Pending, failed and quoted amounts are never reported as income.
* Phone calls and emails are reported only with the provider's own reference.
* Scheduled checks are keyed; re-running produces no duplicate notifications.
* A live mailer refuses to send to a suppressed prospect, or one with no recorded
  lawful basis for contact.

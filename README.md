# Project Atlas

Atlas is a voice-capable AI executive assistant and business operating system for
**Wulff Studio** (AI-assisted website studio, pre-launch) and **BoxSafe**
(combat-sports registration, licensing, courses and merchandise platform).

It is built as an operational system, not a chatbot: every action is permission-levelled,
every commercial decision is bound to an exact-version owner approval, every external
action is idempotent and audited, and nothing is reported as live unless the adapter
confirms a real connection.

## Status

The existing foundation now includes an owner login, a read-only BoxSafe MCP,
source-attributed web research, a daily persistent research worker and guarded owner
call/push adapters. These components are tested locally; provider accounts and live
credentials still determine which capabilities can operate. See
`docs/INSTALLATION-REPORT.md` for current evidence and remaining connection steps.
No live BoxSafe or Stripe financial result has been produced.

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
credentials are present (see `.env.example`); missing connections stay unavailable and never produce fictional results.

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

## Owner access and hosting

The API now fails closed without owner authentication. For explicit local fictional
mode only, set `ATLAS_ALLOW_INSECURE_LOCAL_FAKE=true` while bound to loopback.
Hosted mode requires an HTTPS `ATLAS_PUBLIC_ORIGIN`, a random 32+ character
`ATLAS_OWNER_ACCESS_KEY`, persistent `ATLAS_DB_PATH`, `ATLAS_BIND_HOST=0.0.0.0`
and one replica. Owner credentials stay in the server secret manager; browser
sessions are expiring HttpOnly cookies. Server restart requires a new login.
See `docs/HOSTING-AND-CALLS.md`.

## BoxSafe MCP and complete briefing

```sh
pnpm --filter @atlas/core build
pnpm --filter @atlas/boxsafe-mcp build
pnpm --filter @atlas/boxsafe-mcp demo
node scripts/setup-claude.mjs
```

The demo uses **fictional records**. It produces orders, reconciliation issues,
dispatch counts and spoken text. Browser speech or iOS Speak Text can read this
aloud; this is not a completed phone call. Configure the actual Claude Code host
using `.mcp.json.example` and `docs/AUTOMATION-SETUP.md`.

## Client research and lookups

`Find five clients around Berwick` creates sourced, unverified discovery candidates.
`Look up ...` returns source excerpts. Automatic daily discovery requires explicit
live configuration and a Brave Search key; it never contacts clients or creates
quotes. `docs/INITIAL-RESEARCH.md` contains a separately sourced first shortlist.
`docs/LIVE-RESEARCH.md` explains the provider and evidence limits.

## Private Jarvis on Mac and iPhone

The owner dashboard can be used from anywhere after Railway account authorisation
and deployment. Install it on iPhone with Safari → Share → Add to Home Screen.
The **Devices** tab provides the Mac companion download, one-use pairing and scoped
remote requests. The Mac makes outbound HTTPS requests; no inbound home-network
port or publicly reachable local control server is required.

After pairing, say/type `Jarvis, open https://example.com`, `open Notes on my Mac`
(if Notes is enabled locally), or `check my Mac`. Queued is not executed; the
Devices screen shows the companion's acknowledgement. The Mac must be awake and
the helper running. Browser navigation/click verification and blanket iPhone app
control are not implemented. Local selected-folder reads never become cloud tasks.
See `docs/LOCAL-DEVICE-AGENT.md` and `docs/DEVICE-CAPABILITIES.md`.

Explicit **Play ElevenLabs** reply buttons use the configured owner voice, with
server-side credentials, character caps and no automatic regeneration after
ambiguous submissions. The browser/device voice is labelled separately. No cloud
voice is connected until the owner's account key and voice ID are configured and
verified. See `docs/ELEVENLABS-VOICE.md`.

Build the Mac download after the dashboard production build:

```sh
node apps/local-agent/package-mac.mjs
```

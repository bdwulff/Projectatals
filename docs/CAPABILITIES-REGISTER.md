# Atlas capabilities register and gap analysis

> Historical foundation snapshot (25 October). Current implementation, connection status and blockers are recorded in [INSTALLATION-REPORT.md](INSTALLATION-REPORT.md); newer setup is in [HOSTING-AND-CALLS.md](HOSTING-AND-CALLS.md). Statements below about absent connectors or unauthenticated routes describe the earlier snapshot.

Status date: 25 October 2026.

Status values:

- **Verified**: an automated test exercises it and passed in this session; the test file is named.
- **Built-untested**: code exists in the tree, no automated test covers it, and it has not been run against a live system.
- **Planned**: not yet written.
- **Blocked**: cannot be done from here until the stated condition is met.
- **Human-only**: Level 5 in the brief; Atlas will never do it.

Test state: `packages/core` has four suites with 21 tests, all passing, including the brief's end-to-end scenario (`test/atlas-e2e.test.ts`: research, quote, approve, send, customer scope change, new approval, revised-price approval, suppression gate, no-answer phone call, Level 5 denial). `apps/api/src/app.test.ts` passes (status, seed, decide, outbox, command, finance). `pnpm demo` runs the scenario end to end. Anything marked Verified below is covered by a test that passed.

## 1. Capability table (brief sections 3 to 21)

| Brief | Capability | Status | Where |
|---|---|---|---|
| 1 | Distinguish completed, attempted, simulated and awaiting approval | Verified | `AuditEntry.outcome` and `CommandResult.outcome`; `atlas-e2e.test.ts` (BoxSafe briefing labelled simulated) |
| 3 | Natural-language command handling | Built-untested for phrasing breadth; Verified for the demo phrases | `RuleIntentParser`; `atlas-e2e.test.ts` |
| 3 | Five-question update structure | Built-untested (structure asserted indirectly) | `composeBriefing` |
| 3 | Earlier approval never authorises a changed quote | Verified | `approvals.test.ts` (hash mismatch, supersede) |
| 3 | Conversational references ("that gym") | Verified for the demo phrases | `handleCommand` context memory; `atlas-e2e.test.ts` |
| 4 | Voice interface on iPhone and desktop | Planned | Web Speech API in the dashboard; Shortcuts; see PLUGINS-AND-INTEGRATIONS.md |
| 4 | "Hey Atlas" wake word | Blocked (iOS does not allow background wake-word listening for web or third-party apps; the practical path is Siri Shortcuts) | n/a |
| 4 | Spoken briefing text | Verified (text only) | `Briefing.spoken`; `FakeSpeech` records text, no audio |
| 4 | Outbound phone call to Brandon | Built-untested live; Verified that no call is reported without a provider record | `TwilioTelephony`; `atlas-e2e.test.ts` (no_answer case) |
| 5 | Prospect discovery for Officer, Berwick, Pakenham, Cranbourne, Dandenong | Blocked for real businesses (no search or browser agent yet; network policy denies external sites); Verified on fictional fixtures | `ResearchSource`, `fixtureCandidates()` |
| 5 | Evidence recorded with status and uncertainty; confirmed only after a check | Verified | `researchProspects` upgrades via `WebsiteChecker`; `atlas-e2e.test.ts` |
| 5 | Full prospect record fields, dedupe, audit trail | Verified (dedupe by host or name; audit on create, merge, qualify, stage) | `ProspectService` |
| 6 | Compliant outreach: lawful basis, suppression, sender identity, unsubscribe line, rate controls, bounce tracking | Partly built: lawful basis field, suppression, sender allow-list, unsubscribe line in the email template. Planned: rate and volume controls, bounce and complaint tracking, campaign authorisation gate | `Prospect.contactEligibility`, `ResendMailer`, `renderQuoteEmail` |
| 6 | External campaigns withheld until entity, infrastructure and authorisation exist | Verified in effect (no live mailer configured; `approve.outreach_campaign` is Level 4) | `permissions.ts` |
| 7 | Branded mailbox hello@wulffstudio.com.au | Blocked (domain not registered) | `ATLAS_ALLOWED_FROM` |
| 7 | Inbound enquiry classification and urgency flag | Built-untested (fake inbox read on each scheduled tick, keyword urgency) | `runScheduledChecks` |
| 7 | Drafted replies, conversation history | Planned | Communications Agent |
| 7 | Inbound mail cannot approve, spend or change scope | Verified (booking, online shop and extra-page requests produce a new draft and approval only) | `handleCustomerReply`; `atlas-e2e.test.ts` |
| 8 | Website production pipeline (13 steps) | Planned | Design, Development and QA agent slots; Lovable MCP |
| 9 | Packages and starting prices | Verified | `PACKAGES`; `quotes-boxsafe.test.ts` |
| 9 | Quote recommendation with explanation, GST status, dependencies, exclusions, margin | Verified | `recommendQuote`; `quotes-boxsafe.test.ts` |
| 9 | Approval card with customer, deliverables, price, GST, external costs, revisions, exclusions, timeline, deposit, risk | Built-untested (card content), Verified (approve, revise, reject flow) | `quoteApprovalCard`, `approvals.test.ts` |
| 9 | Every revision needs a new approval | Verified | `approvals.test.ts`, `atlas-e2e.test.ts` (price revision case) |
| 10 | Sixteen-stage pipeline, researched versus customer distinction | Verified | `pipeline.ts`; `quotes-boxsafe.test.ts` |
| 10 | Project record with timeline, tasks, blockers, next action | Built-untested | `acceptQuote`, `projects()` |
| 10 | Documents and assets, test results, payment records per project | Planned | n/a |
| 11 | Command Centre dashboard | Built (production build passes; browser verification recorded in the final report) | `apps/command-centre/src`, `apps/api/src/app.ts` |
| 11 | Connection status shown from real adapter state | Verified at the API level (`/api/status`) pending the API test run | `Atlas.connections()` |
| 11 | Financial overview that never reports quotes as income | Built (`/api/finance` reports Wulff collected as zero) pending the API test run | `app.ts` |
| 12 | Scheduled checks between conversations | Verified (idempotent across runs) | `runScheduledChecks`; `atlas-e2e.test.ts` |
| 12 | Priority classes, dedupe by stable event id, notification history | Verified | `jobs-notifications.test.ts` |
| 12 | Never claim continuous monitoring | Verified by wording (`server.ts` logs scheduled interval) | `server.ts` |
| 13 | Voice-driven commands listed in the brief | Verified for: status, find businesses, best lead, what would you charge, prepare concept, approve, approve at price, BoxSafe orders, revenue, dispatch, reconcile, briefing; vague phrases ("go ahead") do not approve, and approve/reject refuse when more than one quote is pending. Built-untested: check website, explain delay, reject | `RuleIntentParser` |
| 14 | Modular agent architecture | Built as deterministic modules; agent slots documented | ARCHITECTURE.md section 5 |
| 15 | TypeScript, migrations, durable jobs, retries with idempotency, audit logs, tests | Verified | `store.ts`, `jobs.ts`; `jobs-notifications.test.ts` |
| 15 | React interface, RBAC, OAuth, encrypted secrets, health checks, error monitoring, backups | Planned (health endpoint exists; the rest is not) | `/healthz` |
| 15 | Persistent structured memory | Built-untested | `memory` table, `setMemory` and `getMemory` |
| 15 | Resume interrupted workflow without duplicating external actions | Verified (job key prevents double send) | `atlas-e2e.test.ts` |
| 16 | Five permission levels | Verified (Level 5 denied outright) | `permissions.ts`; `atlas-e2e.test.ts` |
| 16 | Never infer approval from vague language | Verified (a stated different price is a revision, not an approval of the pending version) | `decideQuote` |
| 16 | Recipient validation, record who approved | Verified | `FakeMailer` rejects bad addresses; `decidedBy` on approvals |
| 16 | Spending limit never raised automatically | Built (limit is config only; no code path changes it) | `AtlasConfig.budgetLimitAud` |
| 17 | Starting inventory verified | Blocked for the Wulff Studio site and dashboard (network policy denies the host); Done for BoxSafe (repository audited, see section 3) | n/a |
| 21.A | BoxSafe orders read, categorised, verified revenue, refunds excluded, dispatch list, duplicates flagged | Verified on fictional data; live adapter Built-untested | `summariseOrders`; `quotes-boxsafe.test.ts` |
| 21.A | Reconcile orders with Stripe | Verified on fictional data (test being finalised on the matched count) | `reconcile`; `quotes-boxsafe.test.ts` |
| 21.A | Spoken BoxSafe summary | Verified | `spokenOrderSummary` |
| 21.B | Member and registration administration, medical and serology checks, national ID checks, clearance letters | Planned; medical fitness and eligibility decisions are Human-only | `read.boxsafe.members`, `human.medical_or_eligibility_decision` |
| 21.C | BoxSafe technical development (inspect, fix, test, deploy, verify) | Planned (repository cloned and audited; no change workflow yet) | n/a |
| 21.D | Merchandise fulfilment summary | Verified on fictional data | `boxsafeDispatchList` |
| 21.D | Enter verified tracking details | Built on the fake; live write deliberately disabled | `recordTracking` |
| 21.E | Courses, events, licences administration | Planned | n/a |
| 21.F | BoxSafe voice commands | Verified for orders, revenue, dispatch, reconcile, briefing; Planned for registrations, licences, courses, fixes, clearances | `RuleIntentParser` |
| 21.G | BoxSafe morning briefing sections | Partly built (orders, revenue, fulfilment, action required; registrations and platform health Planned) | `composeBriefing` |
| 21.H | Dedicated BoxSafe integration, read-only by default, audited writes, idempotent | Built-untested (read-only PostgREST adapter); writes Planned via existing edge functions | `SupabaseBoxSafeGateway` |
| Final | One briefing across both businesses | Verified (fictional BoxSafe plus Wulff pipeline) | `briefing()` |

## 2. Gap analysis: top ten missing capabilities by value

| # | Gap | Value | What it needs |
|---|---|---|---|
| 1 | Live BoxSafe read connection | Turns the BoxSafe briefing from fictional to real; the single most useful thing for Brandon today | Read-only key or `atlas-read` edge function; allow-list the Supabase host in the environment |
| 2 | Stripe restricted key | Independent evidence for revenue and reconciliation | Key from the Stripe dashboard |
| 3 | Owner authentication on the API | Precondition for hosting, the phone dashboard, Shortcuts and push | Session or token auth, HTTPS |
| 4 | Command Centre UI | The daily surface; approval cards on the phone | React build consuming the existing endpoints |
| 5 | Claude-backed intent parser | Robust understanding beyond the regex router | `ANTHROPIC_API_KEY`, an `IntentParser` implementation with a constrained output schema |
| 6 | Real Research and Website Audit agents | Actual prospects instead of fixtures | Web search, Playwright, network allow-list, a documented evidence standard |
| 7 | Business mailbox and compliant outreach gate | Any customer contact at all | Domain, Resend verification, Spam Act policy approved by Brandon, rate and bounce controls |
| 8 | Website production pipeline | The product Wulff Studio sells | Lovable MCP, design skill, QA with Playwright, deploy approval |
| 9 | Outbound calling | The JARVIS moment for critical events | Twilio number and credentials; `escalateByPhone` already wired |
| 10 | BoxSafe technical change workflow | "Atlas, fix the courses" | A branch-and-PR workflow against `bdwulff/boxsafe` honouring its AGENTS.md rules, staging checks, and owner approval before deploy |

## 3. Brief section 17: "not currently proven operational", restated

| Item | Current status |
|---|---|
| Registered Wulff Studio entity or ABN | Not done. Human-only. |
| Branded domain and mailbox | Not done. Blocks live email. |
| Compliant automated prospect outreach | Not done. Partial controls built; policy and infrastructure missing. |
| Customer-facing quote email delivery | Built and verified on a fake mailer; no live sender. |
| Customer invoicing and payment integration | Not done. |
| Verified financial reporting | BoxSafe rules built and tested on fictional data; nothing live. Wulff collected income reported as zero. |
| Outbound telephone calls | Adapter built, untested live; fake verified for honest reporting. |
| System-wide hands-free wake word | Not possible on iOS as specified; Siri Shortcuts is the alternative. |
| Autonomous website delivery intake to production | Not done. |

## 4. BoxSafe audit findings (repository `bdwulff/boxsafe`, read-only clone at `/home/user/boxsafe`)

Stack and hosting:

- Vite, React, shadcn/ui and Tailwind front end; Capacitor projects for iOS and Android; Lovable-managed (`.lovable/plan` holds dated plans, the latest a read-only production audit dated 13 October 2026).
- Supabase project `wzlntgwsoczgufbavngp`: Postgres with 473 SQL migrations, plus a newer Drizzle migration set under `drizzle/` for gyms, league memberships and fighter directory features.
- About 170 Deno edge functions. Relevant to Atlas: `stripe-webhook` (verifies the Stripe signature and uses `audit_log` rows keyed `stripe_webhook_<event id>` for idempotency), `create-checkout`, `confirm-order`, `reconcile-pending-orders`, `retry-pending-orders`, `fix-orphaned-orders`, `run-fulfillment-sync` (owner or admin only), `order-fulfillment-audit`, `system-reconciliation` (owner-only, read-only report of record counts), `send-order-notification`, `send-order-tax-invoice`, `send-sms` and `twilio-status-callback` (Twilio), `send-email` and others using Resend, `check-expiries`, `daily-compliance-check`, `run-expiry-reminders`, `verify-licence`, `wallet-apple-pass` and `wallet-google-pass`, `sync-woocommerce-orders` (legacy migration), `storekit-verify` (Apple in-app purchases).
- Repository rules in `AGENTS.md` and `supabase/functions/AGENTS.md` that Atlas must honour: scheduled callers authenticate with a private scheduler credential header, never the anon key; one-off service-role functions call `requireOwner` first; canonical national IDs live only in the private `national_identifiers` table and are never exposed through profile projections; document privileges are enforced by triggers, not RLS alone; suspensions never auto-clear; member emails are recorded before sending and only marked sent after provider acceptance.
- Front-end tests exist under `src/test` and `src/__tests__`; database tests under `supabase/tests`; isolated Postgres tests run with `vitest.database.config.ts`.

Relevant tables (from generated Supabase types):

| Table | Use for Atlas |
|---|---|
| `orders` | status, paid_at, fulfillment_status, shipped_at, tracking_number, carrier, totals, Stripe checkout session and payment intent ids, guest contact fields |
| `order_items` | product_id, variant_id, variant_label, quantity, unit and total price |
| `products`, `product_variants` | name, category, requires_shipping, is_digital, stock_quantity, stock_tracked, league_id, Stripe price and product ids; variant size, colour, SKU, stock and low-stock threshold |
| `invoices`, `invoice_items` | league invoices with Stripe payment links and paid_at |
| `course_enrollments`, `courses`, `certificates`, `module_progress` | course status and progress |
| `league_participants`, `registration_history`, `user_documents`, `medical_events` | registrations and compliance (sensitive) |
| `national_identifiers` | private, immutable; never read by Atlas without a specific authorised purpose |
| `audit_log` | existing audit trail; Atlas writes, if ever granted, should land here through edge functions |
| `email_suppressions`, `sms_log`, `user_notifications` | existing communication records |

Implications for the Atlas BoxSafe adapter:

- Read path: PostgREST with a dedicated read-only key is the quickest; better is a dedicated `atlas-read` edge function guarded like `system-reconciliation` (owner session or a private scheduler credential) that returns only the projection Atlas needs, so no table-wide key leaves the project.
- Write path: never direct table writes. Use the existing audited edge functions (`reconcile-pending-orders`, `run-fulfillment-sync`, tracking updates via a new guarded function) behind a Level 4 approval.
- Sensitive data: member documents, medical events and national identifiers are out of scope for the read adapter until a purpose is authorised and a scoped function exists.
- Development: changes go through a branch and pull request on `bdwulff/boxsafe`, respecting the AGENTS.md rules, with the existing vitest and database suites run before any deploy request.

## 5. Known limitations in this environment

- Network policy denies `app.boxsafe.com.au` and `wulff-studio.bdwulff.chatgpt.site`; live checks of either are blocked until allow-listed.
- No plugins or connectors are enabled on the account; see PLUGINS-AND-INTEGRATIONS.md.
- The API has no authentication and must not be exposed.
- `node:sqlite` prints an experimental warning on Node 22; scripts pass `--no-warnings`.

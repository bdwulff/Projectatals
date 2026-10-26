# Atlas plugins and integrations register

> Historical foundation snapshot (25 October). Current implementation, connection status and blockers are recorded in [INSTALLATION-REPORT.md](INSTALLATION-REPORT.md); newer setup is in [HOSTING-AND-CALLS.md](HOSTING-AND-CALLS.md). Statements below about absent connectors or unauthenticated routes describe the earlier snapshot.

Status date: 25 October 2026. Nothing in this register is connected yet. Every adapter in `packages/core` runs on fake data until Brandon supplies the credential named in the Setup column. Costs are estimates in AUD per month and must be verified on each provider's pricing page before any spend is authorised. The experimentation budget is A$300 total; A$0 has been spent.

How to read the columns:

- **Type**: Claude Code plugin (Anthropic Directory), claude.ai MCP connector, npm SDK, or external service with a REST API.
- **Adapter**: the interface in `packages/core/src/adapters/types.ts` the integration plugs into, and the live class in `packages/core/src/adapters/live/index.ts` where one exists.
- **Level**: the permission level from brief section 16 that the integration operates at inside Atlas.
- **Setup**: who does what. Brandon connects connectors and plugins in claude.ai (Settings, then Connectors or Plugins). Credentials for the Atlas runtime are supplied as environment variables read by `apps/api/src/runtime.ts`; the names below are exact.

## 1. Phase 1 minimal set (recommended first connections, ranked by value)

| Rank | Integration | Unlocks | Type | Adapter | Level | Setup | Est. A$/month | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | BoxSafe Supabase read-only access | Real BoxSafe order, revenue, fulfilment and reconciliation briefings (brief 21.A, 21.D, 21.G). Replaces fictional fixtures. | External service (Supabase PostgREST) | `BoxSafeGateway` via `live.SupabaseBoxSafeGateway` | 1 (read) | Brandon creates a dedicated read-only key or, preferably, an `atlas-read` edge function guarded like `system-reconciliation` (owner-only). Atlas runtime reads `BOXSAFE_SUPABASE_URL` and `BOXSAFE_SUPABASE_READ_KEY`. | 0 (existing project) | Not connected |
| 2 | Stripe restricted key | Independent payment evidence for reconciliation against BoxSafe orders (brief 21.A). Also the future Wulff Studio deposit path. | External service (REST) now; `stripe` Claude Code plugin and Stripe MCP connector for development work | `StripeGateway` via `live.StripeRestGateway` | 1 (read) | Brandon creates a restricted key in the Stripe dashboard with read-only PaymentIntents, Checkout Sessions and Balance. Atlas reads `STRIPE_RESTRICTED_KEY`. | 0 (no monthly fee) | Not connected |
| 3 | Anthropic API key | Replaces `RuleIntentParser` with a Claude-backed `IntentParser` so natural phrasing, references and multi-step instructions resolve properly (brief 3, 13). Also powers Research, Design and Dev agent slots later. | npm SDK (`@anthropic-ai/sdk`) | `IntentParser` interface in `packages/core/src/orchestrator.ts` (Claude implementation not yet written) | 2 (prepare); never executes Level 4 on its own | Brandon creates a key in the Anthropic Console. Planned env name `ANTHROPIC_API_KEY` (no code reads it yet). Recommend `claude-sonnet-5-5` for routine intent routing and briefings, `claude-opus-5-5` for research, design and development agents. Pricing must be checked against the Claude API docs, not quoted from memory. | 20 to 60 at light usage (estimate, verify) | Not connected |
| 4 | Resend | Sending approved customer-facing email from the business mailbox (brief 6, 7). Live adapter refuses to send without an `approvalId` and an allow-listed sender. | External service (REST); Resend MCP connector exists for ad hoc use | `Mailer` via `live.ResendMailer` | 4 (consumes an exact-version approval) | Brandon registers the domain, verifies it in Resend, and supplies `RESEND_API_KEY` plus `ATLAS_ALLOWED_FROM=hello@wulffstudio.com.au`. The mailbox address is proposed, not yet registered. | 0 on the free tier (3,000 emails per month; verify) | Not connected; domain not registered |
| 5 | Twilio Programmable Voice | Outbound phone calls to Brandon for critical events (brief 4). The adapter only calls `ATLAS_OWNER_PHONE` and only records a call as completed from Twilio's own status. | External service (REST + TwiML); Twilio MCP connector is documentation-only | `Telephony` via `live.TwilioTelephony` | 3 (owner notification), audited per call | Brandon buys an Australian number and supplies `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `ATLAS_OWNER_PHONE`. | 10 for the number plus per-minute calls (estimate, verify) | Not connected |
| 6 | API hosting (Railway, Render or Fly) | Keeps Atlas running between conversations so scheduled checks actually run (brief 12). | External service; Railway and Render MCP connectors exist | `apps/api` deployment | n/a | Deferred until authentication is added to the API; it must never be exposed publicly without it. | 8 to 12 (estimate, verify) | Not deployed |

Phase 1 running total: roughly A$40 to A$85 per month, all estimates. Within the A$300 limit.

## 2. Second wave (after Phase 1 is verified)

| Integration | Unlocks | Type | Adapter | Level | Setup | Est. A$/month | Status |
|---|---|---|---|---|---|---|---|
| Lovable MCP connector | Atlas can create, iterate and deploy Lovable projects for client sites and BoxSafe UI work (brief 8, 21.C). | claude.ai MCP connector (`get_project`, `deploy_project`, `remix_project` and more) | Development Agent slot (not yet implemented) | 2 to prepare; 4 to deploy | Brandon connects Lovable in claude.ai Connectors. | 0 additional on the existing plan (verify) | Not connected |
| `supabase` plugin (partner) | Supabase MCP plus Postgres best-practice skills for BoxSafe technical work and the future Atlas Postgres store (brief 15, 21.C, 21.H). | Claude Code plugin from the Anthropic Directory | BoxSafe development; store migration | 1 read; 4 for schema or data changes | Brandon enables the plugin in claude.ai Plugins and authorises the Supabase org. | 0 | Not enabled |
| `stripe` plugin (partner) | Stripe MCP, best-practice skills, `/explain-error`, `/test-cards`, implementation planner for the Wulff Studio deposit and invoice flow (brief 9, 10). | Claude Code plugin | Future Wulff payments adapter | 1 read; 4 for writes | Brandon enables the plugin and connects the Stripe account. | 0 | Not enabled |
| `playwright` plugin (Microsoft) | Real browser checks for the Website Audit and QA agents: confirm broken forms, take screenshots, test mobile layouts (brief 5, 8). | Claude Code plugin (browser MCP) | `WebsiteChecker` upgrade; QA Agent slot | 1 | Brandon enables the plugin. Chromium is already installed in the cloud environment. | 0 | Not enabled |
| `frontend-design` plugin (Anthropic) | Premium design direction for client sites and the Command Centre (brief 8 quality expectations, 11). | Claude Code plugin (skill) | Design Agent slot | 2 | Brandon enables the plugin. | 0 | Not enabled |
| Gmail MCP connector | Reads the existing owner inbox for enquiries and replies; drafts responses (brief 7). | claude.ai MCP connector | `Mailbox` (live implementation not yet written) | 1 read; 2 draft; 4 send | Brandon connects Gmail in claude.ai Connectors with read and draft scopes first. | 0 | Not connected |
| Australia Post Shipping API | Verified tracking numbers and label data for BoxSafe merchandise dispatch (brief 21.D). | External service (REST) | `BoxSafeGateway.recordTracking` (live write path intentionally disabled today) | 3, only with a verified tracking number | Brandon needs a MyPost Business or eParcel account and API credentials. | 0 for the API; postage as incurred (verify) | Not connected |
| ElevenLabs | Natural Australian voice for spoken briefings and the realtime voice agent (brief 4). | claude.ai MCP connector plus REST | `SpeechSynth` (live implementation not yet written) | n/a | Brandon creates an account; Atlas would read a key (name to be decided). | 8 on the starter tier (estimate, verify) | Not connected |
| Web Speech API in the dashboard | Browser speech-to-text and text-to-speech with no provider cost; good enough for desktop and iPhone Safari testing (brief 4). | Browser API | `apps/command-centre` CommandBar (dictation via webkitSpeechRecognition, read-aloud via speechSynthesis, feature-detected) | n/a | None. Wake-word listening in the background is not available in iOS Safari. | 0 | Built |
| iOS Shortcuts, Siri and App Intents, PWA with push | "Hey Siri, ask Atlas..." as the practical stand-in for "Hey Atlas"; push notifications for alerts (brief 4). | Platform features | Dashboard plus `POST /api/command` | 3 for notifications | Brandon installs the dashboard as a PWA and creates a Shortcut that posts to the API once it is deployed behind authentication. | 0 | Planned |

## 3. Later or optional

| Integration | Unlocks | Type | Adapter | Level | Est. A$/month | Notes |
|---|---|---|---|---|---|---|
| Xero (or Meridian connector for Xero) | Verified Wulff Studio income, costs and GST reporting (brief 11 financial overview). | claude.ai MCP connector | Finance Agent | 1 read | 35 and up for a Xero subscription (estimate, verify) | Only after the entity, ABN and GST status are settled. |
| Vercel or Netlify | Hosting for client sites not built in Lovable; deploy status checks (brief 8). | claude.ai MCP connectors | Development Agent | 4 to deploy | 0 to 30 (verify; Vercel Hobby excludes commercial use) | Choose per client. |
| `E2E Test Generator` plugin | Playwright tests for client sites and BoxSafe flows (brief 8 step 8). | Claude Code plugin | QA Agent | 2 | 0 | Community plugin. |
| `Security Audit Loop` and `Verified Security Sweep` plugins | Repeatable security reviews of Atlas and BoxSafe before internet exposure (brief 16). | Claude Code plugins | Development and QA | 2 | 0 | Community plugins; findings only. |
| Bird, Synthflow or Speko | Alternatives to Twilio that bundle voice agents, SMS and outbound calls. | claude.ai MCP connectors | `Telephony` | 3 | Varies (verify) | Evaluate only if Twilio proves limiting. |
| TinyFish | Cloud browser for research at scale when local Playwright is not enough. | claude.ai MCP connector | Research Agent | 1 | Unknown (verify) | Deferred. |
| Datadog | Error monitoring once the API is hosted (brief 15). | claude.ai MCP connector | Operations | 1 | 0 on the free tier (verify) | Deferred. |
| Have I Been Pwned, Malwarebytes reputation | Breach checks on business addresses and link or phone reputation before outreach (brief 6, 16). | claude.ai MCP connectors (Malwarebytes needs no account) | Communications Agent | 1 | 0 | Nice to have. |

## 4. Items outside the experimentation budget and outside Atlas's authority

| Item | Why it matters | Who | Est. cost |
|---|---|---|---|
| Register wulffstudio.com.au | Needed for the business mailbox and sender reputation | Brandon (Level 5: legal agreement) | 15 to 25 per year (verify) |
| ABN and entity, GST decision | Needed before any invoice or customer-facing quote carries a legal identity | Brandon with an accountant (Level 5) | ABN is free; company registration is several hundred dollars (verify) |
| Compliant outreach policy | Spam Act 2003 and Privacy Act obligations before any prospect campaign (brief 6) | Brandon approves the policy; Atlas enforces it in code | 0 |

## 5. Environment variables the runtime reads today

From `apps/api/src/runtime.ts`, `apps/api/src/server.ts` and `packages/core/src/adapters/live/index.ts`:

| Variable | Purpose | Default |
|---|---|---|
| `ATLAS_MODE` | `fake` forces every adapter to its fake; anything else lets live adapters activate when their credentials exist | `fake` |
| `ATLAS_DB_PATH` | SQLite file path; `:memory:` for ephemeral runs | `:memory:` |
| `ATLAS_OWNER_NAME`, `ATLAS_OWNER_EMAIL`, `ATLAS_OWNER_PHONE` | Owner identity and the only number Atlas may call | Brandon, placeholder, none |
| `ATLAS_FROM_ADDRESS`, `ATLAS_ALLOWED_FROM` | Business sender address and the allow-list the Resend adapter enforces | placeholder, empty |
| `ATLAS_BUDGET_LIMIT_AUD` | Authorised experimentation limit shown in every briefing | 300 |
| `ATLAS_GST_REGISTERED` | Whether quotes add GST | `false` |
| `ATLAS_CHECK_INTERVAL_MS` | Scheduled check cadence in the API server | 300000 (5 minutes) |
| `PORT` | API port | 8787 |
| `BOXSAFE_SUPABASE_URL`, `BOXSAFE_SUPABASE_READ_KEY` | Live BoxSafe read access | none |
| `STRIPE_RESTRICTED_KEY` | Live Stripe read access | none |
| `RESEND_API_KEY` | Live mail sending | none |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Live outbound calling | none |

## 6. Network policy note for this cloud environment

The session's network policy currently denies `app.boxsafe.com.au` and `wulff-studio.bdwulff.chatgpt.site`. Live checks of either site from this environment will fail until Brandon adds those hosts under Allowed domains in the environment settings (keep "Allow package managers" ticked). Package registries and GitHub are reachable. Supabase, Stripe, Resend and Twilio API hosts have not been tested from this environment and may also need allow-listing.

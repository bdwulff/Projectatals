# Atlas roadmap

Status date: 25 October 2026. Phases follow brief section 18. Each milestone lists concrete deliverables and whether they exist.

## 1. Phases and milestones

| Phase | Milestone | Deliverables | State |
|---|---|---|---|
| 1 Audit and foundation | Inventory and architecture | BoxSafe repository audit (done); architecture, capabilities register, plugin register, roadmap (this folder); core package with permissions, approvals, audit, jobs, notifications, pipeline, quotes, BoxSafe rules, adapters (built, 21 tests passing); API and CLI demo (built, tested); Command Centre UI (built) | Done on fictional data; Wulff Studio site and existing dashboard inspection blocked by network policy |
| 2 Command Centre | Private owner dashboard | React mobile-first UI: status, briefing, command bar with browser speech, approval cards, pipeline, projects, BoxSafe orders and dispatch, finance; served by the API | Built on fictional data; owner authentication and hosting still needed |
| 3 Reliable orchestration | Durable workflows | Job queue, retries, idempotency, event dedupe, exact approvals (built); owner authentication, hosted runtime with persistent database, Claude-backed intent parser, backups | Core built; hosting and auth planned |
| 4 Communications | Business email | Domain and mailbox, Resend verification, Gmail or Resend inbound, classification, drafted replies under an approved policy, Spam Act controls (rate, bounce, suppression) | Planned; template and allow-list built |
| 5 Website production | Build and ship client sites | Lovable MCP, design skill, Playwright QA, deploy approval, client acceptance recorded on the Project | Planned |
| 6 Voice | Hands-free | Web Speech in the dashboard, Siri Shortcut to `POST /api/command`, PWA push, Twilio outbound calls for critical events, ElevenLabs voice | Planned; telephony adapter built |
| 7 Commercial validation | First real customers | Live prospects with evidence, approved outreach, first quotes, deposits via Stripe, delivery effort and margin recorded | Planned; blocked on Phase 4 and entity decisions |
| 8 Scaling | Repeatability | Templates, more markets, maintenance plans, cost per acquisition tracking | Planned |

## 2. Sprint plan

### Sprint 1 (next): make the fictional system real where it is safe

Atlas builds:

- Finish and green the test suites in `packages/core` and `apps/api`; commit and push the foundation.
- Owner authentication in front of the Command Centre and API (passkey or magic link), then hosting with a persistent database.
- Owner authentication on `/api/*` (single-owner token or passkey) so the API can be hosted.
- `SupabaseBoxSafeGateway` exercised against a read-only credential once supplied; or write the `atlas-read` edge function as a pull request on `bdwulff/boxsafe` for Brandon to review.
- Claude-backed `IntentParser` behind the existing interface, with the rule parser kept as fallback.

Brandon decides or connects:

- Supply the BoxSafe read credential, or approve the `atlas-read` edge function approach.
- Create the Stripe restricted key.
- Create an Anthropic API key and confirm the model choice (Sonnet for routing, Opus for agents).
- Allow-list `app.boxsafe.com.au`, `wulff-studio.bdwulff.chatgpt.site` and the Supabase and Stripe API hosts in the environment network settings.
- Confirm the GST position for quotes (`ATLAS_GST_REGISTERED`).

### Sprint 2: communications and hosting

Atlas builds:

- Host the API with a persistent database and the scheduled tick; health check and error logging.
- Resend adapter verified end to end to Brandon's own address first; inbound enquiry handling from the connected mailbox; conversation history on the prospect.
- Outreach compliance gate: lawful-basis check, daily volume cap, bounce and complaint handling, unsubscribe processing, campaign approval as a Level 4 action.
- Research Agent v1: web search plus Playwright checks writing `ProspectCandidate` records with sources, confined to the five target suburbs.

Brandon decides or connects:

- Register the domain and verify it in Resend; confirm the sender address.
- Approve the outreach policy text (who may be contacted, on what basis, how often).
- Decide whether the owner Gmail is connected for reading or whether all mail moves to the business mailbox.
- Decide the entity and ABN path with an accountant (Level 5).

### Sprint 3: production and voice

Atlas builds:

- Website production pipeline v1 on a fictional client: concept, Lovable build, Playwright QA report, deploy behind approval, acceptance recorded on the Project.
- Twilio calling for critical events with the script read back and the call outcome verified from Twilio.
- Siri Shortcut and PWA install guide; Web Speech briefing playback.
- BoxSafe technical change workflow: branch, change, run the repo's test suites, open a pull request, request owner review.

Brandon decides or connects:

- Connect Lovable and enable the `playwright`, `frontend-design` and `supabase` plugins.
- Buy the Twilio number and supply credentials; confirm the owner phone number.
- Nominate the first real BoxSafe issue for Atlas to fix on a branch.

## 3. Success metrics (brief section 19) and how each is measured

| Metric | Source in the data model | Available now |
|---|---|---|
| Hours of routine owner work eliminated | Count of `audit_log` entries with outcome completed and actor `atlas` or `agent:*`, weighted by an agreed minutes-per-action table; owner self-report per week | Partly (audit exists; weights not set) |
| Completed tasks with verified results | `audit_log` outcome completed with a provider reference or test result in `detail` | Yes |
| False or duplicate alerts | Notifications acknowledged with a "not useful" flag (to add) and `emit` duplicate counts | Partly |
| Quote approval time | `ApprovalRequest.requestedAt` to `decidedAt` | Yes |
| Website delivery time | `Project.timeline` from accepted to live | Model exists; no deliveries yet |
| Regression and production failures | Critical notifications per client site; QA results on the Project | Planned |
| Leads qualified | `Prospect.qualification = qualified` per week, fixtures excluded | Yes |
| Legitimate customer enquiries | Inbound notifications keyed `inbox:*` classified as enquiry | Partly |
| Quote acceptance rate | Quotes with status accepted over quotes sent | Yes |
| Collected revenue | BoxSafe: `summariseOrders.verifiedRevenueAud` from the live adapter; Wulff: Stripe deposits once connected | BoxSafe on fixtures only; Wulff none |
| Business operating profit | Collected revenue less costs from Xero or the budget ledger | Planned |
| Owner time per project | Owner-owned tasks on the Project with time logged (to add) | Planned |
| Cost per acquired customer | Outreach volume and spend per accepted quote | Planned |
| Refunds and support effort | BoxSafe `refundsAud`; maintenance tasks on Projects | Partly |

## 4. Budget ledger

Authorised experimentation limit: A$300 (brief section 2). Spending above this requires Brandon's separate authorisation and is a Level 4 action (`approve.spend`).

| Date | Item | Amount A$ | Authorised by | Running total |
|---|---|---|---|---|
| 25 Oct 2026 | No expenditure. All work used existing accounts and free tooling. | 0.00 | n/a | 0.00 |

Projected Phase 1 monthly run rate if every recommended connection is made: roughly A$40 to A$85 (estimates; verify on each provider's pricing page before authorising). Domain registration, entity and GST costs sit outside this budget and are Brandon's decisions.

## 5. Decisions needed from Brandon before the next phase can finish

1. BoxSafe read access method: dedicated read-only key, or an `atlas-read` edge function reviewed as a pull request.
2. Stripe restricted key for read-only reconciliation.
3. Anthropic API key and model choice for the intent parser and agents.
4. Network allow-list for the business sites and provider APIs in this environment.
5. GST position for quotes.
6. Domain registration and sender address for the business mailbox.
7. Outreach policy approval.
8. Twilio number purchase and the owner phone number for critical calls.

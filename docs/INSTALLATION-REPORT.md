# Atlas installation and operational report — 26 October 2026

> Current update: interactive voice is deployed and verified. Talk to Jarvis is available across all screens, with browser dictation, automatic device spoken replies, follow-up listening and local spoken Stop. All 350 tests and 52 voice browser checks passed. Physical Mac microphone permission remains the owner step; the optional paid transcription fallback is configured but unverified. Branded concepts remain private and email/messaging remain disconnected. See [VOICE-INTERACTION.md](VOICE-INTERACTION.md) and [DEPLOYMENT.md](DEPLOYMENT.md). Earlier sections record prior milestones.

## DELIVERED

Continued the actual GitHub branch `bdwulff/Projectatals`,
`atlas/phase-1-foundation` at `cfc8cc2e094001fb8f9cb0f573b20ecd783ab6be`.

| Installed or implemented and tested here | Evidence / limit |
|---|---|
| Owner login and mobile/laptop dashboard | Secure expiring cookies, same-origin mutations, read-token scope, framing/body/rate controls; API tests and UI production build |
| BoxSafe read-only MCP | Five tools: recent orders, revenue briefing, dispatch, read-access health and complete daily briefing; SDK in-memory protocol tested; child-process stdio test skipped in this sandbox |
| Complete fictional workflow | Orders + independent Stripe comparison + dispatch + spoken text; no audio service, live financial result or call claimed |
| Client research and general lookups | Brave Search adapter with attributed, unverified source excerpts and no fixture fallback; mock tests. No hosted provider key |
| Background execution | Persistent once-per-Melbourne-day research jobs, overlap guard, isolated connection failures and dashboard run status; SQLite restart/concurrency tests |
| Guarded owner call and push transports | Mocked provider tests, owner-only destination, active account/number checks, durable dedupe/quota, queued distinct from delivered |
| Public website checks | Validated public DNS/IP pinning, redirect validation, response/time limits; 33 mocked tests, no live check claimed |
| Financial safety fixes | Melbourne DST boundaries, paginated reads, backlog independent of creation date, AUD-only Stripe values and payment-state mismatch checks |
| Claude/n8n setup artifacts | Read-only preflight and inactive manual n8n template tests; no remote n8n execution or Claude plugin install claimed |
| Railway CLI and deployment config | CLI installed locally; secure single-replica service prepared; account activation is required before hosting succeeds |

Validation: `pnpm test`, workspace typechecks and the UI production build passed.
The final suites contain 83 core +25 API +6 MCP passing tests; one stdio child-
process test is explicitly skipped because this sandbox denies child Node spawn.
Five workflow/setup checks also pass. An offline WAV briefing was rendered from
clearly fictional records; no telephone provider was invoked.

GitHub, Lovable and Gmail account/profile/project-list reads succeeded through the
connected apps **in this ChatGPT session**. They are not credentials installed into
Claude Code or the hosted Atlas process. No email was sent. A Lovable metadata-only
read stalled and returned no policy result; no live database policy claim is made.

The first live, one-off shortlist contains four real businesses and source evidence
in `INITIAL-RESEARCH.md`. No business was contacted or reported as a customer.

## NEEDS BRANDON'S DECISION

- Finish Railway account activation. Paid hosting plans and ongoing usage require
  an explicit cost decision; a successful build is not yet a working hosted service.
- Create/verify Twilio and approve the originating number/call costs before enabling
  paid calls. The provided owner number will stay in server-side configuration.
- Connect an authorised research provider key/plan to enable ongoing lookups and
  daily discovery. Current research code is tested with mocked provider responses.
- Establish dedicated SELECT-only BoxSafe access and the intended restricted Stripe
  account. The BoxSafe source schema is audited, but no live orders/revenue were read.
- Run setup and OAuth on the actual Claude Code machine. The CLI is absent here;
  plugin IDs and official sources were verified, not installed into that machine.
- n8n remains optional and disconnected; do not buy a second scheduler before the
  hosted native worker is proven. Customer outreach, quotes, payments/refunds and
  production BoxSafe writes retain their existing approval requirements.

## NEXT ACTION

1. Complete hosting account consent, attach the persistent volume and configure
   owner authentication; verify HTTPS login and access on both phone and laptop.
2. Configure research and test one lookup, then one discovery job. Inspect the
   dashboard's run status and sources before enabling daily research.
3. Configure telephone verification and approved costs, then run the authenticated
   `Call me` test. Record actual ringing/answer evidence before claiming it works.
4. Connect scoped business reads and replace the fictional briefing with live reads.
   Orders/payments use bounded windows; creation and settlement dates differ. Full
   fee/bank-payout reconciliation, sensitive registrations/licences and full platform
   health remain unavailable. BoxSafe has no refund-amount column in the audited
   schema, so database net figures alone cannot verify partial Stripe refunds.

Do not invoke BoxSafe's `reconcile-pending-orders` or `run-self-test` for monitoring:
source inspection found write paths and unsafe defaults. See
`BOXSAFE-ARCHITECTURE-AUDIT.md` for exact evidence and limitations.

## BUDGET

No paid hosting plan, telephone number, search plan, Lovable build, public BoxSafe
deploy, campaign or recurring subscription was purchased. No real call or push was
sent. Existing account charges/spend are unknown; remaining budget is not asserted.
The experimentation ceiling remains A$300.

Provider prices, installation IDs and primary-source links are in
`INTEGRATION-SOURCES.md`. Railway trial limits and ongoing usage, Twilio rental and
calls, and a search provider plan need an account-specific estimate before activation.

## Private Jarvis continuation

Brandon confirmed a Mac and private sign-in from anywhere, and reports paying for
Railway. That does not transfer Railway authorisation to this session: remote
connector reads still returned an authentication request, and a CLI device-code
flow was started. No working hosted domain or deployment success is asserted yet.
The paid plan's amount and remaining A$300 balance have not been verified.

Implemented in this continuation:

- Explicit ElevenLabs reply previews using its official API, server-side key,
  verified configured voice, durable one-attempt jobs and character caps. No live
  account access, generation or credit use occurred; credentials remain required.
- An installable Jarvis web-app manifest/icon and an authenticated Mac ZIP download.
- A runnable Mac companion with a local-only authenticated UI and outbound HTTPS
  pairing/polling. Initial actions are device status, public website launch and
  locally enabled Notes/Calendar/Calculator launch. Selected-folder reads stay local.
- One-use expiring pairing codes; hashed scoped device keys; revocation; immutable
  request IDs; durable job publication; single task leases; local duplicate journal.
- Owner text/dictated commands for the initial Mac actions and honest queued/result
  reporting. No on-Mac installation, live pairing or app/browser control test occurred.
- No general mouse/keyboard control, autonomous browser clicking, incoming phone
  conversation or unrestricted iPhone app control is claimed. iPhone actions depend
  on supported Shortcuts/App Intents and Apple permissions.

`ELEVENLABS-VOICE.md`, `LOCAL-DEVICE-AGENT.md` and `DEVICE-CAPABILITIES.md` contain
setup details and primary sources. The server remains one replica with a persistent
volume and HTTPS owner login. Never put provider keys or Mac device keys in chat.


## Verified hosted result

Railway CLI account access succeeded and production deployment
`8c52a949-e9c4-414a-92ba-980d4d8781cd` reached SUCCESS. Persistent storage, an HTTPS
domain and private owner authentication are configured. The live HTTP checks passed
for health, static app, manifest, unauthenticated route denial, owner login, logout
revocation and authenticated Mac ZIP download/CRC. The initial Railpack failure was
fixed by adding the root start script. No additional subscription or telephone
number was purchased by the agent.

The current full suites pass:92 core,37 API,7 MCP(including real stdio) and24 local
companion tests. The previous child-process restriction no longer blocks stdio.
Workspace typechecks and the production cloud build pass. Budget copy now explicitly
identifies recorded costs and unconnected hosting/provider billing.

The owner still needs to enter ElevenLabs API key and voice ID in Railway Variables.
Voice remains disabled and disconnected at verification; no synthesis or phone call
is claimed. Business-data, search, mail, push and telephone connections also remain
unconfigured. See DEPLOYMENT.md for the exact next actions and current limits.

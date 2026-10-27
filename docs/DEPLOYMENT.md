# Jarvis hosted deployment

> **Discovery program deployed:** Railway deployment
> `2fcae55f-49e1-45af-a533-34beee3ad1e8` reached **SUCCESS** on 27 October 2026.
> All 454 workspace tests, the production build, 165 browser checks and 51 hosted
> checks passed. The private daily program is enabled for three candidates around
> south-east Melbourne with the supplied Wulff Digital company identity. See
> [DISCOVERY-PROGRAM.md](DISCOVERY-PROGRAM.md).

The first verified hosted report rebuilt three previously researched businesses
without another search. It produced three private Clarity demos and email drafts,
with two sourced logos and seven photographs. Each matching eight-file React ZIP
passed CRC validation and excluded owner credentials and private publication
tokens. The deployed JavaScript and CSS hashes match the browser-verified build.
Public concept URLs remained unavailable (HTTP404), no email was accepted or sent,
and no paid voice request was made. A repeated run retained the same report ID
and completion timestamp; logout restored HTTP401 on private routes.

A separate read-only refresh of those same three business websites then found
published contact-email candidates for two businesses, with source provenance and
**no contact basis established**. The remaining business still lacks a suitable
logo and a sourced recipient. The refresh made no new discovery search; all three
drafts remained blocked for sending and all concepts remained unpublished. The
two-logo/seven-photo totals were retained. A published address is not consent or
proof that the owner has reviewed the message.

The owner must choose **Enable spoken updates** with Jarvis in the foreground and
an installed device voice available. Browser checks exercised this behaviour with
mock speech; no playback through the owner's physical speaker was verified.
Gmail remains **not connected** pending Google client configuration and consent.
The company domain is owner-provided identity metadata; no DNS or company-site
publication was performed by this release. Keyless search limits and existing
Railway charges still apply.

Current validation: 185 core, 227 API, seven MCP, 24 local-agent and eleven UI unit
tests; 74 program UI, 45 report-voice and 46 Clarity browser checks. A generated
React project also passed a real TypeScript check and Vite production build.
The private hosted verification report is kept outside the repository at
`/workspace/scratch/discovery-live-verification.json`.

## Previous verified Gmail release

Railway reported Gmail release deployment `889323aa-3f3a-4f1f-b75a-db3fde6e2aaf`
**SUCCESS** on 26 October 2026. Final live HTTP verification passed all 23 checks;
the Gmail connection itself was disconnected without the owner's Google OAuth
client and consent. That release passed 401 workspace tests and 116 browser checks
before deployment. See the Gmail release section below.

The preceding connection release, deployment `3233ef8b-578a-42aa-afee-09487732526e`,
also reached **SUCCESS**. Its live verification is recorded below as historical
evidence; it does not establish final verification of the current deployment.

- App: https://atlas-command-centre-production.up.railway.app
- Project: `7e09329c-bfbb-4e13-84b3-15c9e4ef2b75`
- Environment: `92182d14-a89c-4ddf-b789-bc14e4d0e7d4` (`production`)
- Service: `4939766f-ca02-4e3f-b888-6681dd56915a`
- Volume: `fdc41a79-5077-4bca-8673-3fd4ab26cd10`, mounted at `/data`
- Server: Node24, port8787, one replica, live mode without fixture fallback.

Root `package.json` contains both build and start scripts so Railpack can infer the
monorepo entry point. The build compiles the workspace and packages the Mac ZIP.
Owner credentials and the actual phone number are server-side variables and are
not committed. The owner sign-in key was delivered privately in the conversation.

Live HTTP verification of the preceding connection release passed:

- `/healthz`, the login page and web-app manifest return200.
- Operational status, devices, voice and Mac download routes return401 without a session.
- Owner login succeeds and issues a Secure session; logout invalidates access.
- Authenticated status reports live mode with actual connection states.
- Authenticated Mac ZIP download returns200 and passes ZIP CRC validation.
- The deployed Jarvis JavaScript and CSS SHA-256 hashes exactly match the build
  that passed the new connection-screen browser checks.
- The read-only ElevenLabs check reports George connected with explicit playback
  enabled. Release verification generated no audio.

The preceding release includes the responsive voice core, private sign-in, command dock,
navigation and unavailable-data panels described in [JARVIS-INTERFACE.md](JARVIS-INTERFACE.md).
All 372 workspace tests and the production build passed before release.
The connection screen passed 49 browser checks. The prior voice release passed
52 browser checks, 21 recording fallback checks and
eleven independent cancellation/reopening regressions. Speech recognition and
recording were mocked in these tests; no physical owner microphone was exercised.
Prior branding/greeting/update browser evidence remains recorded in its release
reports and feature documents.

## Email and website connection release

Devices now starts with **Email & websites**, containing actual hosted email
provider state, a secure Lovable workspace key form, cached read-only project
metadata and a private owned-website registry. The direct Lovable adapter uses
only fixed HTTPS GET requests with bounded responses/timeouts. It verifies the
chosen workspace before encrypting a key; no key is present yet, so actual
hosted Lovable authentication remains **not connected**. No editing/publishing
capability is claimed by this read-only integration.

Two real owned sites were registered through the owner-protected API after
release: BoxSafe at `https://app.boxsafe.com.au/` and Mountain Timbers at
`https://mountaintimbers.com.au/`. Both native production checks returned HTTP200
and their expected public titles. Their source-verified Lovable project IDs are
stored, with the verified BoxSafe GitHub repository reference. The similarly
named Boxsafe Reimagined project was not used: source inspection identified it
as ANBF. Public page checks do not establish private customer-data or editing
access. The actual voice command **Which websites are linked?** returned these
two registered names and the honest workspace-connection state.

At this preceding release, both hosted mail transports were **not connected**,
with no selected sender address configured, and the hosted adapters were outbound
only. The Gmail inbox implementation is recorded in the newer release below.
The separate ChatGPT Gmail connector's credentials are not transferred to Jarvis.
Native Outlook or iCloud sign-in still requires the chosen provider's
implementation and authorisation. No account was created on the owner's behalf.

The deployed JavaScript/CSS match `index-v1-yb8Xj.js` and `index-B5ayzEGl.css` from
the verified build. Owner auth, read-token scope, credential protection and
registry/voice routes passed; existing George voice read connectivity remains
operational. No paid build, message, public website deployment or provider key
creation occurred during connection verification. Setup and official sources:
[EMAIL-AND-WEBSITE-CONNECTIONS.md](EMAIL-AND-WEBSITE-CONNECTIONS.md).

## Gmail connection and read-only inbox release

The current deployment adds private Google Web OAuth-client JSON upload in
Devices → Email & websites → Gmail setup, encrypted server-side client and token
storage, and binding to the exact mailbox selected privately by the owner. The
owner's mailbox address and credentials are not embedded in public source.

After consent, the owner can explicitly refresh up to 20 inbox summaries, search
within the inbox and open an individual message as plain text. Loading the panel
does not automatically read email. Remote images, active HTML and attachment
downloads are omitted; message contents remain untrusted data. Requested Gmail
scopes are `gmail.readonly` and `gmail.send`, alongside OpenID/email identity.
No archive, delete or mark-read capability is requested or implemented by the
inbox. The existing exact-version approval and durable send guards still govern
outgoing prospect email; connecting the mailbox sends nothing.

Google OAuth client configuration is still missing, so Gmail is **not connected**
and no live mailbox result is claimed. The owner must enable Gmail API, configure
Google Auth Platform and any required test user, create a Web application OAuth
client with the exact callback shown in the app, upload its JSON privately, then
consent using the selected mailbox. A Google external app in Testing may require
reconnection after seven days. Credentials must not be pasted into chat.

All 401 workspace tests and 116 browser checks passed. Mail/provider responses in
those tests are fictional and do not establish real Google authorisation.
Final hosted verification passed all 23 checks:

- Secure owner login succeeded; unauthenticated mail routes returned401 and logout
  revoked access.
- The intended mailbox was saved privately. Live Gmail reported no configured
  client, no client source or linked address, `inboxReady: false` and
  `state: not_connected`. No private address was added to source.
- Inbox access returned503 with setup guidance and no fixture fallback. The
  **Check my inbox** command also returned setup guidance without reading mail.
- BoxSafe and Mountain Timbers remained registered and their public checks
  reported HTTP200. This establishes public reachability, not private data access.
- ElevenLabs reported George connected and playback enabled; no audio was
  generated and no paid voice request was made.
- The deployed JavaScript/CSS SHA-256 hashes exactly matched the build that
  passed all 116 Gmail browser checks.

The verification evidence remains outside the repository at
`/workspace/scratch/gmail-live-verification.json`; it contains private
configuration and must not be committed. No real emails were read or sent, no
provider credit was consumed and no new purchase was made for this release.
Existing Railway billing is not reconciled by these checks.

## Interactive voice release

The authenticated app now has a persistent **Talk to Jarvis** control on every
screen, with direct entry at `/#talk`. It supports live browser transcripts,
one submission per final utterance, automatic device-voice replies, optional
follow-up listening, cached repeat and a local spoken stop. Close, sign-out,
backgrounding, permission errors and explicit Stop stop capture/playback; delayed
responses cannot restart them. The conversation survives screen navigation.
Mac microphone permission guidance is visible in the panel.

The actual hosted command endpoint answered a greeting and a polite request for
current concept counts, and declined negated/explanatory approval phrases without
changing approvals. Ten private concepts were present in the live check. Existing
free web lookup, George voice read connectivity, protected routes, session
revocation and the Mac ZIP integrity also passed. At voice-release verification, deployed assets matched
the tested build: `index-BksF833w.js` and `index-Cjw6pBaP.css`.

The optional recording fallback is enabled but remains **unverified**: no actual
paid transcription has been attempted. Its existing server key is configured;
Speech-to-Text permission and provider credits are not established by the working
text-to-speech voice. Read-only status checks and a rejected empty request left
its upload/attempt counters at zero. Each clip requires explicit credit consent,
uses fixed Scribe v2, and fills the text field for review before Send. Durable
attempt/byte quotas and one-attempt jobs are enforced; raw audio and transcripts
are not persisted by the transcription module. Browser dictation and ordinary
device replies do not invoke ElevenLabs.

Physical Mac/Safari/Chrome microphone capture and sound output require the owner
browser's permissions and remain unverified here. Conversation is limited to the
implemented business commands and web lookup, with friendly deterministic help;
no unrestricted model, background wake word or automatic paid speech is claimed.
See [VOICE-INTERACTION.md](VOICE-INTERACTION.md).

## Branding, greetings and owner updates

The live production transport fetched four real business logos and three photos
per business for ShineCraft Detailing Hub, Personal Performance Training Centre,
M&M Mobile Tyre and Auto, and Officer Plumbing Services. Protected concept HTML
contains embedded raster images and sourced details. The chosen design styles
were preserved, drafts received new exact hashes, contact eligibility remained
unestablished, and all five refreshed concepts remained private. Cranbourne
Fencing supplied an address and phone but explicitly prohibits copying artwork;
that concept retains original illustrations with the restriction recorded.

The automatic greeting uses the device's own speech voice once per sign-in, with
no AI/ElevenLabs request. Browser checks cover autoplay needing a tap, voice
selection, the off switch, reload/navigation deduplication and microphone/audio
priority. Physical iPhone speech playback has not been tested here.

Studio now lets the owner choose Gmail or business-domain Resend explicitly.
Resend supports a domain the owner controls independently of its mailbox host;
native Outlook/iCloud sign-in is not implemented. Both email connections remain
**not connected** because no sender credentials are saved. Devices → Owner
updates offers opt-in email/Telegram alerts, explicit test buttons and a digest
after 09:00 Melbourne time. The verified live settings contain no recipient,
all delivery switches are off and no owner submission exists. Connection reads
and setup pages remain protected by owner login.

No email, Telegram message, paid audio or public concept was submitted during
release verification. No new subscription, service upgrade or domain was bought.
See [BRANDING-AND-UPDATES.md](BRANDING-AND-UPDATES.md).

## Client acquisition release

Studio now discovers bounded local service-business candidates through official
free keyless Tavily search and prepares private concepts and email drafts. The
daily worker is enabled for up to three candidates per Melbourne day across the
configured south-east Melbourne area. Discovery requires sector/locality evidence
and excludes documents, public institutions, directories and major fitness chains.
Weak pilot matches were archived with their evidence and previews revoked.

The release imported thirteen source-backed existing/manually researched records.
Five tailored concepts and matching drafts were verified through actual protected
HTML reads: Cranbourne Fencing, ShineCraft Detailing Hub, Personal Performance
Training Centre, M&M Mobile Tyre and Auto, and Officer Plumbing Services. Following
the live discovery check and rejected-match review, the active queue held fifteen
records and seven private concepts. Search-only identities remain unverified.

Actual Gmail/Resend sending is **not connected**. Google OAuth client configuration,
owner sign-in, contact eligibility and exact outgoing-version approval remain
required. No prospect email or public concept was sent/published during this
release work. The private setup guide is linked in Studio's Sender setup.
See [CLIENT-ACQUISITION.md](CLIENT-ACQUISITION.md).

No physical Mac installation, live Mac pairing, device automation or phone call
has been performed here. Those require the owner's device or provider setup.
The owner has since configured ElevenLabs: the hosted read-only voice check
passed, explicit playback is enabled, and the owner confirmed playback works.
No BoxSafe or Stripe financial result is claimed.

## Owner setup

Open the app and enter the privately delivered owner access key. On iPhone, use
Safari's Share → Add to Home Screen. On Mac, open Devices, download the companion,
create a pairing code, and enter the HTTPS app origin/code into the local helper.
Keep the Mac awake and its helper running for remote tasks. Use Devices to revoke
its access. The Mac's own key is separate from the cloud owner sign-in key.

In Railway's service **Variables** tab, set `ELEVENLABS_API_KEY` and
`ELEVENLABS_VOICE_ID` from the owner's account. Keep generation disabled until the
read-only voice check succeeds and credit use is authorised. The app labels device
speech separately from ElevenLabs. See `ELEVENLABS-VOICE.md` for key permissions,
limits and the explicit Play button.

## Still disconnected at verification

BoxSafe, Stripe, quote email, prospect email, Twilio and ntfy have no verified live
credentials. ElevenLabs is verified separately through `/api/voice/status`.
Website checking is available; that capability state does not
assert an arbitrary site's reachability. Scheduled checks run, and the dashboard
shows connection failures. Free keyless Tavily discovery is verified and daily
private preparation is enabled. Customer sending remains blocked by the actual
mail connection and approval/eligibility gates. No production BoxSafe write was enabled.

## Maintenance

Use explicit project/environment/service IDs when deploying. Verify terminal
SUCCESS and owner authentication after each release. Keep one replica while
sessions remain in memory. Restart signs the owner out; SQLite stays on the volume.
Backups and provider-wide billing reconciliation are not configured. Budget figures
in the app are recorded costs only; they do not include unconnected provider bills.

The current CLI warns that `railway.json` config-as-code is supported until
1 December2026. Migrate deployment configuration before that cutoff; root build
and start scripts already allow Railpack inference. The running deployment is not
reported as a permanent availability or billing guarantee.

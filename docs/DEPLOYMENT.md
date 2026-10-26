# Jarvis hosted deployment

Verified 26 October 2026. Railway reported deployment `351706f4-919c-4f89-8dc1-84784a195177`
**SUCCESS**. This is a CLI source upload, not an unverified queued build.

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

Live HTTP verification passed:

- `/healthz`, the login page and web-app manifest return200.
- Operational status, devices, voice and Mac download routes return401 without a session.
- Owner login succeeds and issues a Secure session; logout invalidates access.
- Authenticated status reports live mode with actual connection states.
- Authenticated Mac ZIP download returns200 and passes ZIP CRC validation.
- The deployed Jarvis JavaScript and CSS SHA-256 hashes exactly match the build
  that passed the new branding, greeting and owner-update browser checks.
- The read-only ElevenLabs check reports George connected with explicit playback
  enabled. Release verification generated no audio.

The release includes the responsive voice core, private sign-in, command dock,
navigation and unavailable-data panels described in [JARVIS-INTERFACE.md](JARVIS-INTERFACE.md).
All 350 workspace tests and the production build passed before release.
The voice release passed 52 browser checks, 21 recording fallback checks and
eleven independent cancellation/reopening regressions. Speech recognition and
recording were mocked in these tests; no physical owner microphone was exercised.
Prior branding/greeting/update browser evidence remains recorded in its release
reports and feature documents.

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
revocation and the Mac ZIP integrity also passed. Deployed assets exactly match
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

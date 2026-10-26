# Jarvis hosted deployment

Verified 26 October 2026. Railway reported deployment `bb350e1c-4dc8-47f2-a715-302aaeb5f1f6`
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
  that passed 131 browser checks across desktop, tablet and phone widths.
- The read-only ElevenLabs check reports George connected with explicit playback
  enabled. Release verification generated no audio.

The release includes the responsive voice core, private sign-in, command dock,
navigation and unavailable-data panels described in [JARVIS-INTERFACE.md](JARVIS-INTERFACE.md).
All 160 workspace tests and the production build passed before release.

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

BoxSafe, Stripe, Brave Search, Resend, Twilio and ntfy have no verified live
credentials. ElevenLabs is verified separately through `/api/voice/status`.
Website checking is available; that capability state does not
assert an arbitrary site's reachability. Scheduled checks run, and the dashboard
shows connection failures. Daily discovery remains disabled until a search provider
is authorised. No customer outreach or production BoxSafe write was enabled.

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

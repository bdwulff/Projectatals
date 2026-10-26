# Jarvis voice through ElevenLabs

This implementation adds an explicit owner audio preview. A configured voice is
verified using a read before any generation. It does not clone voices, place calls,
create an ElevenLabs agent or activate a subscription. No live ElevenLabs request
or generation was made during implementation; mocked tests establish code behaviour.

## Connect the account

Use the owner's ElevenLabs account and an existing voice the account can use.
Keep the API key in the Railway secret manager or the local server's environment;
never paste it into chat, source code, browser storage or a URL. A ChatGPT plugin
connection is separate from the server-side credentials this app uses.

Configure these variables on the Jarvis server:

```text
ELEVENLABS_API_KEY=<server-side key>
ELEVENLABS_VOICE_ID=<existing authorised voice ID>
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
ATLAS_ELEVENLABS_ENABLED=false
ATLAS_VOICE_MAX_CHARACTERS_PER_REQUEST=1200
ATLAS_VOICE_MAX_CHARACTERS_PER_DAY=4000
```

Start with previews disabled. An authenticated `GET /api/voice/status` verifies
the exact configured voice through `GET /v1/voices/{voice_id}`; it does not generate
audio. The key needs permission for that read and text-to-speech. The voice name
and connection state are displayed without exposing the key.

Review the account's remaining credits, selected plan and usage-based billing
settings. The app's character cap is a local guard, not a dollar budget or a
provider-wide account spending limit. Models/plans have different credit rates.
Only after authorising existing credit use, set `ATLAS_ELEVENLABS_ENABLED=true`.
The supported models are `eleven_multilingual_v2` and `eleven_flash_v2_5`.

## Use it

In the authenticated command centre, each assistant reply has a
**Play ElevenLabs · uses credits** button when the configured voice is ready and
enabled. Clicking it explicitly sends that reply text to ElevenLabs. Polling,
notifications, receiving a command result and opening the dashboard never generate
cloud speech. The existing speaker toggle uses the device/browser voice and is
labelled separately.

Audio is returned as MPEG to the signed-in browser. A replay button/audio controls
reuse already generated audio. A browser that blocks initial playback can use
those controls without another generation. Replies longer than the per-request
limit remain readable with device voice instead of silently truncating content.
If a response is lost, recovering the existing preview reuses the same request ID.
Generating another preview has a separate explicitly labelled credit-using action.

The provider necessarily receives the selected speech text. Audio is cached in
the server process for up to 15 minutes (maximum eight entries); it is not put in
the persistent job database. A browser retains its generated audio while the
command centre remains open. Restart or expiry removes the server audio cache.

## Billing and delivery safeguards

Generation goes through the existing durable JobQueue with one attempt and a
unique request ID. Jobs persist only text hash, character count, voice/model IDs
and safe status metadata—not the API key, full text or audio. Character allowance
is reserved before the billable request. Failed or ambiguous submissions keep the
reservation and never retry automatically, even after a server restart. If audio
has expired, a new explicit owner click with a new request ID is needed to generate
it again and may use additional credits.

Responses are limited to 2 MiB, supported configured voices/models, fixed official
API destinations, bounded timeouts and local daily character caps. No caller can
choose another URL or voice. A successful generation means audio was returned;
it does not prove the phone speaker played it or that a telephone call occurred.

All `/api/voice/*` routes must be installed after owner authentication. The
briefing-only bearer token cannot use them. POST requests retain same-origin JSON
and body-size enforcement from the API. This service assumes the app's documented
single replica and persistent database; it is not a distributed quota service.

## Official sources checked

- [Create speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert):
  POST `/v1/text-to-speech/{voice_id}`, `xi-api-key`, `{text,model_id}` and MPEG output.
- [Get a voice](https://elevenlabs.io/docs/api-reference/voices/get): harmless
  configured-voice verification.
- [List/search voices](https://elevenlabs.io/docs/api-reference/voices/search):
  `GET /v2/voices`, voice-ID filters and pagination.
- [Models](https://elevenlabs.io/docs/overview/models) and
  [model metadata](https://elevenlabs.io/docs/api-reference/models/list):
  compatibility and account/model limits.
- [Subscription details](https://elevenlabs.io/docs/api-reference/user/subscription/get):
  remaining allowance and usage-billing settings. This app does not alter them.

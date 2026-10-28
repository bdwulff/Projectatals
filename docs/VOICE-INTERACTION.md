# Speak with Jarvis

Open the private app at
https://atlas-command-centre-production.up.railway.app/#talk and sign in.
Choose **Start voice conversation**, or use **Talk to Jarvis** from any screen.
The button requests your browser's microphone permission. A URL or page load
never starts the microphone automatically.

## On a Mac

Use Chrome or Safari and allow the microphone when prompted. Speak a request,
then pause. The live transcript shows what the browser heard; only final speech
is submitted when recognition ends. Jarvis reads the response through the
device's speech voice. Choose **Keep the conversation going** to listen for the
next turn after the reply finishes. Silence or a browser error pauses the
conversation; it does not repeatedly reopen the microphone.

Try:

- “Hi Jarvis.”
- “How many website concepts are ready?”
- “What is connected?”
- “What did you prepare today?”
- “Give me my morning briefing.”
- “Look up local business website design in Berwick.”
- “Find three fencing businesses near Cranbourne.”
- “Repeat that.”
- “Jarvis, stop listening.” (Stops locally, without sending a command.)

The conversation remains available as you navigate the app. Reloading the page
clears its in-memory history. Closing the panel, switching away from the app,
signing out or choosing Stop stops capture and playback. Replies that arrive
after stopping do not restart audio or listening. If Safari requires another
tap for speech, use **Read reply aloud** on that reply, then restart the voice
conversation. Text input remains available.

If microphone access is blocked:

1. In Chrome, open the controls beside the address, then **Site settings →
   Microphone → Allow** for this Jarvis address. In Safari, open **Settings →
   Websites → Microphone** and allow this site.
2. On the Mac, open **System Settings → Privacy & Security → Microphone** and
   enable the browser if it appears there.
3. Check **System Settings → Sound → Input** for the microphone you want, then
   return to Jarvis and choose **Start voice conversation**.

These browser/device permissions require the owner to allow access. The hosted
server cannot grant them. Browser speech support depends on the browser and its
speech service. It may process audio online. It does not call the Jarvis
ElevenLabs endpoints or consume ElevenLabs credits.

## Optional recorded input

The voice panel has a separate **Recorded voice** alternative for browsers whose
speech recognition is unavailable. Recording uses the device's microphone and
stays on the device until the owner checks the credit-use confirmation and
chooses **Transcribe · uses ElevenLabs credits**. The browser stops recording at
30 seconds. A local preview and discard control are available.

The server uses the existing ElevenLabs key and the fixed `scribe_v2` model.
Transcription is a separate permission from text-to-speech: a working George
voice does not prove that the key or account can transcribe. Status is
`unverified` until an actual recording succeeds. No paid test is run to establish
readiness. The returned transcript fills the text input for review; it does not
execute a business command until the owner selects Send.

Server settings:

```text
ATLAS_ELEVENLABS_TRANSCRIPTION_ENABLED=true
ATLAS_TRANSCRIPTION_MAX_REQUESTS_PER_DAY=10
ATLAS_TRANSCRIPTION_MAX_RESERVED_SECONDS_PER_DAY=300
ATLAS_TRANSCRIPTION_MAX_AUDIO_BYTES_PER_DAY=5242880
```

Each clip is at most 1 MiB. Every attempt reserves a full 30 seconds from the
local allowance regardless of its claimed duration; actual byte and attempt
limits are enforced. The server does not independently verify audio duration,
and these local counters are not an AUD billing ceiling. Provider plan limits
and charges still apply. Credentials stay on the server. The transcription
module persists hashes, quotas and job metadata, not raw audio or transcripts.
After Send, the transcript becomes a normal owner command and follows the app's
ordinary audit behaviour.

Submissions have one attempt and a durable request ID. Reusing the same clip and
ID can recover an in-memory result without another provider upload. A changed
clip, unknown result, expired result or process restart never causes an automatic
retry. A client cancellation cannot undo a provider request already started.

Official API sources, checked 26 October 2026:

- https://elevenlabs.io/docs/api-reference/speech-to-text/convert
- https://api.elevenlabs.io/openapi.json

## Current scope

The app supports voice entry, spoken replies, a conversation log, repeat and
turn-taking around its existing business commands and web lookup. Its router is
deterministic; it is not an unrestricted general-purpose language model. It does
not provide a background wake word or listen when closed. Production changes,
outreach and payments retain their existing approval and permission rules.
ElevenLabs reply playback remains an explicit paid option; normal conversation
does not generate a premium reply automatically.

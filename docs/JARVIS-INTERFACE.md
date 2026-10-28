# Jarvis command centre

The 26 October interface update makes the existing private app a Jarvis-style
workspace. It retains owner-key sign-in and all existing API approval gates.

- A central cyan reactor core shows idle, listening, processing, speaking and
  error states. Microphone and playback events drive the corresponding states;
  idle animation does not mean the microphone is active.
- The core and microphone button start browser dictation where supported.
  Typing always remains available. Command/Ctrl+K focuses the command input;
  Escape stops dictation. There is no background wake-word listener.
- Quick commands use the existing briefing, BoxSafe orders and business research
  operations. A missing integration returns its actual unavailable state.
- ElevenLabs stays an explicit per-reply action labelled with credit use. The
  device speech toggle is separate. Playback controls and replay reuse the
  already-generated audio; generating a new preview is separately labelled.
- Overview shows Melbourne time, actual approval/alert counts, service states,
  the reported background attempt, daily briefing and notifications. Missing
  financial connections produce an unavailable notice, not fictional figures.
- All six existing screens remain accessible through desktop navigation and
  the mobile bottom bar. Reduced-motion preferences suppress sustained motion.

No new account, subscription, paid provider action or external font/image service
is required for this design. This interface does not add broader device control,
document uploads or a general-purpose language-model backend.

Validation: all 160 workspace tests and the production build passed. A separate
Chromium run against the production UI and an isolated authenticated live-mode
API passed 131 checks at 1440, 768, 390 and 320 pixels. It covered all six tabs,
sign-in/out, overflow, reduced motion, keyboard focus, connection guidance and
the explicit voice trigger. The 390px view fits the command input above the
bottom navigation; smaller screens allow scrolling. Provider generation was
intercepted in browser tests, so no real audio or provider credits were used.

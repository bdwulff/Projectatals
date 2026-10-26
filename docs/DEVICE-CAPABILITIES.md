# Jarvis on Brandon's devices

Verified against the primary platform sources below on 26 October 2026. This
workspace is not Brandon's laptop or iPhone. Code and mocked tests do not establish
that a device agent is installed or has permissions.

Brandon selected a Mac laptop and private sign-in from anywhere. The chosen route
is the protected Railway dashboard on Mac/iPhone plus an explicitly paired Mac
companion. It does not require exposing a laptop listener to the public internet.
The Devices page requests status, public website opening and locally enabled app
launches. Other iPhone or in-app actions still need their own supported integration.

## What can operate where

| Task | Practical route | Access or limitation |
|---|---|---|
| Open Jarvis like an app on iPhone | Safari → Share → Add to Home Screen → Open as Web App | Same protected website and sign-in. Installation grants no access to other apps. |
| Open Jarvis like an app on laptop | Browser installation where supported, or local dashboard | Browser permissions still apply. Native device actions require the separately installed local helper. |
| Web lookups and research | Existing authenticated search adapter | Needs a configured provider. Search findings cannot authorise actions. |
| Open a website on laptop | Local helper invokes the default browser with a validated public URL | Owner-triggered. Opening a page is not proof of login, submission or purchase. |
| Read selected local files | Helper with an owner-selected root folder | Selected scope only. A cloud backend cannot directly read laptop files. |
| Control a Mac app | Supported app API/scripting; sometimes Accessibility UI automation | Owner must grant Automation/Accessibility permissions. App support varies. |
| Open a Windows app | Registered URI or fixed allowlisted executable | Installed handler/API determines supported tasks; launch is not arbitrary in-app control. |
| Use an iPhone app action | That app's Shortcuts action/App Intent, URL scheme or official API | Only exposed actions and granted data; some actions need foreground or confirmation. |
| Voice interaction | User-started dictation and playback; Siri can launch a Shortcut | Browser support and microphone permission apply. A web app is not a system-wide always-listening wake word. |
| ElevenLabs voice | Explicit server-side speech request and playback | Selected text goes to ElevenLabs; private app access does not make processing offline. |
| Background checks | Running hosted worker or awake local laptop process | A sleeping phone browser is not a durable scheduler. A sleeping laptop cannot execute local actions. |

Third-party iOS apps are sandboxed and can access other apps' data only through OS
services. System resources are protected and background work uses system APIs.
Neither a web app nor an ordinary native Jarvis app can promise unrestricted
iPhone app/UI control. Use specific supported actions and test the actual device.
[Apple runtime security](https://support.apple.com/en-au/guide/security/sec15bfe098e/web)

App Intents expose an app's own actions to Siri, Shortcuts and other system
experiences. Runtime modes determine whether the app stays in the background or
comes forward. This does not expose all features of every installed app.
[App Intents](https://developer.apple.com/documentation/AppIntents),
[runtime modes](https://developer.apple.com/documentation/appintents/configuring-the-runtime-behavior-of-your-app-intents)

macOS Automation and Accessibility are distinct owner-granted capabilities in
Privacy & Security. UI scripting support varies by application.
[Automation](https://support.apple.com/en-au/guide/mac-help/mchl108e1718/mac),
[Accessibility](https://support.apple.com/en-au/guide/mac-help/mh43185/mac),
[UI scripting](https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/AutomatetheUserInterface.html)

Windows supports URI-based app activation, including the default browser for
HTTP(S). Registered handlers/APIs determine supported actions. Some launches need
foreground user initiation or an OS prompt.
[Microsoft URI activation](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-default-app)

## Access and processing are separate choices

**Device-only access:** keep the helper on loopback. `localhost` on iPhone refers
to the iPhone, not the laptop. Phone access to a laptop-hosted interface needs an
explicit private connection, trusted HTTPS and authentication. Do not widen the
helper to an unauthenticated LAN listener. A private VPN is a possible later
route; no VPN account, tunnel or pairing is established by this document.

**Private sign-in from anywhere:** a Railway URL may be internet reachable while
its business API requires the owner's session. This is authenticated remote
access, not LAN-only access. Laptop operations still require a paired local
helper. A cloud website must not assume every browser permits direct loopback or
private-network requests. Use a reviewed paired transport or local controller,
not weaker CORS, cookies or host checks.

**On-device processing:** independent of access. ElevenLabs and remote search or
model providers receive selected request content. Strict offline processing
requires local alternatives; the ElevenLabs adapter cannot work offline.

## Minimal usable packaging

The React dashboard includes a same-origin manifest, Jarvis SVG icon and Safari
Home Screen metadata. Its system font stack no longer requires Google Fonts.
There is deliberately no service worker/private-data cache. Installation does not
imply offline business operation, native control, web-push delivery or background
permissions.

On iPhone, open the verified private HTTPS app in Safari, sign in, then choose
Share → Add to Home Screen and enable Open as Web App if shown. Names vary with
iOS version; sign-in remains required after opening the icon.
[Apple installation steps](https://support.apple.com/en-au/guide/iphone/iphea86e5236/ios)

A first Siri Shortcut can open the app. Later, scoped shortcuts may call an
authorised API or exposed app action. Do not embed the unrestricted owner key in
a shared Shortcut, URL or exported file. No signed native iOS app, signed
`.shortcut` package or blanket phone-control permission is created by a manifest.
[Shortcuts and automations](https://support.apple.com/guide/shortcuts/intro-to-automation-shortcuts-apd690170742/ios)

## Device-control boundaries

The helper must authenticate a separately paired device, validate its Host and
exact Origin, and expose named capabilities with bounded inputs. Enable each
capability deliberately. Do not expose an arbitrary shell/script endpoint or
reuse a cloud session as an unbounded device credential. File access must resolve
symlinks and stay inside selected roots. Screenshots, browser sessions, clipboard
and microphone content enter provider requests only for a defined owner task.

Web content and model output remain data until an action validator checks the
capability, destination and current approval. Customer messages, payments,
credential changes, destructive files, purchases and production mutations retain
the project's existing permission/approval rules. Keep a local stop control and
revocable pairing; distinguish accepted, started and verified-complete actions.

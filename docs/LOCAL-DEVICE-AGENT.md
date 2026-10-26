# Jarvis on your Mac

Jarvis's private web dashboard and the Mac helper serve different jobs. The web
service handles owner sign-in, research and business workflows. The helper runs
on your Mac and opens websites or explicitly allowed applications there. A cloud
server cannot control a laptop merely because both are signed in.

## What is implemented

- A local control screen at `http://127.0.0.1:13473`, protected by a device key.
- Open a public HTTP(S) website in your normal Mac browser.
- Open Calculator, Notes or Calendar **only after you enable their IDs locally**.
- List/read small UTF-8 files from one folder you select locally; starts disabled.
- Pair this Mac to your private HTTPS Jarvis service, then receive only locally
  approved browser, application-launch and device-status tasks by outbound polling.
- Persist each remote/local launch reservation before acting, so restart or a lost
  acknowledgement cannot silently repeat a launch.

An operating-system launch request is reported as **attempted**. It does not prove
a website loaded or an application completed its work. Browser reading, clicks,
typing, screen observation, arbitrary shell commands, file writes/deletes and
controlling other iPhone apps are not implemented by this helper.

## First run

1. Extract the Mac helper ZIP into a folder you intend to keep. Do not run it from
   inside the ZIP. Keep the included files together.
2. The launcher reuses Node22.13+ if present. Otherwise it asks before downloading
   the official pinned [Node24.22.1 LTS](https://nodejs.org/en/blog/release/v24.22.1)
   for Apple Silicon or Intel into your own Application Support folder. It checks
   both the official SHASUMS256 manifest and the pinned published SHA256 before
   extraction or execution. This needs no administrator access or global PATH change.
   You can decline and install Node yourself from [nodejs.org](https://nodejs.org/en/download).
3. Open `Jarvis.app` in the package, or `Start Jarvis.command`. This is an unsigned
   launcher for the local app, not a signed/notarised native Mac release. macOS may
   ask you to use Open from Finder's context menu.
4. The launcher creates `~/.atlas-local/device.json` with a random device key and
   opens it locally in TextEdit. Copy its `token` into the local sign-in screen.
   **Do not paste that key into chat or into a website.**
5. The app opens at `http://127.0.0.1:13473`. Try opening a public website. The
   laptop launches its browser; Jarvis reports the launch request honestly.

The source-only equivalent from the project folder is:

```sh
node apps/local-agent/src/server.mjs setup
node apps/local-agent/src/server.mjs start --open
```

The local interface listens on loopback only; it cannot be opened directly from a
phone or another machine. For access from anywhere, pair through the signed-in
private hosted dashboard as described below.

## Pair your Mac to the private dashboard

1. Sign into your private Jarvis web dashboard and create a one-time device pairing
   code. The hosting owner session is separate from the Mac's device key.
2. In the Mac's **local** control screen, enter the dashboard's exact HTTPS origin
   (for example `https://your-app.up.railway.app`) and that pairing code.
3. Review the permissions. Device status is included; public website opening is
   selected initially. Application launch can only be selected when apps are also
   enabled locally. Click **Pair this Mac** to approve that scope.
4. The Mac stores a scoped device token in its private local configuration and
   polls outbound every five seconds. No router port forwarding or public Mac
   listener is created.
5. Request a supported task from the private dashboard and confirm its result.
   For a browser task, actual browser display is verified on the Mac, not inferred
   from a submitted provider record.

The Mac must be awake and the helper running. Closing its terminal stops device
control; hosted background business checks can continue independently. This release
adds no login/startup daemon. Use **Disconnect** locally to stop polling and erase
its saved link. Revoke the device in the hosted dashboard as well if the local
configuration was lost or compromised.

## Optional local permissions

Edit `~/.atlas-local/device.json` locally, then restart the helper:

```json
{
  "allowedApps": ["calculator", "notes", "calendar"],
  "readOnlyRoot": "/Users/YOUR-USER/Documents/Jarvis"
}
```

These are only the fields to change in the existing file; preserve its version,
port and generated key. Application IDs are a fixed list, never executable paths
or shell scripts. No app is enabled by default. Folder access is for trusted,
owner-selected local files only and is never exposed as a cloud task.

Hidden files, known credential/key files, paths outside the selected folder and
symlinks are refused. Reads are bounded to128KiB and directory listings to100
entries. These checks are not an operating-system sandbox against a malicious
process already running as your Mac user; do not select a directory controlled
by an untrusted process.

## Security and operational facts

- Owner device keys, scoped cloud tokens and the durable action journal stay under
  `~/.atlas-local`, outside the repository and download package. POSIX file mode0600
  protects the config and SQLite journal; the local data directory is created0700.
- Local business/data routes require a bearer device key or an opaque12-hour
  HttpOnly SameSite Strict session. The HTTP-only cookie is confined to loopback;
  a hosted session must still use HTTPS/Secure cookies.
- Static login resources and health are unprivileged. Host and Origin validation,
  bounded JSON and sign-in limiting protect the local service from web-page calls
  and DNS rebinding. It provides no permissive CORS access to the hosted dashboard.
- Cloud credentials go only to the exact configured HTTPS origin and never follow
  redirects. Pairing grants the intersection of hosted and locally approved
  capabilities. Unknown, expired or malformed tasks do not reach the dispatcher.
- Audit records contain action/outcome/time, not URLs, file contents or secrets.
- No browser or application was opened on Brandon's laptop by the cloud build.
  Tests inject the launcher and network responses. On-device installation and an
  actual paired-Mac test are still required.

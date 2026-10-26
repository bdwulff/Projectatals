# Atlas local MCP and automation setup

Status: 26 October 2026. This is a configuration guide and an inactive workflow
template. No n8n instance, recurring job, push notification, email or phone call
has been configured by these files. No new subscription or credit spend is needed
for the local fictional demonstration.

## Claude Code on Brandon's computer

The GitHub, Lovable and Gmail checks in this ChatGPT session do not authenticate
Claude Code. Claude Code is not installed in this execution environment, so its
version, installed plugins and account permissions have not been tested here.

1. Open the Atlas checkout at the continued development branch. Use Node 22.13+
   and the repository's pnpm 10 package manager.
2. Install the locked workspace dependencies and build the local MCP:

   ```bash
   pnpm install --frozen-lockfile
   pnpm --filter @atlas/core build
   pnpm --filter @atlas/boxsafe-mcp build
   node scripts/setup-claude.mjs
   ```

3. The last command performs local preflight checks and prints a configuration
   using an absolute server path. It never installs plugins or writes files.
   Merge its `boxsafe-fixture` entry into the project's `.mcp.json`. If that file
   does not exist, `.mcp.json.example` provides the same configuration using a
   relative path; run Claude Code from the repository root.
4. Open Claude Code and inspect `/mcp`. Review the project server trust prompt,
   then ask: “Use boxsafe-fixture to check today's orders, reconcile Stripe and
   give me the daily briefing.” The MCP's `ATLAS_MODE=fake` is explicit: every
   result is fictional test data, and it cannot mutate BoxSafe or Stripe.

Anthropic documents [project-scoped MCP configuration and local stdio servers](https://code.claude.com/docs/en/mcp).
Use one registration method for each server so duplicate tools do not appear.
The fixture configuration contains no secrets. Do not add production tokens to
the committed example or paste them into a chat.

Keep BoxSafe fixture mode enabled until a scoped production read interface and
Stripe read access have been verified separately. Switching a label to `live`
does not establish a real connection. See the installation report and
`PLUGINS-AND-INTEGRATIONS.md` for the staged integration inventory; installing a
plugin does not by itself authorise deployments, customer messages or spending.

## n8n: manual read-only workflow

Import `workflows/boxsafe-daily-briefing.n8n.json` into an existing authorised n8n
instance. The file has `active: false`, one Manual Trigger and no Schedule Trigger
or Webhook. It only prepares text in the execution result. It has no send or
mutation nodes and no embedded credentials. Import compatibility and remote
execution remain untested until a specific n8n instance is connected.

Configure these two items in the n8n editor:

| Item | Value |
|---|---|
| `Owner configuration.atlasBaseUrl` | The authorised Atlas origin, such as a private HTTPS service. The placeholder is rejected. For a local same-host test, `http://127.0.0.1:8787` is allowed. |
| HTTP Request credential | A generic Header Auth credential stored in n8n. Name: `Authorization`. Value: `Bearer ` followed by the dedicated Atlas briefing read token. Select this credential on `Read BoxSafe daily briefing`. |

The fixed route is `GET /api/boxsafe/daily-briefing`. Check the API's current token
configuration before testing; a missing token must not be treated as authorised
remote access. The Atlas API binds to loopback by default. A hosted n8n service
cannot reach a server on Brandon's laptop's `127.0.0.1`; use an approved private
network and authenticated service when that deployment is ready. No public
deployment is part of this template.

Configure `ATLAS_BRIEFING_READ_TOKEN` with a separate random value of at least
32 characters in the Atlas service's secret settings, and the matching bearer
value in the n8n credential store. This token can access only the redacted GET
briefing route. It cannot sign in as the owner, approve quotes or run commands.
Keep it separate from `ATLAS_OWNER_ACCESS_KEY`, which is used once at the owner
login form to obtain a server-side, expiring session cookie. Hosted owner login
also requires `ATLAS_PUBLIC_ORIGIN` to match the browser's HTTPS origin. Sessions
use Secure, HttpOnly, SameSite Strict cookies and are revoked by sign-out or a
service restart. No browser access key is stored in localStorage.

The origin guard rejects paths, query strings, fragments, user credentials,
placeholder hosts and non-HTTPS remote origins. The request follows no redirects
and retries only the read-only GET, up to three attempts. TLS validation remains
enabled. The final guard requires `mode` to be `fake` or `live`, plus `spoken`
and `dataNotice`. It refuses mixed or unavailable provenance and refuses
fictional text that loses its spoken fictional-data notice. The final output
contains only those briefing fields; no raw order or customer records are
forwarded.

The template asks n8n not to retain successful, failed or manual execution data.
Confirm your instance's effective execution-retention policy: instance settings
and operator debugging can affect what is stored. Do not pin live customer data.
For a fixture test, the final output must say `fixture: true` and identify the
figures as fictional. Check unauthenticated requests fail before attempting a
real-source manual run.

n8n documents [Header Auth credentials](https://docs.n8n.io/integrations/builtin/credentials/httprequest/),
[HTTP Request configuration](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/)
and [manual versus automatic execution](https://docs.n8n.io/build/understand-workflows/understand-executions/types-of-executions.md).

## Scheduling and owner alerts are the next separate step

After the read path is verified, add a Melbourne-time schedule only with an
agreed cadence and a running, authenticated Atlas service. This template remains
manual so it cannot silently turn fixture figures into recurring reports.

Before adding an owner alert channel, route deliveries through Atlas's durable
`JobQueue` with an idempotency key that includes the business, Melbourne report
date, alert type and report version. Store the provider's accepted-delivery
reference and retry the same job rather than enqueueing another message. No
delivery channel is supplied by this workflow, so repeated manual GET requests
cannot send duplicate messages. Do not invoke `/api/run-checks` as a substitute:
that route runs the wider operational checks.

The A$300 experiment limit remains unchanged. Using an existing instance may have
an execution quota; new n8n hosting, speech APIs, SMS and phone plans require a
separate cost decision. The built-in n8n MCP server is an instance-management
connection, distinct from this daily business workflow; do not connect an
unverified third-party MCP server merely to run this GET.

## Initial mobile speech

The command-centre's existing read-aloud control can speak briefing text using
the device's Web Speech implementation. Browser/device support must be checked
on Brandon's iPhone; the local MCP returns text, not an audio recording.

Once the private authenticated API is reachable on the iPhone, an iOS Shortcut
can Get Contents of URL for the same fixed GET route, supply the bearer header,
read the JSON `spoken` field and use Speak Text. Preserve the fictional notice
and require successful provenance checks before speech. Do not place a privileged
owner API token in a shared Shortcut; use the dedicated briefing read token.
No Shortcut, background wake word or telephone service has been installed here.

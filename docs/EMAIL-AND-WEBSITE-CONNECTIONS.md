# Email and website connections

Open the private Jarvis app and choose **Devices → Email and websites**. Overview
also links to **Email, websites & updates**. ChatGPT's connected accounts are
separate from credentials held by the Railway application.

## Link Lovable project reading

1. Open [Lovable API settings](https://lovable.dev/settings/api-keys) in the
   intended workspace. The verified owner workspace is on Business, which
   supports workspace API keys.
2. Create a dedicated workspace access key using the **Read only** preset. The
   adapter needs `workspaces:read` to list workspaces and their project metadata.
3. Paste the key into Jarvis's private **Connect Lovable** form and verify it.
   Never paste it into chat. If the key can see multiple workspaces, enter the
   intended workspace ID rather than choosing a workspace by a similar name.
4. Jarvis verifies the workspace and reads its projects before saving the
   encrypted key. It shows the selected workspace, last successful verification
   time and project links. Refresh performs another read; ordinary dashboard
   loading uses the last verified snapshot without polling Lovable.

The connection reads project names, IDs, published flags and last edit times.
It uses fixed HTTPS GET requests, never AI building or publishing. Project
publication metadata does not verify a live site's health. A failed refresh
marks the cached list as stale. Disconnect removes the local connection; revoke
the key in Lovable to invalidate it at the provider.

The key is encrypted in the persistent database using the owner authentication
key and AES-GCM. It is never returned by the API or stored in browser storage.
Changing the owner authentication key requires reconnecting saved integrations.
The API does not provide key-permission introspection, so Jarvis verifies the
read operations it uses without claiming that broader provider permissions were
inspected. Use the dedicated Read only preset.

## Register owned websites

Website cards are a separate private registry. They can include the public URL,
a verified Lovable project ID and a GitHub repository reference. **Check public
page** uses a bounded public HTTP read through the existing DNS/IP-safe website
checker. A successful check means the page was reachable; forms, private
customer data and editing access are separate capabilities.

The actual source-verified references for the owner's initial websites are:

| Website | Public URL | Lovable project | Repository |
| --- | --- | --- | --- |
| BoxSafe | https://app.boxsafe.com.au/ | `ae4461b8-4a51-4e01-b085-146df784ae2f` (currently named Fight Hub Community) | https://github.com/bdwulff/boxsafe |
| Mountain Timbers | https://mountaintimbers.com.au/ | `1efaee61-8ef6-43f7-8bea-facbc1af1c08` | Not verified |

The BoxSafe identity was confirmed from its current HTML title/canonical URL.
Do not substitute the similarly named **Boxsafe Reimagined** project: its current
source identifies ANBF. Both public sites returned HTTP 200 during a read-only
check on 26 October 2026. No customer records were read.

Ask **“Which websites are linked?”** to hear the registered site names and the
current Lovable project-reading connection state.

## Connect email

**Studio → Sender settings** offers Gmail or a verified business-domain Resend
sender. Devices shows the actual hosted state and links to the relevant setup
guide. An email address entered as sender identity is not an authenticated mail
connection.

- Gmail uses an owner-initiated OAuth connection after its Google client settings
  are configured. It supports read-only inbox access plus approved sending.
  The private setup wizard accepts the Google Web client JSON file.
- Resend sends from a verified domain the owner controls, independently of its
  mailbox host. It does not create or read that mailbox. Shared provider domains
  such as `outlook.com` cannot be verified as an owner-controlled sender domain.
- Sending to recipients using any email provider is supported once the chosen
  sender is verified. Each prospect email retains its exact-version approval.
- Gmail inbox/header and plain-text message reading is implemented with explicit
  owner requests, no mark-read or label changes and no automatic replies. Native
  Outlook/iCloud mailbox sign-in remains unavailable. See
  [GMAIL-CONNECTION.md](GMAIL-CONNECTION.md) for the intended-account setup.

See [CLIENT-ACQUISITION.md](CLIENT-ACQUISITION.md) and
[BRANDING-AND-UPDATES.md](BRANDING-AND-UPDATES.md) for exact sender setup.

## Full website building and editing

Lovable's MCP endpoint accepts OAuth tokens rather than workspace API keys.
Hosted OAuth clients need an appropriately registered client and callback;
automatic dynamic registration for a local development callback does not
authorise the Jarvis Railway callback. Business supports custom OAuth clients.
The read-only connection above does not implement this separate editing path.
Public website checks likewise do not connect BoxSafe orders, Stripe or private
databases.

Official sources checked 26 October 2026:

- https://docs.lovable.dev/features/api-keys
- https://docs.lovable.dev/integrations/lovable-api
- https://docs.lovable.dev/integrations/lovable-mcp-server
- https://docs.lovable.dev/features/oauth-clients

No account, access key, subscription, domain or OAuth client is created by the
connection screen. Listing metadata and public page checks do not invoke Lovable
AI builds. Live credential verification still requires the owner's dedicated
key; the ChatGPT plugin token is never extracted or transferred.

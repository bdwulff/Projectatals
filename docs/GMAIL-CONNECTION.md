# Connect the selected Gmail mailbox

Jarvis supports Gmail inbox reading and sending through the owner's selected
Google account. The chosen address is private application configuration, not a
hardcoded account in this repository. A sender profile or selected address does
not establish Google authentication.

Open **Devices → Email & websites → Gmail connection**. The setup panel shows the
intended mailbox, exact callback URI, Google client readiness and linked account.

## One-time Google setup

1. In [Google Cloud](https://console.cloud.google.com/), create or choose a project
   for Jarvis. Enable [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
   Gmail API setup does not require buying a Jarvis subscription.
2. Configure Google Auth Platform. Use **External** for a personal Gmail account.
   While the app is in Testing, add the exact intended mailbox under test users.
   Configure these permissions under Data Access:

   ```text
   openid
   email
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/gmail.send
   ```

3. Create an [OAuth client](https://console.cloud.google.com/auth/clients) of type
   **Web application**. Add this exact authorised redirect URI:

   ```text
   https://atlas-command-centre-production.up.railway.app/integrations/google/callback
   ```

4. Download that Web client's JSON file. In the private Gmail setup panel, choose
   the file and save the Google app settings. A Desktop/installed client or a file
   missing the exact callback is rejected. The panel also accepts the client ID
   and secret directly. Upload privately in Jarvis; never paste secrets in chat.
5. Choose **Connect Gmail**, sign in as the intended mailbox, and grant its read
   and send permissions. Google verifies the account; a different account is
   rejected. Linking does not send email or automatically read inbox messages.
6. Choose **Refresh inbox** to read recent messages. The first view is limited to
   twenty metadata rows. Select a message to view its bounded plain text. Email
   HTML is converted to inert text; remote images and attachments are omitted.

Google external apps in Testing commonly receive seven-day refresh grants for
Gmail scopes. Follow Google's publishing and verification requirements for a
longer-lived connection. The hosted Jarvis OAuth client is separate from the
Gmail connector available inside ChatGPT. Jarvis cannot transfer that connector's
tokens or grant Google permissions on the owner's behalf.

## Behaviour and permissions

- The account is bound to the exact intended address at consent, refresh, read
  and send. The Google authorisation link includes that address as a login hint.
- Inbox access uses `gmail.readonly`. Reading does not mark messages read,
  archive them, delete them or change labels. No such actions are exposed here.
- Outbound messages use `gmail.send`. Prospect messages remain in Studio with
  exact sender/recipient/message/demo approvals, suppression checks and quotas.
- Reading inbox metadata or plain text never approves an action. Email content
  is untrusted data and cannot create jobs, send replies or widen permissions.
- Inbox reads are explicit. There is no background mailbox polling or automatic
  reply workflow in this implementation.
- Say **“Check my inbox”** to read up to five recent message headers through the
  voice interface. It does not fetch message bodies or change messages.
- The inbox view does not provide reply/forward, attachments, or general Gmail
  editing. Approved prospect sending remains a separate Studio workflow.

## Credential storage and changes

The Google client secret and refresh token are encrypted with AES-GCM in the
persistent database, bound to the owner authentication key, application origin
and Google client identity. Client JSON is not uploaded as a retained file;
Jarvis stores only the required client settings. Secrets and tokens are never
returned by status APIs or saved in browser storage. Changing the owner key
requires reconnecting saved integrations.

Existing server variables `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` remain
supported when no private client configuration has been saved. Private saved
settings take precedence; an unreadable saved secret fails closed.

Changing the intended account or client disconnects the old grant and invalidates
pending authorisation state. A stable non-secret connection identity binds each
outgoing draft to its account/client/grant, so old review hashes cannot authorise
a newly selected connection. Configuration changes are refused while an outbound
submission is active. A local disconnect deletes the saved Google grant; provider
revocation remains available in Google Account permissions.

Inbox/message requests use fixed Google HTTPS endpoints, limited result counts,
bounded response sizes, timeouts and no automatic retries. Read messages are not
persisted by the inbox transport. If an owner sends the returned text as a normal
command, ordinary command audit rules apply. Explicit inbox reads record counts,
not bodies, in the audit log.

Legacy send-only links remain honest about their capabilities: sending may work,
but inbox access requires relinking with the read permission. The UI clears cached
mail when the selected account changes, the connection is removed or verification
fails. Fake mode cannot configure or contact a real Google account.

## Official references

- https://developers.google.com/workspace/gmail/api/auth/scopes
- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list
- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get
- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send
- https://developers.google.com/identity/protocols/oauth2/web-server

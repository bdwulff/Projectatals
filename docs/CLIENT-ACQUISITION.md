# Jarvis client acquisition

Studio now joins real business discovery, tailored static website concepts,
personalised email drafts and one-time approved sending. Preparation remains
available when email is disconnected. No fixture results replace failed live reads.

## Owner workflow

1. Open Studio or say “Jarvis, find three fencing businesses near Cranbourne”.
   The bounded search saves attributed candidates and prepares private concepts
   and drafts. Search excerpts do not establish business facts or buying intent.
2. Review each source, template and rendered concept. Existing researched leads
   can be added with verified service names. Unknown service details, reviews,
   prices, qualifications and outcomes are never invented.
3. Open Email preview. Confirm the genuine sender, exact recipient, subject,
   text and linked concept. Record the actual contact basis and source context;
   a publicly visible email alone is not permission for marketing.
4. Select **Approve & send this version** after reviewing that exact version.
   It binds the full email, sender/recipient, demo HTML hash, eligibility and
   unsubscribe URL. Changing any of them requires a new review. The first
   operation publishes the approved independent concept and submits one email.
5. **Provider accepted** requires the provider's own ID; it does not mean
   delivered, read or a client acquired. Ambiguous submissions are held for
   manual checking and never retried automatically.

Separate publish-only approval creates a recipient-accessible concept without
sending an email. Concepts are unlisted, labelled unofficial, noindex, inert,
revocable and expire after fourteen days. Owner previews require sign-in and
are sandboxed. They contain no scripts, working enquiry forms or external assets.

The service allows at most five initial emails per Melbourne day. A recipient
and business are reserved before submission, preventing duplicate initial emails
across process restarts. No automatic follow-ups run. A tokenised unsubscribe
confirmation and one-click POST persist global address suppression and stop
unsent messages. The linked mailbox remains the place to read replies; inbox
processing has not been added by this feature.

## Search and scheduled preparation

[Tavily's official keyless API](https://docs.tavily.com/documentation/keyless)
supports free Search for exploration/light use without an account or API key.
The implementation uses that documented header, basic depth and bounded results;
it never falls back to a paid service or retries failed searches automatically.
Provider rate limits can stop discovery. Owner calls are limited to three
requests per minute. Direct lookups keep their source attribution and uncertainty.
Discovery uses one specific locality and sector per request. It rejects
government/education documents, news, directories, comparison portals and major
fitness franchises, and requires locality and sector matches in returned source
text. It may return fewer candidates rather than fill a target with unrelated
pages. These checks improve relevance; they do not establish buying intent.
Rejected pilot matches are archived with their evidence and revoked previews.

Use `ATLAS_RESEARCH_PROVIDER=tavily`, `ATLAS_RESEARCH_ENABLED=true` and an area/count
to enable daily preparation. The persistent once-per-Melbourne-day job prepares
private concepts/drafts only. Count is capped at five. Previously researched
domains are excluded from new Tavily discovery requests where the provider
supports it. The five-minute scheduler checks eligibility; this is not continuous
monitoring. A configured `TAVILY_API_KEY` uses its account allowance; leave it
unset for the initial free keyless path. No key was provisioned or paid plan bought.

## Connect Gmail for sending and inbox reading

The Gmail connector in ChatGPT is separate from the running Railway application.
Jarvis uses Google OAuth with HTTPS, Gmail read-only and send permissions,
OpenID/email identity, PKCE and an expiring one-use state. Its expected mailbox
is private owner configuration. A different verified Google identity is rejected.
Client secrets and refresh credentials are encrypted using the owner key; tokens
are never returned to browser code. Changing that key requires reconnecting.

Open **Devices → Email & websites → Gmail connection**. Save the intended address,
then use its setup wizard:

1. Choose/create a Google Cloud project and [enable Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
2. Configure Google Auth Platform for External/Testing with the intended mailbox
   as a test user. Add OpenID/email, `gmail.readonly` and `gmail.send` scopes.
3. Create a Web application OAuth client with redirect URI
   `https://atlas-command-centre-production.up.railway.app/integrations/google/callback`.
4. Download the Web client's JSON and upload/save it in Jarvis's private setup
   panel. Existing `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` Railway variables
   remain an alternative. Do not paste secrets into chat.
5. Choose **Connect Gmail**, sign in as the exact intended mailbox, and grant
   read/send access. Linking performs no email submission or automatic inbox read.
6. Choose **Refresh inbox** to read headers, then select a message for plain text.
   Approved prospect messages remain in Studio's exact-version send workflow.

No Gmail account is created. The mailbox address is selected by the owner and
stored privately. Google external apps in Testing commonly need reconnecting
seven days after consent; follow Google's publishing/verification requirements
for lasting access. Local disconnect deletes the stored grant, and Google Account
permissions can revoke it at the provider. Existing send-only grants require a
relink to add inbox access. See [GMAIL-CONNECTION.md](GMAIL-CONNECTION.md).

Official references: [Gmail sending](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send),
[Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes),
[OAuth web server flow](https://developers.google.com/identity/protocols/oauth2/web-server),
[token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).
Railway blocks SMTP on Hobby and lower plans; the implementation uses HTTPS
and does not require a Railway Pro upgrade or app password.

Alternatively, an owner-configured Resend HTTPS key and verified sender can be
used. It must permit the domain-read verification as well as sending. No Resend
account, domain or subscription was purchased by this implementation.

## Free creative references

The bundled pages are original Wulff Studio implementations with original SVG
artwork. They use three deliberately distinct visual directions and credit these
commercial-use MIT references. No upstream template code, template demo photos,
logos, testimonials or customer copy is embedded. Business artwork is now sourced
separately from the prospect’s official website as described below.

| Direction | Use | Verified free reference |
| --- | --- | --- |
| Fieldwork | Trades and construction; warm paper/olive architectural typography | [ScrewFast — MIT](https://github.com/mearashadowfax/ScrewFast/blob/main/LICENSE) |
| Momentum | Fitness; oversized typography, warm black and ember | [Start Bootstrap Agency — MIT](https://github.com/StartBootstrap/startbootstrap-agency/blob/master/LICENSE) |
| Folio | Professional/premium services; ivory/navy editorial design | [Landwind — MIT](https://github.com/themesberg/landwind/blob/main/LICENSE) |

Reference licences were checked on26October2026. If upstream code is later copied,
its copyright and licence notices must be retained; third-party imagery/font
rights require separate checking. Captured business artwork carries its own
source/reuse notice; a template licence does not grant rights to that artwork.

## Validation and limits

Domain, transport and HTTP tests cover exact hashes, stale edits, suppression,
quota and midnight boundaries, duplicate/restart behaviour, uncertain submissions,
token expiry/revocation, OAuth state/PKCE/encryption, sender matching and actual
provider IDs. Browser checks use clearly fictional records and intercept all
provider traffic. They verify actual sandbox/CSP rendering and do not establish
a live Gmail/Resend connection. Production connection status remains authoritative.

The preceding acquisition release validation passed250 workspace tests, the production build, workspace
typechecks and157 browser checks at1440/390/320px. The renderer additionally passed
nine isolated layout renders. The free keyless endpoint returned real local
business results during a read-only verification. No email was sent in testing.

The A$300 experimentation ceiling is unchanged. New accounts/subscriptions,
mailbox identity, contact eligibility and exact outgoing messages have not been
approved merely by preparing this workflow. Current hosting usage and provider
bills are not automatically reconciled into the app's recorded budget.

## Business branding and additional sending options

Concept preparation now checks the business's official website for usable logos,
photographs and sourced business/location details, with explicit refresh,
provenance and honest missing-asset fallbacks. Artwork remains subject to reuse
rights; an explicit copying restriction stops artwork downloads. The three
layouts remain original code, with any captured business images embedded in the
exact reviewed concept. Sender settings now explicitly selects Gmail or a
verified business-domain Resend connection. See [Business branding, greetings
and owner updates](BRANDING-AND-UPDATES.md) for setup, automatic device voice,
owner email/Telegram updates and the remaining account requirements.

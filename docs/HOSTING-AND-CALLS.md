# Hosted Atlas and owner calls

This continues the existing `atlas/phase-1-foundation` code. The hosted service is a
single Node process serving the phone/laptop dashboard and background worker, with
SQLite on a mounted volume. It does not require a second paid n8n subscription to
run its current scheduled checks. An inactive n8n integration template remains
available for future orchestration.

## Hosting configuration

`railway.json` builds the core, API and mobile dashboard. Use one replica, a mounted
volume at `/data`, and these server-side variables:

- `RAILPACK_NODE_VERSION=24`
- `ATLAS_BIND_HOST=0.0.0.0`
- `ATLAS_DB_PATH=/data/atlas.sqlite`
- `ATLAS_MODE=live`
- `ATLAS_PUBLIC_ORIGIN=https://<the-generated-service-domain>`
- `ATLAS_OWNER_ACCESS_KEY=<random-secret-at-least-32-characters>`

Keep the owner key in the hosting secret manager. Do not commit it or put it in a
URL. Owner login exchanges it for a 12-hour, HttpOnly, Secure, SameSite Strict
session cookie; restart signs users out. The separate optional briefing read token
must differ from the owner key and only authorises the redacted daily-briefing GET.

Missing owner configuration prevents remote startup. Missing BoxSafe, Stripe,
research or telephone connections remain unavailable; they never become fixtures.
A healthy `/healthz` establishes process liveness, not connected business services.
Verify the unauthenticated API rejects access, login succeeds over HTTPS, then open
the same URL on laptop and phone. Device dictation/speech requires browser support
and user interaction; a sleeping phone browser cannot provide durable phone calls.

Public hosting is still dependent on the owner completing Railway account consent.
No paid plan should be selected automatically. The
[Railway trial](https://docs.railway.com/pricing/free-trial) is time/credit limited;
[ongoing plans](https://docs.railway.com/pricing/plans) include usage charges. Configure
an approved usage limit before moving beyond the trial. A spending ceiling must
stop service rather than silently upgrade it. Back up the database before trial
expiry; no automated remote backup is configured yet.

## Client discovery and lookups

Set `BRAVE_SEARCH_API_KEY` on the server after choosing the provider's plan. Test
`Look up businesses in Berwick`, then `Find five clients around Berwick`.
Search excerpts remain unverified; a candidate is not a customer.

Only after a successful test, set `ATLAS_RESEARCH_ENABLED=true` with the intended
area and count (maximum 10). Each Melbourne calendar day and scope has a persistent
one-attempt research job. Restarts and overlapping checks cannot repeat that job.
No search plan was purchased or provider key created during implementation. The
separately researched first shortlist is in `INITIAL-RESEARCH.md`.

## Owner calls

1. Create a [Twilio account](https://www.twilio.com/try-twilio), complete its required
   identity/phone verification, and inspect Australian voice availability. An account
   and number were not created by this implementation.
2. Review [Australian voice and number pricing](https://www.twilio.com/en-us/voice/pricing/au)
   in the account's billing currency. Number rental, mobile call minutes, taxes and
   optional services can add cost. No number purchase or recurring commitment is
   authorised by an environment variable alone.
3. After owner approval, configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, an owned
   voice-capable `TWILIO_FROM_NUMBER`, and the intended E.164 `ATLAS_OWNER_PHONE` in
   the hosting secret manager. The owner's actual supplied number is intentionally
   absent from this repository.
4. Read-only checks verify the intended active account and originating voice number.
   Then enable `ATLAS_OWNER_CALLS_ENABLED=true`; default `ATLAS_OWNER_CALLS_PER_DAY=1`.
5. From the authenticated dashboard, say or type `Call me`. Verify the actual phone
   rings and inspect the provider record before reporting a successful live test.

Calls are owner-only, bounded to 60 seconds, and durably deduplicated. A timeout or
ambiguous submission does not retry automatically. Queued is not answered/delivered.
Critical notifications may enqueue a guarded owner call; ordinary research results
stay on the dashboard or optional push. Interactive phone conversations, incoming
calls and ElevenLabs are not implemented.

## Optional push

The optional ntfy adapter sends a generic notice, without customer or financial
contents. Configure an approved HTTPS server/host and a random 24–64 character
`NTFY_OWNER_TOPIC`, optional `NTFY_ACCESS_TOKEN`, then subscribe the owner's device.
Publishing is disabled until `ATLAS_OWNER_PUSH_ENABLED=true`. Topic read access and
provider acceptance do not establish phone receipt; test the actual app, especially
on iOS. Public topics are unlisted, not an access-controlled confidential channel.
Do not put business information in the push payload.

## Operational limits

Single replica only; sessions are held in memory. Provider-wide availability,
backups, incident coverage and all BoxSafe registrations/licences/medical workflows
are not established by this release. The router supports specific commands; a
free-form model-backed assistant is not yet wired. The A$300 experiment limit stays
in force; no unknown existing spend is treated as zero remaining commitment.

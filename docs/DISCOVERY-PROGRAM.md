# Wulff Digital discovery program

The Jarvis **Studio → Discovery program** prepares a private business shortlist,
original website demos and draft introductions for the owner to review and send.
It builds from reusable code without calling Lovable generation, a language model
or ElevenLabs. The owner's company identity defaults to **Wulff Digital** and
`https://wulffdigital.com`. This records the supplied business identity; it does
not register the domain, configure DNS, connect a mailbox or publish the company
website.

## Run it in Jarvis

1. Open [Jarvis Studio](https://atlas-command-centre-production.up.railway.app/#pipeline)
   with the private owner sign-in.
2. In **Discovery program**, review the company name and website, search area,
   optional industry and daily shortlist size. The default is three candidates
   around Officer, Berwick, Pakenham, Cranbourne and Dandenong in Victoria.
3. Save the settings. Use **Run now** for today's private preparation or enable
   the daily schedule. The server can run while the dashboard is closed; it does
   not need a browser tab or Claude Code to stay open.
4. Review the report and select a business in Studio. Preview its concept, inspect
   the recorded sources and missing details, and download its code if useful.
5. Open the email draft, edit it, then use **Copy email** or download the unsent
   `.eml` file to work in the owner's preferred email application. These controls
   do not connect or send through a mailbox.

The program starts unconfigured and paused in a new installation. Saving a
schedule is explicit owner configuration, not proof that a search has succeeded.
The hosted installation's actual enabled state and last run are shown in Jarvis.

Supported text or voice commands include:

```text
Run the discovery program now
Pause the discovery program
Resume the discovery program
What did you do?
Read the discovery report
```

These commands are deterministic. Quoted or negated run instructions do not start
the program. A report request reads existing results and does not initiate another
search.

## Daily execution and truthful reports

Settings, jobs and reports persist in the existing SQLite volume. The program
reserves one global job key per **Australia/Melbourne calendar day**, across
manual requests, schedule ticks and scope edits. Changing the area or shortlist
size does not buy another search for that day. Counts are bounded to one through
five candidates, with three as the default. The existing worker checks eligibility
periodically; this is not a promise of an exact morning start time.

Once configured, the program replaces the legacy automatic research path. It
does not run a second daily research schedule. If today's legacy research already
completed, it can rebuild eligible cached candidates as Clarity demos without
another lookup; the report identifies them as reused, with zero new search results.
Queued, failed or interrupted legacy research blocks a duplicate uncertain search.

The durable handler rechecks the day, settings revision, schedule state and
keyless provider policy before work. A queued run is skipped if those conditions
change. Pausing prevents future scheduled work; a website request already in
progress may finish. An interrupted or failed search is not retried automatically
that day. Private preparation processes its own job key, so it cannot drain
unrelated queued emails.

Reports distinguish newly found and reused candidates, prepared demos and drafts,
captured logos/photos, missing recipients, errors and skipped work. Search results
are candidates, not customers, verified sales prospects or permission to contact.
Partial progress remains visible. Live mode never fills a failed search with
fictional businesses. Fake mode is labelled and never searches automatically.

## Original design and editable code

**Clarity** is an original implementation inspired by Apple's generous spacing,
quiet system typography and product presentation. It uses the prospect's own
identity and available imagery. No Apple code, proprietary font files, logos or
photographs are copied, and no Apple affiliation is implied. Free-template
references remain separately attributed; they do not license Apple's assets.

The matching **Download code** action returns a private ZIP containing eight files:

```text
package.json
index.html
vite.config.ts
tsconfig.json
src/main.tsx
src/App.tsx
src/index.css
README.md
```

This is editable React, TypeScript and Vite source with real components and
embedded business images. It is not an iframe wrapper. The source is generated
from the same validated business input used for the selected concept and is
stored with that version. Legacy Fieldwork, Momentum and Folio concepts must be
rebuilt as Clarity before a matching React download is available. Downloading does
not publish a concept, contact the business or include Jarvis credentials,
publication tokens or unsubscribe links.

The code can be developed independently of Lovable. It is original Jarvis output,
not copied Lovable project code or a Lovable-generated build. Lovable's current
documentation distinguishes newer TanStack Start projects from older React/Vite
projects. Familiar React source does not guarantee ZIP import into a hosted
Lovable project or full-stack compatibility. For an existing Lovable project,
its supported GitHub workflow can be used to edit and deploy code outside the
Lovable generator.

## Business facts, branding and contact candidates

The existing bounded enrichment reads the recorded official HTTPS website and
looks for public descriptions, service names, location, telephone, raster logos,
photographs and a published contact email candidate. It records source URLs and
image hashes. Downloaded PNG, JPEG and WebP images are embedded in the private
preview; viewing it does not load third-party image trackers.

Business website text is untrusted data. It cannot execute scripts, change
permissions, approve outreach or become a program instruction. Network reads use
public DNS/IP checks, pinned connections, redirect checks, timeouts and response
limits. Explicit source copying restrictions prevent artwork import. Missing,
restricted or unsuitable assets stay identified as missing, with original
illustration instead of invented business photography. Public availability does
not establish artwork reuse rights or independent verification of business facts.

A public email address is only a recipient candidate. It is recorded with
**no contact basis established**, without an owner consent determination. A
missing address remains visibly missing; no address is guessed from the domain.

## Drafts, publication and email

The program creates private concepts and drafts only. It never publishes them,
sends outreach, approves quotes or calls the owner. The `.eml` download has an
`X-Unsent: 1` header and no send operation. The owner must still review the actual
recipient, contact basis, facts and message in their email application.

**A private concept link is unavailable to the recipient until the owner reviews
and explicitly publishes that exact concept in Studio.** Check the concept's
publication state before sending a copied or downloaded email. Downloading code
is another private review option; it does not activate the hosted concept link.

Existing in-Jarvis sending remains separate. It requires the verified sending
account, reviewed contact eligibility and exact-version approval. Changing the
company identity rebinds draft versions and their approval hashes while preserving
owner-edited wording. The company website does not create a domain mailbox.
Gmail still requires the owner's Google Web OAuth client and consent unless the
live connection screen reports that verification has actually completed. See
[GMAIL-CONNECTION.md](GMAIL-CONNECTION.md).

## Spoken reports without voice credits

**Read report aloud** and the global spoken-update control use installed device
voices only. They make no ElevenLabs, transcription or language-model request.
If no installed voice is available, Jarvis asks for device setup instead of using
an online or paid fallback. Microphone/audio activity takes priority, and hidden
pages or sign-out stop the report's playback.

Automatic spoken updates require the owner to enable/unlock playback with a tap
and keep Jarvis in the foreground. The browser may require another tap after a
new sign-in or visit. Completed report IDs are remembered to avoid repeating the
same report on that device. The transcript remains in Studio when playback is
unavailable. A closed or backgrounded web app does not speak, wake an iPhone or
place a telephone call; the server can still finish the preparation and save its
report for the next visit.

## Costs and limits

- Local rendering, draft composition and installed-device report speech use no
  Lovable generation credits, ElevenLabs credits or model tokens.
- New searches use **keyless Tavily** only, subject to provider rate limits and
  availability. A configured paid Tavily or Brave key blocks this program's new
  lookup rather than silently consuming it. There is no paid fallback or automatic
  retry. Existing general lookup tools retain their own separately configured
  provider rules.
- Existing Railway hosting and storage charges still apply. This feature does
  not add a subscription, change DNS or spend on business outreach. Total account
  spend and the remaining A$300 experimentation budget are not inferred from
  zero generation-credit usage.

## Validation and release status

Railway deployment `2fcae55f-49e1-45af-a533-34beee3ad1e8` reached **SUCCESS** on
27 October 2026. The production build and all **454 workspace tests** passed:
185 core, 227 API, seven MCP, 24 local-agent and eleven UI unit tests. All
**165 browser checks** passed: 74 program UI, 45 report-voice and 46 Clarity checks.
A generated eight-file React project also passed a real TypeScript check and
Vite production build using existing dependencies.

All **51 hosted checks** passed, including private authentication and logout,
exact deployed JavaScript/CSS hashes, persisted daily settings, report deduplication,
and all three matching ZIP downloads with CRC and secret/token exclusion checks.
The hosted program is enabled for three daily candidates around south-east
Melbourne under the supplied Wulff Digital company identity. Its first verified
report reused three previously researched businesses without another search and
prepared three private Clarity demos and email drafts, with two sourced logos and
seven photographs. Those are reused records, not three newly discovered businesses.
Public concept URLs remained unavailable, no email was accepted or sent, and no
paid voice request was made. A second run retained the same report ID and
completion timestamp. Gmail remains disconnected pending the owner's Google setup.

A subsequent read-only refresh of the same three business websites found published
contact-email candidates for two, with source provenance and **no contact basis
established**. It made no additional discovery search and retained the two-logo,
seven-photo totals. The remaining business still lacks a suitable logo and a
sourced recipient. All three drafts remain blocked for sending and all concepts
unpublished; these contact candidates are not reviewed send permission or consent.

Browser tests use mock speech and do not prove playback on the owner's physical
devices. Choose **Enable spoken updates** while Jarvis is in the foreground to
unlock an installed voice. The private hosted verification report remains outside
the repository; it is not a source artefact or a public business-results feed.

The current deployment evidence belongs in [DEPLOYMENT.md](DEPLOYMENT.md).

Official source references:

- [Lovable GitHub sync and external code workflow](https://docs.lovable.dev/integrations/github)
- [Lovable hosting and code portability](https://docs.lovable.dev/tips-tricks/self-hosting)
- [Apple visual reference](https://www.apple.com/)

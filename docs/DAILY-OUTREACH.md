# Daily client research, manual email drafts and separate pricing

## Website and outreach upgrade on 30 October 2026

The new **Manual outreach** queue in Studio prepares a specific initial email and two useful follow-ups for each researched prospect. It is served by the authenticated `/api/manual-outreach` endpoint. The existing daily research program remains the single research scheduler; a second scheduled service has not been added.

Each row shows its dated observation, practical business opportunity, source link, relevant public proof or personalised preview, and any review flags. A personalised preview is included only when a shareable URL is recorded and not expired. New private concepts use Wulff Digital’s public portfolio as proof until their own publication is reviewed. Sign-in-only preview links are never inserted into these manual messages.

On iPhone, review the recipient, source and message, choose **Mark reviewed**, then **Open in email app**. The mailto link carries the recipient, subject, complete text and preview link into the device’s configured email application. The mailbox used to send remains a choice in that application. Copy and `.eml` download remain available as fallbacks. Opening or copying a draft never records it sent.

After sending in the mail application, use **I sent this** to record the manual action. The first follow-up becomes due three days after that recorded send; the second becomes due four days after the first follow-up’s recorded send. Each follow-up needs its own review. **Replied**, **Closed**, **Hold** and **Do not contact** stop the sequence. Only a temporary hold can be resumed. A do-not-contact action also records the existing global recipient suppression so future research does not rediscover it as a new contact.

Review and sent-note updates require both the current row revision and the exact displayed draft hash. Changed text cannot silently inherit an earlier review. Prior manual sent/replied/do-not-contact records and suppression are retained when matching old and new research. A prior contact with a missing sent date is held instead of being offered as a fresh initial email.

The optional owner-provided research import is read from `ATLAS_OUTREACH_SEED_PATH`, or the deployment-only `private-outreach/seed.json` by default. It is bounded, validated and retained in SQLite. It must stay outside the public repository and static website assets. Importing revised evidence invalidates unsent reviews while preserving owner-reported sends and their exact sent text. Imported prospects are identified as reviewed imports; they are not described as autonomous discoveries.

The daily target is twenty genuinely new prospects, not a guaranteed output. Backlogs remain available but do not count again as newly found on later days. Previously reviewed import names and contacts are excluded from fresh discovery. Failed lookups, missing evidence, source checks older than thirty days, expired previews and held contacts produce an explicit shortfall. No emails are sent automatically.

The research planner now keeps council searches within that council’s supported suburbs and restricts Fresha searches to salon and training categories. A named individual council profile can establish identity through its exact matching title and URL slug when the contact excerpt does not repeat the business name. Generic directory indexes, mismatched slugs, shared supplier pages, ambiguous recipients and unrelated services remain excluded. The independent-website search still runs before qualification. Future reports retain exclusion counts so a shortfall can be diagnosed; existing completed reports and their search allowances are not reset.

Scheduling remains configured through the existing authenticated **POST** `/api/discovery-program/settings` route, using its full current settings and `enabled: true`, `target: "no_website"`, `count: 20`, `timeZone: "Australia/Melbourne"`. The worker begins after 7 am Melbourne time. Activation and future runs must be checked on the hosted service; passing local tests alone does not prove a live scheduled run.

> **Deployed and activated — 28 October 2026.** Railway deployment
> `dc896841-d318-435f-8e18-2d546102fa33` reached **SUCCESS**. The dated live report
> contains **20 of 20 new Simple demos and sourced introductory drafts** for
> manual review. Its owner notification persisted, and the updated master
> workbook contains 47 saved pricing/prospect rows. Research is enabled for
> 7 am Melbourne-time worker checks; the separate flexible 9 am ChatGPT reminder
> is confirmed enabled from **29 October 2026**. No client message was sent or
> concept published. Hosted UI verification passed **298/298** checks at 1440px
> and 390px. Verification details and remaining limits are below.

Open **Studio → Your daily outreach list** to review the day's prospects, private
Simple website demos and introductory drafts. The target is **20 new businesses
per Melbourne day**, across Melbourne and its south-east suburbs, with no own
website found in the recorded checks and a published business email. Twenty is a
target: provider limits, weak evidence or unsuitable candidates can leave a
reported shortfall rather than a padded list.

## Daily timing and research limits

The enabled hosted worker starts on its first check **after 7 am
Australia/Melbourne**, including daylight-saving changes. It runs on the server
between conversations; the owner does not need to leave a laptop open for research.
One dated report continues across worker checks and restarts. Saving settings or
pressing Run again does not create another daily allowance.

The separate **9 am Melbourne-time ChatGPT reminder** is a flexible review
reminder, not the research engine or a guarantee that 20 records will be ready by
then. Its enabled daily schedule was confirmed, beginning on **29 October 2026**.
This verifies configuration, not a future reminder delivery. Actual research
progress and spreadsheet contents come from Jarvis; reminder delivery depends on
the relevant ChatGPT notification settings. Open the private app to see the latest
ready count, shortfall and sources.

This program uses **keyless Tavily only**, bounded to **40 lookup requests per
Melbourne day and two per minute**. The count includes candidate discovery and
website checks. Lookup reservations, cursor, qualified records and the daily
budget persist. An interrupted lookup with an unknown outcome is not blindly
repeated. A provider failure or exhausted budget retains completed work and
reports the shortfall. Configured paid search keys do not become a fallback for
this program; incompatible provider configuration blocks new research explicitly.

The worker excludes previously claimed names and email addresses, existing
customers, archived/suppressed/disqualified records, unsafe mail states and
manually contacted or closed records. Input changes do not silently overwrite an
older reviewed report. Daily research performs private preparation and records an
owner report; it does not automatically email prospects or publish their demos.

## What a researched contact means

**No independent website found** is the result of bounded name, locality and
contact searches. It does not prove that no website exists. Facebook, Instagram,
Maps, directory listings and functioning third-party booking or marketplace
pages remain recorded online presence. A business with working bookings is not
presented as having broken bookings.

A **verified published email** means the actual address appears in the cited
business source; Jarvis does not invent or guess it. This does not establish
inbox deliverability, current trading status, permission for marketing or customer
interest. The owner reviews the source, recipient, contact basis and draft before
sending. Missing facts stay missing; addresses, services and business claims are
not invented to complete a demo.

The initial private research pack contains **20 unique published-email contacts:
19 from Melbourne's west/Wyndham and one from Cranbourne West**. Two west-side
records have incomplete street/suburb detail, explicitly marked in their evidence.
The previous six photographic-demo prospects are excluded from this fresh pack.
Conditional leads and businesses with identified own websites are separate and
are not counted. The reviewed pack was imported and explicitly seeded into the
28 October report, which completed with 20 new Simple demos and 20 sourced email
drafts. This was a reviewed research import, not evidence that the autonomous
search worker independently discovered 20 contacts in that run. Names, email addresses,
phone numbers and addresses stay in the private app and research files, outside
this public document.

## Simple demos and a usable first email

**Simple** is a concise photo-led page built from original code around the
business name, recorded services, location, photographs and contact facts. It
retains the embedded licensed illustrative photography and explicit concept-logo
labelling described in [PHOTO-SHOWCASE.md](PHOTO-SHOWCASE.md). Genuine business
media remains separately sourced. The protected preview and matching editable
React/Vite source share the same composition; previews collect no enquiries,
bookings or payments.

The generated first introduction asks whether the business would like to see the
private concept. It does **not** insert an unpublished public demo URL that would
return 404, or expose the owner's authenticated preview link. After a separate
publication review, an actual shareable link can be included in a revised draft.
An initial message does not need a public demo link to make sense.

The signature uses the owner's privately configured sender identity, company
information and phone number. No owner phone number or credential belongs in this
repository. **Internal suggested prices are not inserted into the generated
introductory email.** Owner-edited message text remains subject to its existing
revision and approval rules. Hosted checks confirmed the privately configured
owner phone appears in all 20 new introductions, with no inserted internal prices
or unpublished demo links. Nineteen prior editable drafts retained their content
apart from the authorised sender-identity/signature update.

1. Open the latest daily list and review each business's evidence and demo.
2. Expand **Review & copy email draft**, check the recipient and subject, then
   copy it or download the `.eml` file.
3. Open the draft in the owner's chosen mail app, review it there and send it
   manually when appropriate. A Gmail connection is not needed to copy or export.
4. Save the manual status and any internal notes in Jarvis after the action.

This workspace has no send transport. Copying/downloading a draft, editing a price
or recording **Sent manually** does not send a message. A manual sent note is an
owner report, not a provider delivery receipt. Existing automated-send interfaces
elsewhere in Jarvis keep their separate connection, eligibility and exact-version
approval requirements.

## Updated spreadsheet and editable internal estimates

**Download spreadsheet** generates a new authenticated XLSX snapshot of the saved
records. Its default worksheets are **Pricing** and **Prospects**. The optional
**Email drafts** worksheet is added with `includeDrafts=1`; it is separate from
internal price columns. CSV provides a flattened pricing/prospect export. Exports
can cover all saved records or a selected Melbourne date.

| Download | Private route |
| --- | --- |
| Updated Pricing + Prospects workbook | `/api/prospect-pricing/export.xlsx` |
| Workbook with optional Email drafts worksheet | `/api/prospect-pricing/export.xlsx?includeDrafts=1` |
| Flattened pricing/prospect CSV | `/api/prospect-pricing/export.csv` |
| Single-day example | `/api/prospect-pricing/export.xlsx?day=2026-10-28` |

The **Prospects** sheet contains sourced contact details, website evidence status,
recorded services and private demo/source/review links. **Pricing** contains the
suggested amount, scope, basis, manual outreach status, notes, update time and row
revision. Downloads require owner sign-in and are not public sales material.
Spreadsheet formula-leading text is escaped as data. Provider credentials and
private publication tokens are not spreadsheet fields.

Default starting estimates are in **AUD**, based on the number of distinct
recorded services:

| Recorded services | Starting estimate | Proposed scope |
| --- | --- | --- |
| Zero to four | A$699 | One responsive page; missing service details still need confirmation |
| Five to eight | A$999 | Up to three responsive pages |
| Nine or more | A$1,499 | Up to five responsive pages |

An existing internal recommended price takes precedence over this heuristic.
Owner-edited price and scope override automatic recommendations and survive later
syncs. These are internal starting estimates, not approved customer quotes or
verified market valuations. Final content, page count and functionality need
review. Booking systems, e-commerce and custom integrations are not assumed.
**GST is unconfirmed. Hosting, domain registration, paid third-party services and
ongoing maintenance are excluded unless separately agreed.**

Edit amounts, proposed scope and notes under **Internal pricing & manual email
tracking**, then save. Updates are revision-checked; a stale edit requires a
refresh rather than overwriting a newer row. A later download includes saved
changes. Editing a downloaded Excel/CSV file does not automatically write back to
Jarvis or change an email draft.

For this handoff, an owner-only **20-row workbook** contains just the new daily
list on **Pricing** and **Prospects**, without an Email drafts sheet. A separate
ZIP contains **20 `.eml` files** generated from the verified saved drafts. These
private download snapshots stay outside Git. The live Jarvis export remains the
updated master and can include historical work.

The verified master workbook opens with openpyxl and contains **47 saved rows**
across new and historical prospects. Today's 20 new internal recommendations are
13 at A$699 and seven at A$999; these remain estimates, not customer-facing quotes.
Re-running today's program created no extra records or provider searches. Existing
customer quotes were not changed.

Manual statuses are **Not sent**, **Sent manually**, **Replied**, **Follow up**,
**Closed** and **Do not contact**. They record the owner's decisions. Saving a
status never schedules an automatic follow-up or sends an email.

## Notifications, speech and costs

A completed or partial report creates a deduplicated in-Jarvis owner notification
with the ready count, private review path and separate spreadsheet path. External
email, SMS or telephone delivery requires its own connection and is not inferred
from a saved dashboard alert. Installed device speech can read report updates
with **Enable spoken updates** and Jarvis in the foreground; physical playback
on the owner's devices remains a separate check.

Simple generation, introductory drafting and device speech use no model, Lovable
or paid voice credits. Keyless search remains subject to provider limits, and
existing hosting charges continue. No new paid provider or subscription is
required for this flow. The A$300 experimentation ceiling remains; an unreconciled
remaining balance is not asserted.

## Current revision evidence

| Evidence | Verified result |
| --- | --- |
| Workspace and final component tests | **596 current tests passed:** 244 core, 303 API, seven MCP, 24 local-agent and 18 UI |
| Full-run sequence | 594 workspace tests passed, followed by two added API source guards; the final 303-test API suite passed |
| Complete production build and final API build | **Passed** |
| Simple rendering, controls and matching source exports | **330/330 passed**, including six editable React exports that matched and built |
| Local UI at 1440px, 390px and 320px | **79/79 passed** |
| Hosted UI at 1440px and 390px | **298/298 passed**, including all 20 live previews |
| Independent XLSX checks and backend pricing tests | **10/10 workbook checks and 16 pricing tests passed** |
| Hosted imported report | **20/20 ready:** 20 new demos and 20 sourced introductory drafts |
| Hosted photographic payloads | **80 decoded photos counted per demo:** four different image hashes in each; stock can repeat between businesses |
| Live source ZIPs | **All 20 passed CRC**, with owner phone excluded from source |
| New introductory drafts | Private sender phone present in all 20; no internal prices or unpublished demo links |
| Historical draft preservation | **19 editable drafts preserved**, apart from authorised sender-identity/signature changes |
| Master workbook | **47 rows**, opened independently with openpyxl |
| Separate daily handoff files | Owner-only 20-row Pricing + Prospects workbook and ZIP of 20 saved `.eml` drafts |
| Repeat run | No additional records or provider searches |
| Ready-list notification | Persisted **Daily client list: 20 of 20 ready** with private review/spreadsheet paths |
| Daily settings | Enabled; target 20, Simple, no-own-website checks, Melbourne and south-east scope; first worker tick after 7 am |
| Separate 9 am ChatGPT reminder | Enabled flexible daily schedule from 29 October 2026; future delivery not yet observed |
| Physical voice playback on the owner's devices | **Not verified** |

The API, core, MCP, local-agent and UI counts identify the current component
results; the full workspace run preceded the final two API guards. Tests used
clearly identified fictional fixtures where appropriate. The hosted 20-record
report used the real, source-backed private research import. Hosted browser
checks loaded all four photos in every one of the 20 previews, observed no runtime
errors or external calls, and revoked the verification session afterwards.

Private activation evidence is stored outside the repository at
`/workspace/scratch/daily-outreach-live-report.json`; private browser evidence is
`/workspace/scratch/showcase-ui/live-outreach-report.json`. They must not be
committed with prospect identities, owner contact details or sessions.

A reviewed seed import does not establish that autonomous search will find 20
every day. A configured 7 am start and 9 am reminder do not prove a future scheduled
run or reminder has completed. No client email, public concept publication,
customer-quote change, model generation or paid voice call occurred during
activation. Existing hosting charges continue.

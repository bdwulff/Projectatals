# Business-specific immersive demos and owner review

Status: 28 October 2026. Railway deployment
`c2e6861a-691b-4bc5-a9eb-6e1737b69f34` reached **SUCCESS**. The production build,
508 workspace tests, 536 browser/export checks and 115 hosted checks passed.
Six qualified research prospects were imported and all six eligible businesses
received private immersive demos and matching source ZIPs. Full evidence is in
[DEPLOYMENT.md](DEPLOYMENT.md).

## Owner workflow

Open **Studio** and the immersive rebuild review panel. It lists existing
potential clients whose records show no own website or only social, booking and
directory links. Start the batch to prepare private demos for all eligible
records. Progress and per-business outcomes remain available while it runs.

Ready entries link to a protected preview, matching editable source ZIP and
business record. Evidence and uncertainty stay alongside the design. Completion
creates an owner notification containing the ready names and private review-list
path. Preparation does not establish a customer, commission or contact permission.

Batch paths use `/#pipeline?batch=<reportId>`. A business can be opened with
`/#pipeline?review=<leadId>&batch=<reportId>`. Owner sign-in is required for
reports, previews and source downloads.

## Research correction and website classification

The pre-release inventory audit found 24 acquisition records and 33 prospect
records. Most genuine businesses already had an own website. Other search results
were directories, job advertisements or unrelated publications; these must not be
presented as named local clients without websites. The separate connected studio
snapshot also contained existing websites.

An empty field is not proof that a website does not exist. Classification checks
the prospect URL, acquisition URL and evidence together. Own-site evidence takes
precedence over a blank field; ambiguous or invalid URLs are excluded. Eligible
wording is **No own website recorded** or **Only social/directory links recorded**,
with its source and uncertainty. Category pages and job-board titles are excluded.

Bounded new research produced six qualified replacement prospects from
business-specific public records and exact-name/locality searches. They were
imported privately into Jarvis and all six eligible records were rebuilt. Their
private details stay outside this public repository. Three old category, jobs or
recruitment entries were archived with audit records retained. This is new
research, not a claim that the old genuine prospects lacked websites.
Social and booking pages may already serve a business effectively; a working
booking journey is not labelled broken.

## Original immersive design engine

The `immersive` direction uses an industry-led family and a stable business
identity seed. Recorded name, industry and location influence its design brief,
palette, typography, hero composition, section ordering and signature details.
Actual services and available artwork shape the content. The same input produces
a stable direction suitable for repeatable review.

| Family | Direction |
| --- | --- |
| Automotive | Sculpted light, dark surfaces, precision and depth |
| Craft | Tactile material, architectural composition and editorial spacing |
| Movement | Expressive scale, energetic rhythm and motion |
| Editorial | Generous typography and a quieter, refined composition |

Sector motifs add botanical forms for gardens, mirror-and-flow artwork for salons
and table-and-vessel compositions for hospitality. These are original designs;
no Apple or third-party template code is copied.

Validated business logos and photographs remain embedded raster assets with
provenance. When unavailable, the engine uses original procedural SVG illustration
and an explicitly conceptual wordmark treatment. These are labelled as concept
artwork, never represented as a verified logo, premises photograph or example of
the business's work. Unverified addresses, hours, prices, reviews and service
claims are not invented.

The verified live batch imported one linked public business photograph. Two
unlinked photographs were refused with HTTP409, leaving that concept's labelled
original artwork in place. No invented business logo or photograph was used.

Navigation anchors and native `details`/`summary` controls work with keyboard and
touch. CSS motion respects reduced-motion preferences. Protected previews keep
scripts disabled and do not submit enquiries, bookings or payments. Source
content stays escaped data, not executable HTML or instructions. No remote fonts,
trackers or generated-image services load.

## Matching editable code

Protected HTML and React components are serialised from the same authored
composition. `designBrief` records the chosen family and direction. The source
ZIP contains an editable React/Vite project with matching CSS, components,
embedded artwork and source notes, rather than an iframe or HTML-injection shell.

Downloads contain public design input, not owner credentials, mailbox tokens,
private publication or unsubscribe tokens, or internal job state. Clarity exports
remain supported; older directions without a matching export require rebuilding
in a supported direction first. ZIP paths and download size are bounded.

This is original code built inside Jarvis without Lovable generation, model or
paid speech calls. React/Vite source is portable; it is not a claim of Lovable
generation or guaranteed ZIP import compatibility with every current Lovable
project. Existing hosting charges and research limits remain.

## Durable batch preparation and exclusions

`GET /api/site-rebuilds` returns candidate evidence, progress and reports.
`POST /api/site-rebuilds/run` accepts an empty JSON object to request private
preparation. Owner-session, same-origin and action-policy gates apply.

Unlike the daily program's three-candidate default, the batch targets all eligible
existing prospects. A safety cap of 500 targets and bounded inventory scan prevent
silently processing an incomplete larger inventory. Daily discovery retains its
separate Melbourne-day limit; the rebuild batch performs no discovery search.

The batch fingerprints its exact target set, source inputs, company identity and
renderer policy. Identical requests reuse the report. Preparation keys bind each
business to its requested input and private demo. After restart, completed rows
remain completed and untouched work can resume. Targeted queue execution leaves
unrelated queued emails alone.

Existing customers, suppressed or disqualified prospects, archived records,
live-mode fictional records and unsafe email states are excluded. A record
changed after the request is skipped with a reason rather than overwritten.
Individual failures remain visible.

Rebuilding preserves an owner-edited email subject and body while updating the
concept link and exact-version hash. Old approvals cannot authorise the changed
version. Preparation does not publish, send a client email or establish contact
eligibility. Sharing a public concept link still requires its separate
exact-version publication decision.

## Owner notification and free speech

Completion creates one deduplicated Jarvis notification with the ready
potential-client list and private review path. Counts distinguish ready, skipped
and failed work; an empty list does not claim confirmed website absence. Existing
enabled external channels may report their own outcomes, but the latest
hosted release check showed owner email and Telegram unconnected and disabled.
The notification is therefore an in-Jarvis alert, not evidence that an SMS,
telephone call or external message was delivered.

The live batch's stored notification was read back successfully: its title
reports six potential-client demos ready, and its body contains all six names
and the private review-list link. That verifies a dashboard notification only.

Spoken updates choose the newest finished daily or rebuild report. They use an
installed device voice, share actual-speech-start deduplication with manual report
reading and wait for the microphone or other audio. The owner enables speech with
a browser gesture and keeps Jarvis in the foreground. Hiding the app or signing
out stops its owned announcement. No ElevenLabs generation or transcription is
triggered. Physical playback on the owner's devices still needs verification.

## Validation and release evidence

Validation passed: 508 workspace tests (206 core, 260 API, seven MCP, 24
local-agent and eleven UI), the production build, and 536 browser/export checks
(426 renderer/export and 110 review UI). Four generated React projects passed
production builds and matched their protected previews.

All 115 hosted checks passed after importing the six research records. The batch
created six unique design IDs across four families; every matching eight-file ZIP
passed CRC and credential/private-publication-token exclusion checks. Previews
kept scripts disabled and sourced service facts intact. Authentication, logout,
repeated-request idempotency and the owner notification's exact list/review path
were verified. No client email, public concept publication, Lovable generation,
model call or paid voice request occurred. The enabled daily program now uses
`immersive`, preserving its three-candidate count and existing search scope.

Live evidence is recorded in [DEPLOYMENT.md](DEPLOYMENT.md); the private report
at `/workspace/scratch/immersive-live-verification.json` remains outside this
repository. Fictional browser fixtures are not live prospect results, a stored
notification is not confirmed external delivery, and physical playback on the
owner's device remains unverified.

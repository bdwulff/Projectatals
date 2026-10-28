# Photo showcase: original business demos with embedded photography

> **Deployed and verified — 28 October 2026.** Railway deployment
> `c31f974a-5133-48e7-a7c2-ae5fe4865dc6` reached **SUCCESS**. All 537 workspace
> tests, the production build, 330 renderer/export checks, 51 local review-UI
> browser checks, 128 hosted UI checks and 227 hosted HTTP/data checks passed.
> Six qualified local prospects received new
> private photographic demos with 24 embedded illustrative photographs and six
> labelled concept logos. Owner-edited drafts were preserved. The persisted
> Jarvis notification contains the full private review list. See
> [DEPLOYMENT.md](DEPLOYMENT.md) for release evidence and limits.

The replacement design system uses real raster placeholder photographs throughout
sector-specific hero, story, service and gallery compositions. It addresses the
previous release's reliance on abstract illustration when business imagery was
missing. The old immersive release is historical evidence in
[IMMERSIVE-DEVELOPMENT.md](IMMERSIVE-DEVELOPMENT.md); its SVG fallback description
is not the design policy of this revision.

## Visible design changes

The existing `immersive` selection now chooses among seven photographic sectors:
six business-specific compositions and a neutral professional-services fallback. Business name, recorded
industry, location, verified services and available genuine assets contribute to
the content and stable design signature. Palette, type scale, image placement,
section order and spacing vary by sector. This is deterministic original code;
it is not a claim that each site was designed by a live model. Unsupported trades
use the neutral professional fallback rather than inheriting garden photography
or gardening copy.

| Sector | Photo-led composition |
| --- | --- |
| Automotive | Full-width vehicle photograph, dark cinematic treatment, large sans-serif headline and photographic service cards |
| Gardening and landscaping | Large landscape hero, cream/green surfaces, overlapping garden photographs and project-style gallery |
| Hair and beauty | Cream editorial layout, large fashion/salon photograph, two supporting crops and a structured service menu |
| Fitness | Full-width training photograph, oversized athletic type, bright accent and image-led service/story sections |
| Cafe | Warm coffee photograph, large serif type, coffee-house colour palette and image/menu split |
| Restaurant | Large food photograph, serif editorial headline, warm dark surfaces and photographic offering/gallery sections |
| Professional fallback | Quiet service-led editorial composition, large workspace photographs and clear service hierarchy |

Every generated photo-showcase demo must contain **at least four distinct real
raster photographs**, including when no genuine business photograph can be
captured. Four different embedded stock-image hashes are required; missing or
duplicate stock records fail preparation instead of producing an empty design.
Small original vector marks may serve as labelled concept branding. They do not
substitute for the photograph requirement.

## Image pack, identity and provenance

The bundled pack contains **28 JPEG photographs: four for each of seven sectors**
(2,163,433 bytes of JPEG data, stored in 115 source segments).
Each record includes its original Unsplash photo-page URL, photographer,
[Unsplash licence](https://unsplash.com/license), dimensions and SHA-256 hash.
They are stored in `packages/core/src/acquisition/stock-photos.ts` with embedded
payloads in `stock-photo-parts/`. The preview and source export use data URLs, so
there are **zero external runtime image fetches** and no hotlinked placeholder
service. Dependency installation for an exported React project still needs the
package registry; clicking a source link opens that external page explicitly.

Illustrative stock and genuine business photographs are different asset classes.
The stock photos are labelled **Illustrative photograph** and described as
placeholders, not the business's premises, staff, food or completed work. Where a
validated, source-linked business photograph exists, it is retained separately
and marked **Recorded business photograph**. Source capture does not establish
permission, ownership or endorsement; those still need review before launch.
The **About this independent concept & sources** disclosure preserves photographer,
licence, business-asset and design-reference links.

A sourced business logo remains a business logo. When none is available, the
original proposed symbol and wordmark are explicitly labelled **Concept logo**.
The Studio review list reports business-photo and illustrative-photo counts
separately and identifies concept branding. It does not report placeholders as
captured business media. Prices, opening hours, awards, reviews, staff identities
and contact details are not invented to fill a template.

## Free template research and actual reuse terms

Fifteen publisher/repository references were checked on **28 October 2026**.
Research used official template pages, their previews and source/licence pages;
selected publisher screenshots were also inspected. The table records composition
references, not downloaded source bundled into Jarvis.

**A free preview or free remix button is not an unrestricted source licence.**
Framer's free-content licence, Tooplate's website-use terms and the attribution
licences below allow specific uses with different restrictions. Image rights are
separate from template-code rights. The new sites remix broad composition ideas
in original code; no upstream template code, logos, photographs, testimonials or
prices are redistributed in the generator or exports. The independently licensed
stock pack is separate from those template assets.

| Sector | Official source and preview | Verified free-use terms | Composition reference |
| --- | --- | --- | --- |
| automotive/detailing | [Onyx / Car Detailing](https://www.framer.com/marketplace/templates/car-detailing/) · [preview](https://onyxcardetailing.framer.website/) | [Free Framer template; Limited Commercial licence permits commercial/client end products, prohibits standalone redistribution and competing templates.](https://www.framer.com/legal/community-terms) | Large high-contrast automotive photo hero; Dark garage palette with a single vivid accent. |
| automotive/car wash | [Cleancars](https://html.design/download/car-clean-service-website-template/) · [preview](https://html.design/preview/?theme=cleancars) | [Free CC BY 3.0 with attribution; third-party image rights remain separate.](https://html.design/license/) | Split white hero with large car-washing photograph; Three equal photographic service cards. |
| gardening/landscaping | [Greenora](https://www.framer.com/marketplace/templates/greenora/) · [preview](https://greenora.framer.website/) | [Free Framer template; Limited Commercial licence permits commercial/client end products, prohibits standalone redistribution and competing templates.](https://www.framer.com/legal/community-terms) | Garden image spanning the hero; Quiet green and cream colour system. |
| gardening/landscaping | [Gardener](https://htmlcodex.com/gardening-website-template/) · [preview](https://htmlcodex.com/demo/?item=2606) | [Free version labelled CC BY 4.0; HTML Codex credit required, plus publisher resale/repackaging restrictions.](https://htmlcodex.com/license/) | Large landscape photo hero; Green-on-white typography and section rhythm. |
| hair/beauty salon | [HairCut](https://htmlcodex.com/hair-salon-html-template/) · [preview](https://htmlcodex.com/demo/?item=2315) | [Free version labelled CC BY 4.0; HTML Codex credit required, plus publisher resale/repackaging restrictions.](https://htmlcodex.com/license/) | Full-width haircut photograph hero; Alternating stylist portrait and editorial about composition. |
| fitness/gym | [Gymso Fitness](https://www.tooplate.com/view/2119-gymso-fitness) · [preview](https://www.tooplate.com/live/2119_gymso_fitness) | [Free commercial website use; credit optional. Upstream files cannot be redistributed on template/collection sites.](https://www.tooplate.com/about) | Dark full-bleed training photograph hero; Large bold high-contrast headline. |
| cafe/coffee | [Barista Cafe](https://www.tooplate.com/view/2137-barista-cafe) · [preview](https://www.tooplate.com/live/2137_barista_cafe) | [Free commercial website use; credit optional. Upstream files cannot be redistributed on template/collection sites.](https://www.tooplate.com/about) | Warm coffee-photo hero behind translucent navigation; Image-and-copy about split with warm overlay. |
| restaurant/cafe | [Crispy Kitchen](https://www.tooplate.com/view/2129-crispy-kitchen) · [preview](https://www.tooplate.com/live/2129_crispy_kitchen) | [Free commercial website use; credit optional. Upstream files cannot be redistributed on template/collection sites.](https://www.tooplate.com/about) | Broad food photograph hero/slideshow composition; Visual dish cards and editorial about sections. |
| cafe/coffee | [Wave Cafe](https://www.tooplate.com/view/2121-wave-cafe) · [preview](https://www.tooplate.com/live/2121_wave_cafe) | [Free commercial website use; credit optional. Upstream files cannot be redistributed on template/collection sites.](https://www.tooplate.com/about) | Atmospheric background media; Compact drink-list presentation with actual photographs. |
| restaurant/dining | [Maillard](https://styleshout.com/free-templates/maillard/) · [preview](https://styleshout.com/templates/preview/Maillard_1_0_0/) | [Free commercial website use with visible StyleShout attribution; no sale or redistribution without consent.](https://styleshout.com/template-license/) | Immense elegant serif title over dark food close-up; Cinematic food photography and restrained navigation. |
| cafe/coffee | [Lounge](https://styleshout.com/free-templates/lounge/) · [preview](https://styleshout.com/templates/preview/Lounge_1_0_0/) | [Free commercial website use with visible StyleShout attribution; no sale or redistribution without consent.](https://styleshout.com/template-license/) | Oversized pale serif overlapping tall coffee still-life; Dark near-black canvas with muted green accents. |
| professional/trades/cleaning | [Clean Work](https://www.tooplate.com/view/2132-clean-work) · [preview](https://www.tooplate.com/live/2132_clean_work) | [Free commercial website use; credit optional. Upstream files cannot be redistributed on template/collection sites.](https://www.tooplate.com/about) | Bright professional-service photo hero; Service listings with large contextual imagery. |
| professional/interior design | [Moso Interior](https://www.tooplate.com/view/2133-moso-interior) · [preview](https://www.tooplate.com/live/2133_moso_interior) | [Free commercial website use; credit optional. Upstream files cannot be redistributed on template/collection sites.](https://www.tooplate.com/about) | Large room/interior imagery; Neutral material-inspired palette. |
| professional/creative portfolio | [Story](https://html5up.net/story) · [preview](https://html5up.net/uploads/demos/story/) | [Free personal/commercial adaptation under CC BY 3.0 with HTML5 UP credit.](https://html5up.net/license) | Large split photo and text banner; Alternating image spotlights. |
| professional/trades/construction | [ScrewFast](https://github.com/mearashadowfax/ScrewFast) · [preview](https://screwfast.uk/) | [MIT; retain copyright and licence notice when using substantial source. Actual repository LICENSE checked.](https://github.com/mearashadowfax/ScrewFast/blob/main/LICENSE) | Clear service/product hierarchy; Construction equipment photography section. |

No paid template, attribution-removal licence, Framer hosting plan or Lovable
build was purchased for this revision. The stock pack is not copied out of any
of these templates. Current publisher terms must be rechecked before any future
reuse of actual template source. The professional fallback also retains its
existing Landwind source-reference metadata; the table above is the separate
15-reference research catalogue for this photographic redo.

## Matching editable source and working controls

The protected HTML preview and React/Vite export are serialised from one authored
composition with matching CSS and design metadata. The downloadable project has
editable `Navigation`, `Hero`, `Story`, `Services`, `Gallery`, `Contact`,
`AboutConcept` and `Footer` components. Photographs and provenance are embedded in
the source project. It is portable React code, not evidence of Lovable generation
or guaranteed import compatibility with every Lovable project.

Native navigation anchors, the mobile menu, service disclosure panels, photograph
enlargement and the provenance disclosure work through links and
`details`/`summary`. They support keyboard and touch without preview scripts.
Reduced-motion preferences are respected. Protected previews continue to disable
scripts; the concepts do not submit enquiries, bookings or payments. A verified
existing booking-profile link can open that external service. Public email and
phone details remain display-only in the preview.

The revision passed 330 renderer/export checks, 51 local review-UI browser checks
and 128 hosted UI checks at 1440px and 390px widths.
All six generated React exports passed type checks and production builds, with
content matching their protected previews. These checks use the tested fixtures
and viewports; physical microphone and speaker behaviour on the owner's devices
remains unverified.

## Rebuild versions and private owner review

The batch policy changes to **`photo-showcase-v2`**, so a previously completed
immersive report is not reused as the current photographic result. The verified
hosted run rebuilt all six eligible existing research records into new private
versions. It retained owner-edited draft text, embedded 24 illustrative stock
photographs and labelled six concept logos. Repeating the same request reused
the completed report and did not generate duplicate work.

The existing eligibility and input-fingerprint rules remain. An absent website
field is only **No own website recorded**, not proof that a website does not
exist. Only-social/directory records retain their uncertainty. Customers,
suppressed/disqualified/archived records, unsafe mail states and changed input
records are excluded or preserved with a visible reason. The batch is bounded
and does not silently process an incomplete larger inventory.

Rebuilding preserves owner-edited draft subjects and bodies, while updating the
private concept link and exact outgoing-version hash. Prior approvals cannot
approve the changed version. Identical requests for the same policy and inputs
reuse their report. Preparation alone does not send a customer email, publish a
concept or establish permission to contact a prospect.

Completion recorded one deduplicated owner notification containing all six ready
names and the private review-list link; hosted read-back verified it persisted.
The actual list stays inside the
owner-authenticated app and private verification records; no prospect names,
addresses, phone numbers or email addresses are included in this document.
A stored dashboard alert is not evidence of email, SMS, telephone or Telegram
delivery. External channels still require their real connections and preferences.

## Spoken reports and costs

Choose **Enable spoken updates**, then keep Jarvis open in the foreground with an
installed device voice. Manual report reading and automatic completion reports
share speech deduplication. Speech waits for other app audio or microphone use;
signing out or hiding the app stops its announcement. Physical playback through
the owner's Mac or phone still requires device verification.

This generation/rebuild path makes **no model, Lovable or paid voice-credit
calls**. It uses original deterministic templates and the device's speech engine,
not automatic ElevenLabs generation or transcription. Existing hosting charges,
research-provider limits and separately authorised external-provider usage still
apply. This does not assert a reconciled remaining A$300 budget.

## Release evidence and remaining limits

| Check | Current revision result |
| --- | --- |
| Full workspace test suite | **537 passed:** 231 core, 260 API, seven MCP, 24 local-agent and 15 UI |
| Production workspace build | **Passed** |
| Desktop/mobile rendering, native controls, images and matching exports | **330 renderer/export checks passed** |
| Local review-list and media UI browser checks | **51 passed** |
| Hosted review UI at 1440px and 390px | **128/128 passed** |
| Six generated React source projects | **Type checks and production builds passed** |
| Hosted authentication, deployed asset bytes, previews, source and batch checks | **227/227 passed** |
| New hosted private versions | **Six ready**, with 24 embedded illustrative photographs and six concept logos |
| Draft preservation and identical-request deduplication | **Passed** |
| Persisted owner notification and private review-list link | **Verified** for all six ready entries |
| Physical speech playback on the owner's devices | **Not verified** |

Hosted verification decoded embedded raster images, checked matching source
imagery and owner-secret exclusion, verified the deployed JavaScript/CSS bytes,
and exercised private-route authentication and logout protection. Hosted UI
checks verified all six cards, their four-photo/concept-logo counts, loaded
preview photos, safe references, deep review links and the visible notification;
no overflow, runtime error or external call was observed in those checks. No client
email, public concept publication or paid voice request occurred. No new
subscription or paid API call was made for the photographic rebuild. Existing
hosting charges continue.

Private hosted evidence remains outside the repository at
`/workspace/scratch/photo-showcase-live-verification.json` and
`/workspace/scratch/showcase-ui/live-report.json`. They retain the exact
private report and review path; prospect identities and contact details are not
copied into public documentation. Local fictional fixtures remain labelled
fictional. A saved dashboard notification is not external delivery, bounded
website research is not proof of website absence, and device-voice support is not
physical playback evidence. Earlier deployment counts belong to their own release.

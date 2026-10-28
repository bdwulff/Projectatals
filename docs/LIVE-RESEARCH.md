# Live business discovery and lookups

`BraveResearchSource` implements Atlas's `ResearchSource` with a real, read-only Brave Search HTTP adapter. It also exposes `lookup({ query, count? })` for general web lookups with source URLs. The provider and authentication were checked against [Brave's official Web Search documentation](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started) on 26 October 2026: `GET https://api.search.brave.com/res/v1/web/search`, using the `X-Subscription-Token` header and `web.results` response records. Country and language are request parameters; a response page supports at most 20 results.

Set `BRAVE_SEARCH_API_KEY` through the actual Atlas host's secret configuration. Do not paste it into chat, commit it, put it into a browser build or return it from `/api/status`. This change does not create an account, subscribe to a plan or buy search credits. An API key is still required; pricing and permitted storage/use must be checked against the existing account's plan before turning on scheduled searches. No live query has been verified by the mocked tests.

```ts
const research = new BraveResearchSource(); // reads BRAVE_SEARCH_API_KEY
await research.find({ area: "Berwick, Victoria", count: 5, industries: ["plumbing"] });
await research.lookup({ query: "business website accessibility guidance Australia", count: 3 });
```

The default country is `AU`; a constructor option can select another two-letter country code. The caller supplies the area and optional industry scope. Each `find` uses one search request with at most 20 provider results, then deduplicates candidate websites by host and returns at most the requested count. Directory and social-media hosts and obvious numbered lists are excluded conservatively. It may return fewer results or none. This is discovery, not a complete business directory, lead qualification or proof that the page belongs to a business in the requested area.

Every candidate is a search result needing review. Its provisional name is the source page's title. Its location and industry are explicitly unverified, and all evidence has `method: search_result` and `status: unverified`, with its source URL and retrieval time. No website defect, buying intent, contact consent, email address, quote scope or price is invented. It supplies no `checkUrl`, so a simple HTTP response cannot silently promote the search excerpt to confirmed evidence. Atlas should explain the difference between a discovered candidate and a qualified lead.

Source titles and excerpts are untrusted web content. They cannot approve actions, change Atlas's instructions, widen access, create a charge or contact anyone. HTML tags and controls are removed, text lengths are bounded, and general lookup records carry `trust: untrusted_web_content`. Any model consuming these fields must place them in a data-only context and retain source attribution. Do not interpolate them into system instructions or executable code. The adapter only contacts the fixed official API endpoint; it does not visit result pages or follow provider redirects.

Missing credentials, malformed responses, timeouts, HTTP errors and exhausted provider quotas fail with an explicit unavailable/error result. **There is no fallback to fictional businesses in live or mixed mode.** The runtime must choose this adapter in those modes, including when the key is absent. Fictional demonstrations remain a separately labelled fake-mode workflow.

`status()` makes no billable probe. A configured key is initially `not_connected` with an explanation that connectivity has not been verified. A successful, validated search sets `connected` for the last check; a failed search sets `error`. Connectivity does not certify search content or guarantee that the next request will succeed. Polling status cannot spend credits.

Limits are one provider request per operation, 1–20 requested outputs, a 400-character lookup query, an area of at most 160 characters, up to five industry terms, a ten-second default timeout and a one-MiB response cap. There are no automatic retries. Result links must be HTTP(S) public-domain URLs without embedded credentials. Common tracking query parameters and fragments are removed. This is link filtering, not DNS verification; use the separate website-checking security controls before fetching a result URL.

Tests in `packages/core/test/research.test.ts` use fetch mocks and clearly fictional source titles on reserved example domains. They cover source attribution, scope, deduplication, missing keys, malformed envelopes/rows, unsafe links, provider errors, redacted exception details, response limits and the absence of fake fallback. They do not claim a successful live connection, acquired customer or customer contact.

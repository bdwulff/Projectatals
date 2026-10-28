# Atlas BoxSafe read MCP

Local stdio MCP server using the official Model Context Protocol TypeScript SDK.
The supported v1 SDK is pinned to [1.32.2](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.32.2).
It exposes five read tools: recent orders, revenue summary, dispatch queue, read
connection health and a complete spoken-text briefing. It exposes no mutations,
arbitrary SQL, caller-selected URLs or customer contact details.

Build from the repository root:

```bash
pnpm --filter @atlas/core build
pnpm --filter @atlas/boxsafe-mcp build
ATLAS_MODE=fake node apps/boxsafe-mcp/dist/server.js
```

The final command waits for an MCP client's JSON-RPC messages on stdin. Protocol
output uses stdout; minimal audit records use stderr. The fictional demonstration
can be printed with `pnpm --filter @atlas/boxsafe-mcp demo` after building. It uses
a fixed fictional date and never calls live services.

Fake mode is the default and every output carries `fixture: true` and an explicit
fictional notice. Live mode requires `ATLAS_MODE=live`,
`BOXSAFE_READ_SCOPE_VERIFIED=true`, `BOXSAFE_SUPABASE_URL`,
`BOXSAFE_SUPABASE_READ_KEY` and `STRIPE_RESTRICTED_KEY`. The verification flag is
an operator acknowledgement after reviewing the database role's SELECT-only
permissions and account scope. The flag alone cannot restrict an overpowered
credential. Do not use a Supabase service-role key. Missing or failed live
connections produce an error; live mode never substitutes fictional values.

The live adapters still require end-to-end verification against the intended
accounts. A connected read probe is not proof of payment completeness, correct
database permissions or full application health. The briefing separately labels
fees, payouts, registrations, licences and webhook health as outside its coverage.
No speech provider is called: pass the `spoken` text to browser Speech Synthesis
or iOS Shortcuts' Speak Text action. No paid service is needed for the demo.

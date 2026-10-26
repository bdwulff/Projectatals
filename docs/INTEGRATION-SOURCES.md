# Atlas integration verification

Checked 26 October 2026 against primary sources. This is a source and setup audit, not an installation claim. The parent session observed that the Claude Code CLI is absent in this workspace, so its installed version, plugin loading, OAuth state and hooks cannot be tested here. ChatGPT connector access does not establish Claude Code access.

## Coding plugins

The [current Anthropic marketplace manifest](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json) lists these exact IDs:

| Plugin ID | Publisher or upstream | Prerequisite / harmless verification |
|---|---|---|
| `github` | Official GitHub MCP | Repository-scoped authentication; read repository metadata |
| `playwright` | Microsoft | Node and browser runtime; open a local test page |
| `frontend-design` | Anthropic | No external account; inspect loaded skill |
| `superpowers` | `obra/superpowers` | Third-party methodology plugin; inspect loaded skills and hooks |
| `context7` | Upstash | Hosted documentation service; public library lookup |
| `sentry` | `getsentry/plugin-claude` | Sentry organization/project OAuth; read project issue list |
| `security-guidance` | Anthropic | Security hooks; inspect hook loading and run a disposable example |
| `typescript-lsp` | Anthropic | `typescript-language-server` on PATH; inspect diagnostics on a disposable TypeScript file |

Use the [documented plugin manager](https://code.claude.com/docs/en/discover-plugins). Commands below are verified setup instructions for the actual Claude Code machine, not commands executed in this audit:

```text
/plugin marketplace add anthropics/claude-plugins-official
/plugin install github@claude-plugins-official
/plugin install playwright@claude-plugins-official
/plugin install frontend-design@claude-plugins-official
/plugin install superpowers@claude-plugins-official
/plugin install context7@claude-plugins-official
/plugin install sentry@claude-plugins-official
/plugin install security-guidance@claude-plugins-official
/plugin install typescript-lsp@claude-plugins-official
```

Install only the selected subset after inspecting existing configuration. Reuse existing servers instead of adding duplicate direct MCP definitions. Check `claude --version`, `/plugin`, and `/mcp` on that machine; do not claim compatibility from marketplace presence alone.

The [TypeScript plugin README](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/typescript-lsp/README.md) separately requires the language-server executable. Its documented shell installation is `npm install -g typescript-language-server typescript`. Keep the application's own TypeScript dependency unchanged unless its upgrade is separately needed.

The [GitHub marketplace server definition](https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/external_plugins/github/.mcp.json) references `GITHUB_PERSONAL_ACCESS_TOKEN` and `https://api.githubcopilot.com/mcp/`. Use a narrowly scoped token for the intended repositories; do not copy ChatGPT credentials or commit tokens. GitHub's [Claude setup guide](https://raw.githubusercontent.com/github/github-mcp-server/main/docs/installation-guides/install-claude.md) documents additional remote and local OAuth/PAT options, with different instructions by CLI version.

Microsoft's [Playwright MCP README](https://raw.githubusercontent.com/microsoft/playwright-mcp/main/README.md) requires Node 18+ and documents `claude mcp add playwright npx @playwright/mcp@latest` as an alternative to the plugin. The browser can submit real forms using its session, so initially use a disposable browser profile and test pages. Microsoft also offers CLI plus skills for coding agents; choose one route based on the task.

Sentry's [plugin README](https://raw.githubusercontent.com/getsentry/plugin-claude/main/README.md) confirms `claude plugin install sentry@claude-plugins-official`. The [official hosted MCP service](https://mcp.sentry.dev/) authenticates using OAuth and supports project-scoped URLs such as `https://mcp.sentry.dev/mcp/ORG/PROJECT`. Select the correct business project and start with read operations; issue details can contain user data.

## Lovable

The [official Lovable plugin instructions](https://github.com/lovablelabs/mcp/blob/main/CLAUDE.md) verify:

```text
/plugin marketplace add lovablelabs/mcp
/plugin install lovable@lovable
```

Alternatively, the [official MCP README](https://raw.githubusercontent.com/lovablelabs/mcp/main/README.md) documents:

```sh
claude mcp add --transport http lovable https://mcp.lovable.dev
```

Choose one method. OAuth 2.1 is required; authentication is per account, not restricted to one project. Test with workspace/project listing. The plugin requires a Claude Code version supporting plugins and remote Streamable HTTP MCP. Creation and agent messages consume build credits; reads do not. SQL tools have broad write/schema capabilities, and publishing creates a public URL. Keep agent messages, deploys and SQL writes outside the initial read-only workflow.

## Stripe

[Stripe's current MCP documentation](https://docs.stripe.com/mcp) verifies the endpoint and CLI command:

```sh
claude mcp add --transport http stripe https://mcp.stripe.com/
```

Authenticate in `/mcp` with OAuth, or reference an agent API key through an environment variable in `.mcp.json`. Select only BoxSafe's account and environment. Current docs specify migrating ordinary secret/untagged restricted keys by 30 November 2026; unsupported keys stop working in December. The hosted server exposes both read and write tools, so server presence alone does not establish read-only access. Choose permissions that allow the required reads and deny all mutations.

[Stripe API key guidance](https://docs.stripe.com/keys) recommends restricted permissions and separate sandbox/live credentials. For the briefing, allow only required account, payment/charge/refund and balance-transaction reads; exact permission labels depend on the selected authentication flow. Store secrets in the actual host's secret manager, not in a prompt or repository. Verify account identity and a bounded payment list before enabling business reports.

## n8n

The [official built-in n8n MCP server](https://docs.n8n.io/connect/connect-to-n8n-mcp-server.md) supports workflow creation/editing from n8n 2.13.0 onward. Existing workflow execution requires MCP access on the instance and on each intended workflow. This differs from an MCP Server Trigger node, which exposes tools from a single workflow. Avoid assuming a third-party package is the official integration.

The [official Claude Code example](https://docs.n8n.io/connect/connect-to-n8n-mcp-server/mcp-client-examples.md) is:

```sh
claude mcp add --transport http n8n https://YOUR-N8N-DOMAIN/mcp-server/http
```

Copy the actual server URL from Settings → Instance-level MCP → Connect a client, then use `/mcp` for OAuth. No actual n8n instance URL or credentials have been established by this audit. A locally saved workflow is not durable automation until imported, credentialed, tested and activated on a running instance. Workflows should retrieve structured data, retry transient reads, deduplicate notifications, record run status and send only approved owner notifications. Customer outreach and financial mutations remain separate approval-required actions.

## Cost assessment

No purchases, builds, account changes, deployments or new subscriptions were made in this audit. Preserve the A$300 experimentation ceiling; existing spend is unknown, so remaining budget cannot be asserted.

| Component | Verified cost basis / decision |
|---|---|
| Local coding plugins, Playwright and language server | No new hosted service is required for their local operation; Claude usage and machine costs still apply. No paid plan activated. |
| Lovable | Existing workspace plan and credits determine incremental spend. Read-only inspection avoids build credits. [Current pricing](https://lovable.dev/pricing) describes variable build and hosting credit consumption. No account-specific estimate is available. |
| Context7 | [Free plan](https://context7.com/plans): 1,000 API calls/month; listed Pro is $10/seat/month with metered excess usage. Currency is shown as `$` on the source, not converted to AUD here. Stay on free public documentation access. |
| n8n | [Community edition](https://docs.n8n.io/deploy/host-n8n/community-edition-features.md) is free to self-host; server, backup and maintenance costs remain. [Cloud Starter](https://n8n.io/pricing/) is listed at €20/month **billed annually**, with 2,500 executions; this is an annual commitment, not a €20 one-month purchase. Do not subscribe without authorization. |
| Stripe and Sentry | Existing account/plan, retention, usage and optional paid features determine costs. No additional plan or charge was activated. Exact account costs remain unverified. |
| Voice/phone | ElevenLabs/Twilio evaluation deferred; no numbers, calls, recording or subscriptions provisioned. Local device speech is the initial option. |

## Remaining owner actions and blockers

1. Run the setup on the actual Atlas Claude Code host after checking its current version and configuration; CLI access is missing here.
2. Complete any missing OAuth flows on that host. Connector access in this ChatGPT session is not transferable authentication.
3. Provide an existing n8n instance URL, or choose an explicitly approved hosting plan before provisioning one.
4. Establish BoxSafe read-only backend credentials or a scoped authenticated reporting endpoint, and Stripe read permissions, before making live-data claims.
5. Test every installed component with the bounded read operations above and record actual results. Official-source verification is not an operational test.

## Custom MCP SDK source verification

The [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) now develops v2 on its main branch with separate `@modelcontextprotocol/server` and `@modelcontextprotocol/client` packages. The older `@modelcontextprotocol/sdk` package remains on the `v1.x` branch, receiving security and bug fixes for at least six months after the 27 July 2026 v2 release.

The current v1 release is **1.32.2**, released 23 October 2026, verified against the [release list](https://github.com/modelcontextprotocol/typescript-sdk/releases) and [exact tagged package manifest](https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/1.32.2/package.json). It requires Node 18+ and supports Zod `^3.25 || ^4.0`. Existing v1 code can pin that package without changing to v2 imports. Source import paths include `@modelcontextprotocol/sdk/server/index.js`, `server/mcp.js`, `server/stdio.js`, and `inMemory.js`.

The v1 [McpServer source](https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/src/server/mcp.ts) provides `registerTool` and `connect`; the [stdio transport](https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/src/server/stdio.ts) connects through stdin/stdout. The [in-memory transport](https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/src/inMemory.ts) provides `InMemoryTransport.createLinkedPair()` for client/server protocol tests without opening a network port. The low-level `Server` remains available but is marked deprecated for ordinary use in favor of `McpServer`.

This establishes source compatibility, not successful npm installation or executed protocol tests; those results must be recorded separately.

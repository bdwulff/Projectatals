import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { buildRuntime } from "./runtime.js";
import { existsSync } from "node:fs";

const rt = buildRuntime();
const app = createApp(rt);
const uiDist = new URL("../../command-centre/dist/", import.meta.url).pathname;
if (existsSync(uiDist)) {
  app.use("/*", serveStatic({ root: uiDist.replace(process.cwd() + "/", "") }));
}
const port = Number(process.env.PORT ?? 8787);
const intervalMs = Number(process.env.ATLAS_CHECK_INTERVAL_MS ?? 5 * 60_000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Atlas API listening on http://localhost:${port} (mode: ${rt.mode}, db: ${process.env.ATLAS_DB_PATH ?? ":memory:"})`);
  console.log(`Scheduled checks every ${intervalMs / 1000}s (not continuous monitoring).`);
});
setInterval(() => { rt.atlas.runScheduledChecks().catch((e: unknown) => console.error("scheduled checks failed", e)); }, intervalMs).unref();

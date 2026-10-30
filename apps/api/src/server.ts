import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { authOptionsFromEnv } from "./auth.js";
import { startBackgroundWorker } from "./background.js";
import { buildRuntime } from "./runtime.js";
import { existsSync } from "node:fs";
import { installScenicPreviewRoutes } from "./scenic-previews.js";

const bindHost = process.env.ATLAS_BIND_HOST ?? "127.0.0.1";
const loopback = bindHost === "127.0.0.1" || bindHost === "::1";
if (!loopback) {
  if (!process.env.ATLAS_OWNER_ACCESS_KEY || !process.env.ATLAS_PUBLIC_ORIGIN?.startsWith("https://")) throw new Error("Remote binding requires an owner access key and HTTPS ATLAS_PUBLIC_ORIGIN");
  if (!process.env.ATLAS_DB_PATH || process.env.ATLAS_DB_PATH === ":memory:") throw new Error("Hosted Atlas requires persistent ATLAS_DB_PATH and one replica");
}
const rt = buildRuntime();
const app = createApp(rt, { ...authOptionsFromEnv(process.env), localOnlyServer: loopback });
installScenicPreviewRoutes(app);
const uiDist = new URL("../../command-centre/dist/", import.meta.url).pathname;
if (existsSync(uiDist)) {
  app.use("/*", serveStatic({ root: uiDist.replace(process.cwd() + "/", "") }));
}
const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port, hostname: bindHost }, () => {
  console.log(`Atlas API listening on ${bindHost}:${port} (mode: ${rt.mode}). Owner authentication is required.`);
});
const worker = startBackgroundWorker(rt, process.env);
console.log(`Scheduled checks every ${worker.intervalMs / 1000}s; not continuous monitoring.`);
const shutdown = () => { worker.stop(); server.close(); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

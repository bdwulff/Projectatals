import { isIP } from "node:net";
import { isPublicAddress } from "@atlas/core";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Runtime } from "./runtime.js";

const ACTIONS = ["device.status", "browser.open", "apps.open"] as const;
type DeviceAction = typeof ACTIONS[number];
type Device = { id: string; name: string; tokenHash: string; allowedActions: DeviceAction[]; createdAt: string; lastSeenAt?: string; revokedAt?: string };
type Pairing = { id: string; deviceName: string; codeHash: string; allowedActions: DeviceAction[]; expiresAt: string; consumedAt?: string };
type DeviceTask = { id: string; deviceId: string; action: DeviceAction; payload: Record<string, string>; requestId: string; status: "queued" | "leased" | "completed" | "failed" | "expired"; createdAt: string; expiresAt: string; leasedAt?: string; dispatchReady?: boolean; result?: unknown };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const random = (prefix: string) => prefix + randomBytes(24).toString("base64url");
const text = (value: unknown, limit: number) => typeof value === "string" && value.length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value);
const publicDevice = ({ tokenHash: _, ...device }: Device) => device;
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function payloadFor(action: DeviceAction, value: unknown): Record<string, string> {
  if (!record(value)) throw new Error("Invalid task payload");
  if (action === "device.status" && Object.keys(value).length === 0) return {};
  if (action === "apps.open" && Object.keys(value).length === 1 && ["calculator", "notes", "calendar"].includes(value.appId as string)) return { appId: value.appId as string };
  if (action === "browser.open" && Object.keys(value).length === 1 && text(value.url, 2048)) {
    const url = new URL(value.url as string);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Only public web URLs can be requested");
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (url.port || (isIP(host) && !isPublicAddress(host))) throw new Error("Public web destinations with standard ports only");
    if (!host.includes(".") || /(?:^|\.)(?:local|localhost|internal|test|invalid|lan|home)$/.test(host)) throw new Error("Private web hosts are unavailable");
    return { url: url.href };
  }
  throw new Error("Unsupported task or payload");
}

/** Device transport has a separate bearer credential. Owner login never travels to the Mac. */
export function installDeviceRoutes(app: Hono, rt: Runtime, now = () => new Date()) {
  const store = rt.atlas.deps.store;
  const devices = () => store.listDocs<Device>("devices", 100).map(r => r.doc);
  const tasks = () => store.listDocs<DeviceTask>("device_tasks", 500).map(r => r.doc);
  const failedClaims: number[] = [];
  rt.atlas.jobs.register<{ taskId: string }, { published: boolean }>("device_dispatch", async ({ taskId }) => {
    const task = store.getDoc<DeviceTask>("device_tasks", taskId)?.doc;
    if (!task || task.status !== "queued") return { published: false };
    task.dispatchReady = true;
    store.upsertDoc("device_tasks", task.id, task);
    return { published: true };
  });
  const getDevice = (c: Context): Device | null => {
    const auth = c.req.header("authorization") ?? "";
    if (!auth.startsWith("Bearer ") || auth.length > 200) return null;
    const tokenHash = hash(auth.slice(7));
    return devices().find(d => !d.revokedAt && d.tokenHash === tokenHash) ?? null;
  };
  const expire = (task: DeviceTask) => {
    if (["queued", "leased"].includes(task.status) && Date.parse(task.expiresAt) <= now().getTime()) {
      task.status = "expired";
      store.upsertDoc("device_tasks", task.id, task);
    }
    return task;
  };

  app.get("/api/devices", c => c.json({ devices: devices().map(publicDevice), tasks: tasks().map(expire).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100) }));
  app.post("/api/devices/pairing", async c => {
    const body: unknown = await c.req.json();
    if (!record(body) || !text(body.deviceName, 80) || !Array.isArray(body.allowedActions) || !body.allowedActions.length || body.allowedActions.length > 3 || body.allowedActions.some(a => !ACTIONS.includes(a as DeviceAction))) return c.json({ error: "Choose a Mac name and supported permissions." }, 400);
    if (devices().filter(d => !d.revokedAt).length >= 5) return c.json({ error: "Revoke an existing device before pairing another." }, 409);
    const code = random("pair_");
    const pairing: Pairing = { id: random("pairing_"), deviceName: body.deviceName as string, codeHash: hash(code), allowedActions: [...new Set(body.allowedActions as DeviceAction[])], expiresAt: new Date(now().getTime() + 600_000).toISOString() };
    store.upsertDoc("device_pairings", pairing.id, pairing);
    rt.atlas.audit.record({ actor: "owner", action: "device.pairing_requested", business: "atlas", outcome: "completed", detail: { allowedActions: pairing.allowedActions } });
    c.header("Cache-Control", "no-store");
    return c.json({ pairCode: code, expiresAt: pairing.expiresAt });
  });
  app.post("/api/devices/:id/tasks", async c => {
    const device = devices().find(d => d.id === c.req.param("id") && !d.revokedAt);
    if (!device) return c.json({ error: "Device unavailable." }, 404);
    const body: unknown = await c.req.json();
    if (!record(body) || !ACTIONS.includes(body.action as DeviceAction) || !text(body.requestId, 128)) return c.json({ error: "Invalid device request." }, 400);
    if (!device.allowedActions.includes(body.action as DeviceAction)) return c.json({ error: "This action was not granted during pairing." }, 403);
    let payload: Record<string, string>;
    try { payload = payloadFor(body.action as DeviceAction, body.payload); }
    catch { return c.json({ error: "Unsupported device task. Use a public web URL or an enabled app." }, 400); }
    const key = hash(device.id + ":" + body.requestId);
    const prior = store.getDoc<DeviceTask>("device_tasks", key)?.doc;
    if (prior) {
      if (prior.action !== body.action || JSON.stringify(prior.payload) !== JSON.stringify(payload)) return c.json({ error: "A request ID cannot authorise changed instructions." }, 409);
      return c.json({ task: expire(prior) });
    }
    const task: DeviceTask = { id: key, deviceId: device.id, action: body.action as DeviceAction, payload, requestId: body.requestId as string, status: "queued", createdAt: now().toISOString(), expiresAt: new Date(now().getTime() + 300_000).toISOString() };
    store.upsertDoc("device_tasks", task.id, task);
    rt.atlas.jobs.enqueue("device_dispatch", { taskId: task.id }, { idempotencyKey: `device_dispatch:${task.id}`, maxAttempts: 1 });
    await rt.atlas.jobs.runOnce();
    // Another owner job may be running; a bounded deferred drain publishes the already requested task.
    if (!store.getDoc<DeviceTask>("device_tasks", task.id)?.doc.dispatchReady) {
      const deferred = setTimeout(() => { void rt.atlas.jobs.runOnce().catch(() => {}); }, 1000);
      deferred.unref();
    }
    rt.atlas.audit.record({ actor: "owner", action: "device.task_requested", business: "atlas", targetId: task.id, outcome: "attempted", detail: { action: task.action, deviceId: device.id } });
    return c.json({ task }, 201);
  });
  app.delete("/api/devices/:id", c => {
    const device = devices().find(d => d.id === c.req.param("id"));
    if (!device) return c.json({ error: "Device unavailable." }, 404);
    device.revokedAt = now().toISOString();
    store.upsertDoc("devices", device.id, device);
    for (const task of tasks().filter(t => t.deviceId === device.id && t.status === "queued")) { task.status = "expired"; store.upsertDoc("device_tasks", task.id, task); }
    rt.atlas.audit.record({ actor: "owner", action: "device.revoked", business: "atlas", targetId: device.id, outcome: "completed" });
    return c.json({ ok: true });
  });
  app.get("/api/devices/mac-companion", async c => {
    try {
      const file = await readFile(new URL("../../command-centre/dist/downloads/Jarvis-Mac.zip", import.meta.url));
      return new Response(file, { headers: { "Content-Type": "application/zip", "Content-Disposition": "attachment; filename=Jarvis-Mac.zip", "Cache-Control": "private, no-store" } });
    } catch { return c.json({ error: "Mac download is not built yet." }, 503); }
  });

  app.use("/device-api/*", bodyLimit({ maxSize: 16_384, onError: c => c.json({ error: "Device request too large." }, 413) }));
  app.use("/device-api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (c.req.header("origin")) return c.json({ error: "Device transport accepts direct paired clients only." }, 403);
    if (c.req.method !== "GET" && c.req.header("content-type")?.split(";")[0]?.trim() !== "application/json") return c.json({ error: "JSON required." }, 415);
    return next();
  });
  app.post("/device-api/v1/claim", async c => {
    while (failedClaims.length && failedClaims[0]! < now().getTime() - 900_000) failedClaims.shift();
    if (failedClaims.length >= 20) return c.json({ error: "Pairing temporarily limited." }, 429);
    const body: unknown = await c.req.json();
    if (!record(body) || !text(body.pairCode, 128) || !text(body.deviceName, 80)) return c.json({ error: "Invalid pairing request." }, 400);
    const pairing = store.listDocs<Pairing>("device_pairings", 100).map(r => r.doc).find(p => !p.consumedAt && Date.parse(p.expiresAt) > now().getTime() && p.codeHash === hash(body.pairCode as string));
    if (!pairing) { failedClaims.push(now().getTime()); return c.json({ error: "Pairing code is invalid or expired." }, 401); }
    pairing.consumedAt = now().toISOString();
    store.upsertDoc("device_pairings", pairing.id, pairing);
    const token = random("device_");
    const device: Device = { id: random("mac_"), name: pairing.deviceName, tokenHash: hash(token), allowedActions: pairing.allowedActions, createdAt: now().toISOString(), lastSeenAt: now().toISOString() };
    store.upsertDoc("devices", device.id, device);
    rt.atlas.audit.record({ actor: "owner", action: "device.paired", business: "atlas", targetId: device.id, outcome: "completed" });
    return c.json({ deviceId: device.id, deviceToken: token, allowedActions: device.allowedActions });
  });
  app.get("/device-api/v1/tasks", c => {
    const device = getDevice(c);
    if (!device) return c.json({ error: "Device authentication required." }, 401);
    device.lastSeenAt = now().toISOString();
    store.upsertDoc("devices", device.id, device);
    const pending = tasks().map(expire).filter(t => t.deviceId === device.id && t.status === "queued" && t.dispatchReady).slice(0, 5);
    for (const task of pending) { task.status = "leased"; task.leasedAt = now().toISOString(); store.upsertDoc("device_tasks", task.id, task); }
    // Leased tasks are never repeated after an ambiguous network result or Mac restart.
    return c.json({ tasks: pending.map(({ id, action, payload, expiresAt }) => ({ id, action, payload, expiresAt })) });
  });
  app.post("/device-api/v1/tasks/:id/result", async c => {
    const device = getDevice(c);
    if (!device) return c.json({ error: "Device authentication required." }, 401);
    const task = store.getDoc<DeviceTask>("device_tasks", c.req.param("id"))?.doc;
    if (!task || task.deviceId !== device.id) return c.json({ error: "Task unavailable." }, 404);
    const body: unknown = await c.req.json();
    if (!record(body) || !["completed", "failed"].includes(body.status as string) || JSON.stringify(body.result ?? null).length > 4096) return c.json({ error: "Invalid device result." }, 400);
    if (task.status === "leased" || task.status === "expired") {
      task.status = body.status as "completed" | "failed";
      task.result = body.result ?? null;
      store.upsertDoc("device_tasks", task.id, task);
    }
    return c.json({ ok: true });
  });
  return { handleCommand: async (context: Context, raw: string) => {
    const input = raw.trim().replace(/^(?:hey\s+)?(?:jarvis|atlas)[,.]?\s*/i, "");
    let action: DeviceAction | null = null;
    let payload: Record<string, string> = {};
    const website = /^(?:open|browse(?:\s+to)?|go\s+to)\s+(https?:\/\/\S+)\s*$/i.exec(input);
    const application = /^(?:open|launch)\s+(?:the\s+)?(notes|calendar|calculator)(?:\s+on\s+(?:my\s+)?mac)?[.!]?$/i.exec(input);
    if (website) { action = "browser.open"; payload = { url: website[1]! }; }
    else if (application) { action = "apps.open"; payload = { appId: application[1]!.toLowerCase() }; }
    else if (/^(?:check|show|test)\s+(?:my\s+)?mac(?:\s+status)?[.!]?$/i.test(input)) action = "device.status";
    if (!action) return null;
    const active = devices().filter(d => !d.revokedAt);
    const intent = { kind: "device.command", action };
    if (active.length !== 1) return { reply: active.length ? "Choose the Mac in Devices before requesting this action." : "Pair your Mac in Devices first, then keep its Jarvis companion running.", intent, outcome: "denied" };
    const target = active[0]!;
    const headers = new Headers(context.req.raw.headers);
    headers.delete("content-length");
    headers.set("content-type", "application/json");
    const url = new URL(`/api/devices/${target.id}/tasks`, context.req.url);
    const response = await app.request(url.href, { method: "POST", headers, body: JSON.stringify({ action, payload, requestId: randomUUID() }) });
    const body = await response.json() as { task?: DeviceTask; error?: string };
    if (!response.ok || !body.task) return { reply: body.error ?? "The Mac request could not be queued.", intent, outcome: "denied" };
    return { reply: `Requested ${action === "browser.open" ? "opening the website" : action === "apps.open" ? "opening " + payload.appId : "a Mac status check"} on ${target.name}. This is queued until the companion accepts it. Check Devices for the result.`, intent, data: body.task, outcome: "attempted" };
  } };
}

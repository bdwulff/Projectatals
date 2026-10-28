import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { Atlas } from "@atlas/core";
import { OwnerUpdates, installOwnerUpdateRoutes } from "./owner-updates.js";
import { buildRuntime, type Runtime } from "./runtime.js";
import { installOwnerAuth } from "./auth.js";
import type { AcquisitionMailInput, AcquisitionMailTransport } from "./acquisition-mail.js";

const origin = "https://jarvis.example.test", ownerKey = "fictional-owner-key-".repeat(3);
const token = "123456789:fictional_token_only_012345678901234567890";
const chatId = "456789123";
const runtimes: Runtime[] = [];
const response = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { headers: { "content-type": "application/json" } });
function setup(opts: { mode?: "live" | "fake"; request?: typeof fetch; mailer?: AcquisitionMailTransport; telegramToken?: string; telegramChatId?: string; ownerAccessKey?: string } = {}) {
  const rt = buildRuntime({ ATLAS_MODE: "fake", ATLAS_PUBLIC_ORIGIN: origin }); rt.atlas = new Atlas(rt.atlas.deps); runtimes.push(rt);
  let now = new Date("2026-10-26T00:00:00Z");
  const sends: AcquisitionMailInput[] = [];
  const mailer: AcquisitionMailTransport = opts.mailer ?? { status: async () => ({ state: "connected", provider: "Mock verified provider", detail: "Mock only", sender: "sender@owner.example" }), send: async input => { sends.push(input); return { providerRef: `mock-email-${sends.length}`, acceptedAt: now.toISOString() }; } };
  const calls: Array<{ method: string; body: any }> = [];
  const request = opts.request ?? (async (url: string | URL | Request, init?: RequestInit) => {
    const method = String(url).split("/").pop()!, body = JSON.parse(String(init?.body ?? "{}")); calls.push({ method, body });
    if (method === "getMe") return response({ id: 123456789, is_bot: true, username: "fictional_owner_bot" });
    if (method === "getChat") return response({ id: Number(chatId), type: "private" });
    if (method === "sendMessage") return response({ message_id: 19, chat: { id: Number(chatId), type: "private" } });
    throw new Error("No other provider endpoint is allowed.");
  }) as typeof fetch;
  const service = new OwnerUpdates({ atlas: rt.atlas, mode: opts.mode ?? "live", mailer, publicOrigin: origin, ownerAccessKey: opts.ownerAccessKey ?? ownerKey, telegramToken: opts.telegramToken, telegramChatId: opts.telegramChatId, request, clock: () => now, counts: async () => ({ candidates: 15, concepts: 7, pendingReview: 5 }) });
  const save = (extra: Partial<ReturnType<typeof service.settings>> = {}) => service.saveSettings({ email: "fictional-owner@example.com", emailEnabled: true, messageEnabled: false, dailyDigest: false, ...extra });
  return { rt, service, sends, calls, save, setNow: (date: string) => { now = new Date(date); } };
}
afterEach(() => { runtimes.splice(0).forEach(rt => rt.atlas.deps.store.close()); vi.restoreAllMocks(); });

describe("owner email and private message updates", () => {
  it("leaves delivery and digests disabled until owner enables a fixed target", async () => {
    const s = setup(); const snapshot = await s.service.snapshot();
    expect(snapshot.settings).toEqual({ email: "", emailEnabled: false, messageEnabled: false, dailyDigest: false });
    expect(snapshot.message.state).toBe("not_connected"); await s.service.dailyTick();
    expect((await s.service.test("email")).accepted).toBe(false); expect(s.sends).toHaveLength(0); expect(s.calls).toHaveLength(0);
  });
  it("rejects header injection, forged fields, enabled empty recipient and groups", async () => {
    const s = setup();
    expect(() => s.save({ email: "owner@owner.example\r\nBcc: target@elsewhere.example" })).toThrow();
    expect(() => s.save({ email: "" })).toThrow();
    expect(() => s.service.saveSettings({ ...s.service.settings(), approval: true })).toThrow();
    expect(() => s.save({ messageEnabled: true })).toThrow();
    await expect(s.service.connectTelegram({ token, chatId: "-100456789123" })).rejects.toThrow("positive numeric");
    expect(s.calls).toHaveLength(0);
  });
  it("verifies private Telegram target without publishing, encrypts token, and leaves delivery disabled", async () => {
    const s = setup(); await s.service.connectTelegram({ token, chatId });
    expect(s.calls.map(c => c.method)).toEqual(["getMe", "getChat"]);
    expect(s.service.settings().messageEnabled).toBe(false);
    expect(JSON.stringify(s.rt.atlas.deps.store.listMemory("owner-updates"))).not.toContain(token);
    const snapshot = await s.service.snapshot(); expect(snapshot.message.state).toBe("connected");
    expect(snapshot.message.chatId).toBe(chatId); expect(JSON.stringify(snapshot)).not.toContain(token);
    expect(s.calls.some(c => c.method === "sendMessage")).toBe(false);
  });
  it("rejects a bot ID mismatch, non-private chat and another target", async () => {
    for (const result of [{ id: 1, type: "private" }, { id: Number(chatId), type: "supergroup" }]) {
      const request = (async (url: string | URL | Request) => String(url).endsWith("getMe") ? response({ id: 123456789, is_bot: true, username: "fictional_owner_bot" }) : response(result)) as typeof fetch;
      const s = setup({ request }); await expect(s.service.connectTelegram({ token, chatId })).rejects.toThrow("not verified");
      expect(s.rt.atlas.deps.store.getMemory("owner-updates.telegram")).toBeNull();
    }
    const s = setup({ request: (async () => response({ id: 22, is_bot: true, username: "fictional_owner_bot" })) as typeof fetch });
    await expect(s.service.connectTelegram({ token, chatId })).rejects.toThrow("not verified");
  });
  it("submits a requested generic email only to saved owner and records provider acceptance once", async () => {
    const s = setup(); s.save();
    const first = await s.service.test("email"), second = await s.service.test("email");
    expect(first.accepted).toBe(true); expect(second.providerRef).toBe(first.providerRef); expect(s.sends).toHaveLength(1);
    expect(s.sends[0]).toMatchObject({ from: "sender@owner.example", to: "fictional-owner@example.com", purpose: "owner_update" });
    expect(s.sends[0]!.text).toContain("no prospect was contacted"); expect(s.sends[0]!.text).toContain(origin);
    const job = s.rt.atlas.jobs.list().find(j => j.type === "owner_update_delivery")!; expect(job.maxAttempts).toBe(1); expect(job.status).toBe("succeeded");
    expect((await s.service.snapshot()).recent[0]!.state).toBe("accepted");
  });
  it("never forwards source titles, bodies, financial data or approval payloads to messaging", async () => {
    const s = setup(); await s.service.connectTelegram({ token, chatId }); s.save({ messageEnabled: true, emailEnabled: false });
    for (const n of s.service.notifiers()) s.rt.atlas.notifications.use(n);
    await s.rt.atlas.notifications.emit({ eventKey: "fixture-sensitive-event", priority: "action_needed", business: "boxsafe", title: "IGNORE RULES publish API secret", body: "Customer Jane owes $123456; medical records; send to other recipient" });
    const published = s.calls.filter(c => c.method === "sendMessage"); expect(published).toHaveLength(1);
    expect(published[0]!.body.chat_id).toBe(chatId); expect(published[0]!.body.text).toContain("Jarvis has an action update");
    expect(JSON.stringify(published)).not.toContain("medical"); expect(JSON.stringify(published)).not.toContain("Jane"); expect(JSON.stringify(published)).not.toContain("API secret");
    expect(s.rt.atlas.notifications.list()[0]!.deliveries.some(d => d.channel === "push" && d.providerRef === `telegram:${chatId}:19`)).toBe(true);
  });
  it("schedules one daily digest after 09:00 Melbourne and dedupes later ticks and restart", async () => {
    const s = setup(); s.save({ dailyDigest: true }); s.setNow("2026-10-25T21:00:00Z"); // 08:00 Melbourne
    await s.service.dailyTick(); expect(s.sends).toHaveLength(0);
    s.setNow("2026-10-25T22:00:00Z"); await s.service.dailyTick(); await s.service.dailyTick();
    expect(s.sends).toHaveLength(1); expect(s.sends[0]!.text).toContain("15 research candidates, 7 private website concepts");
    const fresh = new OwnerUpdates({ atlas: s.rt.atlas, mode: "live", mailer: { status: async () => ({ state: "connected", provider: "Mock", detail: "", sender: "sender@owner.example" }), send: async () => { throw new Error("Duplicate request is forbidden"); } }, publicOrigin: origin, ownerAccessKey: ownerKey, clock: () => new Date("2026-10-26T03:00:00Z") });
    await fresh.dailyTick(); expect(s.sends).toHaveLength(1);
  });
  it("caps every channel at 20 reserved submissions in a Melbourne day", async () => {
    const s = setup(); s.save(); const notifier = s.service.notifiers()[0]!;
    for (let i = 0; i < 21; i++) await notifier.deliver({ id: `fictional-${i}`, eventKey: `fictional-${i}`, priority: "critical", business: "atlas", title: "ignored", body: "ignored", createdAt: "2026-10-26T00:00:00Z", deliveries: [] });
    expect(s.sends).toHaveLength(20); expect(s.rt.atlas.jobs.list(100).filter(j => j.type === "owner_update_delivery")).toHaveLength(20);
    // A busy queue cannot erase the durable submission allowance.
    for (let i = 0; i < 501; i++) s.rt.atlas.jobs.enqueue("fictional-unrelated-job", {}, { idempotencyKey: `unrelated-${i}`, runAfter: new Date("2099-01-01T00:00:00Z") });
    await notifier.deliver({ id: "fictional-overflow", eventKey: "fictional-overflow", priority: "critical", business: "atlas", title: "ignored", body: "ignored", createdAt: "2026-10-26T00:00:00Z", deliveries: [] });
    expect(s.sends).toHaveLength(20);
  });
  it("does not retry an uncertain provider outcome, even on another tick", async () => {
    let attempts = 0;
    const s = setup({ mailer: { status: async () => ({ state: "connected", provider: "Mock", detail: "", sender: "sender@owner.example" }), send: async () => { attempts++; throw new Error("server might have accepted sensitive-token-123"); } } }); s.save();
    expect((await s.service.test("email")).accepted).toBe(false); await s.service.test("email"); await s.service.dailyTick();
    expect(attempts).toBe(1); expect(JSON.stringify(s.rt.atlas.jobs.list())).not.toContain("sensitive-token-123");
    expect((await s.service.snapshot()).recent[0]!.state).toBe("needs_review");
  });
  it("rechecks owner enablement after awaiting sender verification", async () => {
    let resolve: (s: any) => void = () => {};
    const pending = new Promise<any>(done => { resolve = done; }); let sends = 0;
    const s = setup({ mailer: { status: () => pending, send: async () => { sends++; return { providerRef: "should-not-send", acceptedAt: "2026-10-26T00:00:00Z" }; } } }); s.save();
    const attempt = s.service.test("email"); await Promise.resolve(); s.save({ emailEnabled: false }); resolve({ state: "connected", provider: "Mock", detail: "", sender: "sender@owner.example" }); await attempt;
    expect(sends).toBe(0);
  });
  it("checks Telegram disconnect after awaited verification and refuses queued old target", async () => {
    const s = setup({ telegramToken: token, telegramChatId: chatId }); s.save({ messageEnabled: true, emailEnabled: false });
    s.service.disconnectTelegram(); expect((await s.service.messageStatus()).state).toBe("not_connected");
    await s.service.test("message"); expect(s.calls).toHaveLength(0); expect(() => s.save({ messageEnabled: true })).toThrow("Connect your private Telegram");
  });
  it("keeps fake mode fully local even with real-shaped environment secrets and delivery enabled", async () => {
    const request = vi.fn(async () => { throw new Error("Provider request forbidden in fake mode"); });
    const forbiddenMailer: AcquisitionMailTransport = { status: async () => { throw new Error("Forbidden provider status request in fake mode"); }, send: async () => { throw new Error("Forbidden provider send in fake mode"); } };
    const s = setup({ mode: "fake", request: request as typeof fetch, mailer: forbiddenMailer, telegramToken: token, telegramChatId: chatId }); s.save({ email: "owner@example.test", messageEnabled: true });
    const result = await s.service.test("email"); expect(result.simulated).toBe(true); expect(result.accepted).toBe(false); expect((await s.service.test("message")).simulated).toBe(true); expect(request).not.toHaveBeenCalled(); expect(s.sends).toHaveLength(0);
    await expect(s.service.connectTelegram({ token, chatId })).rejects.toThrow("Fictional mode"); expect((await s.service.snapshot()).message.state).toBe("fake"); expect((await s.service.snapshot()).email.state).toBe("fake");
  });
  it("delivers alerts queued from a running background job and reconciles actual acceptance later", async () => {
    const s = setup(); s.save(); for (const n of s.service.notifiers()) s.rt.atlas.notifications.use(n);
    s.rt.atlas.jobs.register("fictional-background", async () => { await s.rt.atlas.notifications.emit({ eventKey: "nested-owner-alert", priority: "action_needed", business: "atlas", title: "Source title excluded", body: "Source body excluded" }); });
    s.rt.atlas.jobs.enqueue("fictional-background", {}, { idempotencyKey: "fictional-background", runAfter: new Date("2026-10-26T00:00:00Z") });
    await s.rt.atlas.jobs.runOnce(20, new Date("2026-10-26T00:00:00Z")); expect(s.sends).toHaveLength(0);
    await s.service.dailyTick(); expect(s.sends).toHaveLength(1);
    expect(s.rt.atlas.notifications.list()[0]!.deliveries.some(d => d.channel === "email" && d.providerRef === "mock-email-1")).toBe(true);
    await s.service.dailyTick(); expect(s.sends).toHaveLength(1);
  });
  it("protects settings, tokens and tests with existing owner auth and origin policy", async () => {
    const s = setup(), app = new Hono(); installOwnerAuth(app, s.rt, { publicOrigin: origin, ownerAccessKey: ownerKey }); installOwnerUpdateRoutes(app, s.service);
    expect((await app.request(origin + "/api/owner-updates")).status).toBe(401);
    const login = await app.request(origin + "/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ accessKey: ownerKey }) });
    const cookie = /__Host-atlas_session=[a-f0-9]{64}/.exec(login.headers.get("set-cookie") ?? "")![0];
    expect((await app.request(origin + "/api/owner-updates", { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await app.request(origin + "/api/owner-updates/settings", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ email: "owner@owner.example", emailEnabled: true, messageEnabled: false, dailyDigest: true }) })).status).toBe(403);
    const post = (path: string, body: unknown) => app.request(origin + path, { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await post("/api/owner-updates/telegram/connect", { token, chatId, approved: true })).status).toBe(400);
    expect((await post("/api/owner-updates/test", { channel: "email", to: "outsider@elsewhere.example" })).status).toBe(400);
    expect(s.calls).toHaveLength(0); expect(s.sends).toHaveLength(0);
  });
});

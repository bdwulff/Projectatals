import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteStore } from "../src/store.js";
import { VerifiedTwilioTelephony, NtfyOwnerNotifier } from "../src/adapters/live/notifications.js";
import type { Notification } from "../src/notifications.js";

const sid = "AC" + "1".repeat(32);
const callSid = "CA" + "2".repeat(32);
const from = "+61411111111";
const owner = "+61422222222";
const topic = "atlas_private_owner_topic_fixture";
const clock = () => new Date("2026-10-26T12:00:00.000Z");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const stores: SqliteStore[] = [];
const dirs: string[] = [];
function store() { const s = new SqliteStore(":memory:"); stores.push(s); return s; }
function config(s = store()) { return { sid, token: "fictional-token", from, ownerNumber: owner, enabled: true, store: s, clock }; }
function twilioFetch(callResult: () => Promise<Response> = async () => json({ sid: callSid, account_sid: sid, to: owner, from, status: "queued" })) {
  const fn = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    const target = String(url);
    if (options?.method === "POST") return callResult();
    if (target.endsWith(`Accounts/${sid}.json`)) return json({ sid, status: "active" });
    if (target.includes("IncomingPhoneNumbers.json")) return json({ incoming_phone_numbers: [{ phone_number: from, capabilities: { voice: true } }] });
    if (target.endsWith(`Calls/${callSid}.json`)) return json({ sid: callSid, account_sid: sid, to: owner, from, status: "completed", duration: "15" });
    throw new Error("Unexpected mocked URL");
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
function notification(eventKey = "site:down:fixture"): Notification {
  return { id: "n_fixture", eventKey, priority: "critical", business: "boxsafe", title: "Sensitive identity text", body: "customer@example.test medical payment A$100", createdAt: clock().toISOString(), deliveries: [] };
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const s of stores.splice(0)) s.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("verified owner calls", () => {
  it("checks account and owned voice capability using reads, and remains gated when disabled", async () => {
    const fetch = twilioFetch();
    const tel = new VerifiedTwilioTelephony({ ...config(), enabled: false });
    expect(await tel.status()).toMatchObject({ state: "connected", mode: "live", detail: expect.stringContaining("disabled") });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
    expect(await tel.call({ to: owner, script: "A private alert is ready.", reason: "fixture-event" })).toMatchObject({ status: "failed", detail: "Owner calls are disabled." });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refuses another destination and requires real provider references before accepting a queued call", async () => {
    const fetch = twilioFetch(async () => json({ account_sid: sid, status: "queued" }));
    const tel = new VerifiedTwilioTelephony(config());
    expect(await tel.call({ to: "+61433333333", script: "Fixture", reason: "bad-destination" })).toMatchObject({ status: "failed" });
    expect(fetch).not.toHaveBeenCalled();
    expect(await tel.call({ to: owner, script: "Fixture", reason: "missing-reference" })).toMatchObject({ status: "failed", providerRef: "" });
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("deduplicates concurrent event calls, XML-escapes scripts, caps duration and only reports provider completion after a read", async () => {
    const fetch = twilioFetch();
    const tel = new VerifiedTwilioTelephony(config());
    const request = { to: owner, script: "Fixture <Hangup/> & alert", reason: "event1" };
    const results = await Promise.all([tel.call(request), tel.call(request)]);
    expect(results.some((r) => r.providerRef === callSid && r.status === "queued")).toBe(true);
    const posts = fetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    const body = posts[0]?.[1]?.body as URLSearchParams;
    expect(body.get("Twiml")).toContain("&lt;Hangup/&gt; &amp; alert");
    expect(body.get("TimeLimit")).toBe("60");
    expect(body.get("Record")).toBe("false");
    expect(await tel.callStatus(callSid)).toEqual({ status: "completed", durationSeconds: 15 });
    expect(await tel.callStatus("arbitrary/path")).toEqual({ status: "failed" });
  });

  it("persists dedupe and a daily Melbourne quota across restarts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-owner-transport-")); dirs.push(dir);
    const path = join(dir, "atlas.sqlite");
    const fetch = twilioFetch();
    let persisted = new SqliteStore(path);
    const first = new VerifiedTwilioTelephony(config(persisted));
    expect(await first.call({ to: owner, script: "Fixture", reason: "event1" })).toMatchObject({ status: "queued" });
    persisted.close();
    persisted = new SqliteStore(path); stores.push(persisted);
    const restarted = new VerifiedTwilioTelephony(config(persisted));
    expect(await restarted.call({ to: owner, script: "Fixture", reason: "event1" })).toMatchObject({ providerRef: callSid, status: "queued", detail: expect.stringContaining("no duplicate") });
    expect(await restarted.call({ to: owner, script: "Fixture", reason: "event2" })).toMatchObject({ status: "failed", detail: expect.stringContaining("quota") });
    const nextMelbourneDay = new VerifiedTwilioTelephony({ ...config(persisted), clock: () => new Date("2026-10-26T13:01:00.000Z") });
    expect(await nextMelbourneDay.call({ to: owner, script: "Fixture", reason: "event3" })).toMatchObject({ status: "queued" });
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });

  it("never retries an ambiguous provider submission automatically or exposes provider errors", async () => {
    const fetch = twilioFetch(async () => { throw new Error("fictional secret token in upstream error"); });
    const tel = new VerifiedTwilioTelephony(config());
    const request = { to: owner, script: "Fixture", reason: "event1" };
    const first = await tel.call(request);
    const second = await tel.call(request);
    expect(first).toMatchObject({ status: "failed", providerRef: "" });
    expect(second).toMatchObject({ status: "failed", detail: expect.stringContaining("No automatic retry") });
    expect(JSON.stringify([first, second])).not.toContain("secret token");
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("does not call when credentials fail remote verification", async () => {
    const fetch = vi.fn(async () => json({ error: "unauthorised" }, 401)); vi.stubGlobal("fetch", fetch);
    const tel = new VerifiedTwilioTelephony(config());
    expect(await tel.status()).toMatchObject({ state: "error" });
    expect(await tel.call({ to: owner, script: "Fixture", reason: "event1" })).toMatchObject({ status: "failed" });
    expect(fetch.mock.calls.every((call) => !call[1]?.method)).toBe(true);
  });
});

describe("ntfy owner push", () => {
  it("verifies topic auth with reads, publishes a generic owner alert and deduplicates accepted events", async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => String(url).endsWith("/auth")
      ? json({ success: true }) : init?.method === "POST" ? json({ id: "ntfy_fixture_id", event: "message", topic }) : json({}, 404));
    vi.stubGlobal("fetch", fetch);
    const push = new NtfyOwnerNotifier({ enabled: true, topic, token: "fictional-token", store: store(), clock });
    expect(await push.status()).toMatchObject({ state: "connected", detail: expect.stringContaining("phone receipt have not been tested") });
    expect(await push.deliver(notification())).toMatchObject({ delivered: true, providerRef: "ntfy_fixture_id", detail: expect.stringContaining("unverified") });
    expect(await push.deliver(notification())).toMatchObject({ delivered: true, providerRef: "ntfy_fixture_id" });
    const posts = fetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[1]?.body).toBe("Atlas has an owner alert. Open your private Atlas dashboard to review it.");
    expect(JSON.stringify(posts)).not.toContain("customer@example.test");
    expect(JSON.stringify(posts)).not.toContain("Sensitive identity");
  });

  it("rejects an unapproved host, redirects, disabled sends and routine events", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const badHost = new NtfyOwnerNotifier({ enabled: true, topic, baseUrl: "https://attacker.example.test", store: store() });
    expect(await badHost.status()).toMatchObject({ state: "not_connected" });
    const disabled = new NtfyOwnerNotifier({ topic, store: store() });
    expect(await disabled.deliver(notification())).toMatchObject({ delivered: false });
    const push = new NtfyOwnerNotifier({ enabled: true, topic, store: store() });
    expect(await push.deliver({ ...notification(), priority: "routine" })).toMatchObject({ delivered: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never claims acceptance for a missing provider message record or retries an uncertain submission", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/auth") ? json({ success: true }) : json({ event: "message", topic }));
    vi.stubGlobal("fetch", fetch);
    const push = new NtfyOwnerNotifier({ enabled: true, topic, store: store(), clock });
    expect(await push.deliver(notification())).toMatchObject({ delivered: false, detail: expect.stringContaining("valid accepted message") });
    expect(await push.deliver(notification())).toMatchObject({ delivered: false, detail: expect.stringContaining("No automatic duplicate") });
    expect(fetch.mock.calls.filter(([url]) => !String(url).endsWith("/auth"))).toHaveLength(1);
  });
});

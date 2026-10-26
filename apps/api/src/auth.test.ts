import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { buildRuntime } from "./runtime.js";
import type { OwnerAuthOptions } from "./auth.js";

const origin = "https://atlas.example.test";
const ownerAccessKey = "fixture-owner-key-only-012345678901234567890123456789";
const briefingReadToken = "fixture-briefing-only-012345678901234567890123456789";
const ownerOptions: OwnerAuthOptions = { ownerAccessKey, publicOrigin: origin };
function setup(options: OwnerAuthOptions = ownerOptions) {
  const rt = buildRuntime({ ATLAS_MODE: "fake" });
  const app = createApp(rt, options);
  const request = (path: string, init?: RequestInit) => app.request(origin + path, init);
  const post = (path: string, body: unknown = {}, cookie?: string) => request(path, {
    method: "POST", headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  const login = async () => {
    const response = await post("/api/auth/login", { accessKey: ownerAccessKey });
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie")!;
    const cookie = /__Host-atlas_session=[a-f0-9]{64}/.exec(setCookie)?.[0];
    expect(cookie).toBeTruthy();
    return { response, setCookie, cookie: cookie! };
  };
  return { rt, app, request, post, login };
}

describe("owner API authentication", () => {
  it("rejects reusing the owner key as a read-only automation credential", () => {
    expect(() => setup({ ...ownerOptions, briefingReadToken: ownerAccessKey })).toThrow("must be distinct");
  });
  it("fails closed without configured auth, including a fake runtime", async () => {
    const { request } = setup({});
    expect((await request("/api/status")).status).toBe(503);
    expect(await (await request("/api/auth/session")).json()).toEqual({ authenticated: false, configured: false, developmentBypass: false });
    const health = await request("/healthz");
    expect(health.status).toBe(200);
    expect(health.headers.get("x-frame-options")).toBe("DENY");
    expect(health.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("protects reads, approvals, commands and checks before any side effect", async () => {
    const { request, post, rt } = setup();
    for (const path of ["/api/status", "/api/approvals", "/api/prospects", "/api/finance", "/api/dev/outbox", "/api/boxsafe/daily-briefing"]) {
      expect((await request(path)).status).toBe(401);
    }
    for (const path of ["/api/approvals/missing/decide", "/api/command", "/api/run-checks", "/api/dev/seed"]) {
      expect((await post(path, { decision: "approve", text: "call me" })).status).toBe(401);
    }
    expect(rt.fakes.mailer.sent).toHaveLength(0);
    expect(rt.fakes.telephony.calls).toHaveLength(0);
    expect(rt.atlas.approvals.list()).toHaveLength(0);
  });

  it("issues an opaque secure cookie, authenticates and revokes it on logout", async () => {
    const { login, request, post, rt } = setup();
    const { cookie, setCookie, response } = await login();
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain(ownerAccessKey);
    expect(JSON.stringify(await response.json())).not.toContain(ownerAccessKey);
    expect((await request("/api/status", { headers: { cookie } })).status).toBe(200);
    const session = await (await request("/api/auth/session", { headers: { cookie } })).json();
    expect(session.authenticated).toBe(true);
    expect((await request("/api/status", { headers: { cookie } })).headers.get("access-control-allow-origin")).toBeNull();
    const logout = await post("/api/auth/logout", {}, cookie);
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await request("/api/status", { headers: { cookie } })).status).toBe(401);
    expect(JSON.stringify(rt.atlas.audit.recent(10))).not.toContain(ownerAccessKey);
  });

  it("expires sessions on the server even when the browser keeps a cookie", async () => {
    let now = 1_000_000;
    const { login, request } = setup({ ...ownerOptions, sessionTtlMs: 1000, now: () => now });
    const { cookie } = await login();
    now += 1001;
    expect((await request("/api/status", { headers: { cookie } })).status).toBe(401);
  });

  it("rejects cross-origin and non-JSON mutations, including login and logout", async () => {
    const { login, request } = setup();
    const { cookie } = await login();
    for (const path of ["/api/auth/login", "/api/auth/logout", "/api/command", "/api/approvals/id/decide"]) {
      const body = JSON.stringify({ accessKey: ownerAccessKey, text: "approve" });
      expect((await request(path, { method: "POST", headers: { cookie, origin: "https://attacker.example.test", "content-type": "application/json" }, body })).status).toBe(403);
      expect((await request(path, { method: "POST", headers: { cookie, "content-type": "application/json" }, body })).status).toBe(403);
      expect((await request(path, { method: "POST", headers: { cookie, origin, "content-type": "text/plain" }, body })).status).toBe(415);
    }
    expect((await request("/api/status", { headers: { cookie } })).status).toBe(200);
  });

  it("limits failed login attempts without trusting client forwarding headers", async () => {
    let now = 1_000_000;
    const { post } = setup({ ...ownerOptions, now: () => now });
    for (let attempt = 0; attempt < 8; attempt++) expect((await post("/api/auth/login", { accessKey: "wrong" })).status).toBe(401);
    const blocked = await post("/api/auth/login", { accessKey: ownerAccessKey });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    now += 15 * 60_000 + 1;
    expect((await post("/api/auth/login", { accessKey: ownerAccessKey })).status).toBe(200);
  });

  it("accepts the dedicated token only for the redacted read-only briefing", async () => {
    const { request, post } = setup({ ...ownerOptions, briefingReadToken });
    const headers = { authorization: `Bearer ${briefingReadToken}` };
    const briefingResponse = await request("/api/boxsafe/daily-briefing", { headers });
    expect(briefingResponse.status).toBe(200);
    const briefing = await briefingResponse.json();
    expect(briefing.mode).toBe("fake");
    expect(briefing.spoken).toMatch(/fictional/i);
    expect(briefing.dataNotice).toMatch(/fictional/i);
    expect(JSON.stringify(briefing)).not.toMatch(/customerEmail|guest_email|customerName/);
    expect((await request("/api/status", { headers })).status).toBe(401);
    expect((await request("/api/boxsafe/daily-briefing", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await request("/api/command", { method: "POST", headers: { ...headers, origin, "content-type": "application/json" }, body: JSON.stringify({ text: "approve" }) })).status).toBe(401);
    expect((await post("/api/auth/login", { accessKey: briefingReadToken })).status).toBe(401);
  });

  it("allows the explicit fake bypass only after server loopback binding is confirmed", async () => {
    const rt = buildRuntime({ ATLAS_MODE: "fake" });
    const options: OwnerAuthOptions = { allowInsecureLocalFake: true };
    expect((await createApp(rt, options).request("/api/status")).status).toBe(503);
    expect((await createApp(rt, { ...options, localOnlyServer: true }).request("/api/status")).status).toBe(200);
    expect((await createApp({ ...rt, mode: "live" }, { ...options, localOnlyServer: true }).request("/api/status")).status).toBe(503);
  });
});

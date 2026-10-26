import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { buildRuntime, type Runtime } from "./runtime.js";
import { installOwnerAuth } from "./auth.js";
import { installWebsiteRoutes, WebsiteConnections, type WebsiteConnectionsOptions } from "./websites.js";

const key = "lov_fictional_test_key_not_a_real_credential", ownerKey = "fictional-website-owner-key-".repeat(3);
const workspaceId = "workspace_fictional_1", projectId = "project_fictional_1", origin = "https://jarvis.example.test";
const runtimes: Runtime[] = [];
function response(data: unknown[], more = false) { return Response.json({ data, pagination: { has_more: more, next_cursor: more ? "opaque-fictional-cursor" : null } }); }
function provider() {
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.pathname === "/v1/workspaces") return response([{ id: workspaceId, name: "Example workspace (fictional)", plan: "business" }]);
    if (u.pathname === "/v1/projects") return response([{ id: projectId, name: "Example site (fictional)", is_published: true, workspace_id: workspaceId, last_edited_at: "2026-10-26T08:00:00Z", owner_id: "not-exposed", latest_screenshot_url: "https://do-not-fetch.example.test/image.png" }]);
    throw new Error("Unexpected provider URL");
  });
}
function setup(options: Partial<WebsiteConnectionsOptions> = {}) {
  const rt = buildRuntime({ ATLAS_MODE: "fake" }); runtimes.push(rt);
  const request = provider();
  const service = new WebsiteConnections({ atlas: rt.atlas, mode: "live", ownerAccessKey: ownerKey, request: request as typeof fetch, ...options });
  return { rt, request, service };
}
afterEach(() => { for (const rt of runtimes.splice(0)) rt.atlas.deps.store.close(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("private website connections", () => {
  it("starts disconnected and reading status never contacts a provider", () => {
    const { service, request } = setup();
    expect(service.snapshot()).toMatchObject({ mode: "live", lovable: { state: "not_connected", projects: [], capabilities: { readProjects: true, editCode: false, publish: false } }, sites: [] });
    service.snapshot(); expect(request).not.toHaveBeenCalled();
  });
  it("verifies only the two official read endpoints and encrypts the key without exposing private provider fields", async () => {
    const { service, rt, request } = setup(); await service.connect({ apiKey: key });
    const snapshot = service.snapshot();
    expect(snapshot.lovable.state).toBe("connected"); expect(snapshot.lovable.projects).toHaveLength(1);
    expect(snapshot.lovable.projects[0]).toEqual({ id: projectId, name: "Example site (fictional)", editorUrl: `https://lovable.dev/projects/${projectId}`, isPublished: true, lastEditedAt: "2026-10-26T08:00:00Z" });
    for (const [url, init] of request.mock.calls) {
      expect(new URL(String(url)).origin).toBe("https://api.lovable.dev"); expect(init?.method).toBe("GET"); expect(init?.redirect).toBe("error");
      expect(init?.headers).toMatchObject({ "Lovable-API-Key": key, "Lovable-Version": "2026-09-11", Accept: "application/json" }); expect(init?.body).toBeUndefined();
    }
    expect(new URL(String(request.mock.calls[1]![0])).searchParams.get("workspace_id")).toBe(workspaceId);
    expect(JSON.stringify(snapshot)).not.toContain(key); expect(JSON.stringify(snapshot)).not.toContain("not-exposed"); expect(JSON.stringify(snapshot)).not.toContain("do-not-fetch");
    expect(JSON.stringify(rt.atlas.deps.store.listMemory("websites."))).not.toContain(key);
    expect(JSON.stringify(rt.atlas.audit.recent())).not.toContain(key);
    const calls = request.mock.calls.length; service.snapshot(); service.snapshot(); expect(request).toHaveBeenCalledTimes(calls);
  });
  it("refuses malformed header keys and inadequate owner encryption before any provider call", async () => {
    const { service, request } = setup();
    for (const apiKey of ["", "lov_bad\r\nInjected: header", "wrong_prefix_secret", "lov_" + "x".repeat(1100)]) await expect(service.connect({ apiKey })).rejects.toMatchObject({ status: 400 });
    const weak = setup({ ownerAccessKey: "short" }); await expect(weak.service.connect({ apiKey: key })).rejects.toMatchObject({ status: 503 });
    expect(request).not.toHaveBeenCalled(); expect(weak.request).not.toHaveBeenCalled();
  });
  it("treats the provider credential as opaque visible ASCII, including punctuation, while blocking whitespace", async () => {
    const { service, request } = setup(); const opaque = "lov_fictional.segment/opaque=key+token";
    await service.connect({ apiKey: opaque }); expect(service.snapshot().lovable.state).toBe("connected");
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({ "Lovable-API-Key": opaque });
    const calls = request.mock.calls.length;
    for (const apiKey of ["lov_fictional key", "lov_fictional\tkey", "lov_fictional\u0080key"]) await expect(service.connect({ apiKey })).rejects.toMatchObject({ status: 400 });
    expect(request).toHaveBeenCalledTimes(calls);
  });
  it("rejects projects outside the verified workspace and reports limited pagination honestly", async () => {
    const bad = setup({ request: vi.fn(async (url) => String(url).includes("/workspaces") ? response([{ id: workspaceId, name: "Test (fictional)" }]) : response([{ id: projectId, name: "Wrong workspace (fictional)", workspace_id: "workspace_other", is_published: true }])) as typeof fetch });
    await expect(bad.service.connect({ apiKey: key })).rejects.toMatchObject({ status: 503 }); expect(bad.service.snapshot().lovable.state).toBe("not_connected");
    const truncated = setup({ request: vi.fn(async (url) => String(url).includes("/workspaces") ? response([{ id: workspaceId, name: "Test (fictional)" }]) : response([], true)) as typeof fetch });
    await truncated.service.connect({ apiKey: key }); expect(truncated.service.snapshot().lovable.truncated).toBe(true); expect(truncated.service.snapshot().lovable.detail).toContain("first fifty");
  });
  it("does not leak error bodies or save a failed connection", async () => {
    for (const status of [401, 402, 403, 429, 500]) {
      const request = vi.fn(async () => new Response(JSON.stringify({ secret: key }), { status })); const { service } = setup({ request });
      const error = await service.connect({ apiKey: key }).catch(e => e);
      expect(error.message).not.toContain(key); expect(service.snapshot().lovable.state).toBe("not_connected"); expect(request).toHaveBeenCalledOnce();
    }
  });
  it("marks failed refresh data stale and never silently keeps a connected status", async () => {
    const { service, request } = setup(); await service.connect({ apiKey: key });
    request.mockImplementation(async () => { throw new Error("provider-secret-" + key); });
    await expect(service.refresh()).rejects.toMatchObject({ status: 503 });
    const snapshot = service.snapshot(); expect(snapshot.lovable.state).toBe("error"); expect(snapshot.lovable.projects).toHaveLength(1); expect(snapshot.lovable.detail).toContain("may be stale"); expect(JSON.stringify(snapshot)).not.toContain(key);
  });
  it("cannot resurrect a connection that was disconnected while initial verification was in progress", async () => {
    let release!: (value: Response) => void;
    const request = vi.fn().mockImplementationOnce(() => new Promise<Response>(r => { release = r; })).mockResolvedValue(response([]));
    const { service } = setup({ request }); const connecting = service.connect({ apiKey: key }); service.disconnect();
    release(response([{ id: workspaceId, name: "Test (fictional)" }]));
    await expect(connecting).rejects.toMatchObject({ status: 409 }); expect(service.snapshot().lovable.state).toBe("not_connected"); expect(request).toHaveBeenCalledOnce();
  });
  it("cannot resurrect cached projects when refresh finishes after disconnect", async () => {
    const { service, request } = setup(); await service.connect({ apiKey: key }); let release!: (value: Response) => void;
    request.mockImplementationOnce(() => new Promise<Response>(r => { release = r; }));
    const refreshing = service.refresh(); service.disconnect(); release(response([{ id: workspaceId, name: "Test (fictional)" }]));
    await expect(refreshing).rejects.toMatchObject({ status: 409 }); expect(service.snapshot().lovable.projects).toHaveLength(0); expect(request).toHaveBeenCalledTimes(3);
  });
  it("retains encrypted credentials across restart and fails closed with another owner key", async () => {
    const { service, rt, request } = setup(); await service.connect({ apiKey: key });
    const restarted = new WebsiteConnections({ atlas: rt.atlas, mode: "live", ownerAccessKey: ownerKey, request: request as typeof fetch });
    expect(restarted.snapshot().lovable.state).toBe("connected");
    const wrong = new WebsiteConnections({ atlas: rt.atlas, mode: "live", ownerAccessKey: "different-fictional-owner-key-".repeat(3), request: request as typeof fetch });
    expect(wrong.snapshot().lovable.state).toBe("error"); expect(request).toHaveBeenCalledTimes(2);
  });
  it("rejects invalid/oversized provider metadata without returning supplied secrets", async () => {
    for (const r of [new Response("<html>" + key, { headers: { "Content-Type": "text/html" } }), Response.json({ data: [], pagination: {} }), response(Array.from({ length: 51 }, () => ({ id: workspaceId, name: "Example (fictional)" }))), new Response("a".repeat(513 * 1024), { headers: { "Content-Type": "application/json" } })]) {
      const { service } = setup({ request: vi.fn(async () => r) }); const error = await service.connect({ apiKey: key }).catch(e => e);
      expect(error.status).toBe(503); expect(error.message).not.toContain(key);
    }
  });
  it("rejects provider metadata that echoes the credential rather than returning it in status", async () => {
    const { service } = setup({ request: vi.fn(async url => String(url).includes("/workspaces") ? response([{ id: workspaceId, name: key }]) : response([])) as typeof fetch });
    const error = await service.connect({ apiKey: key }).catch(e => e);
    expect(error.status).toBe(503); expect(error.message).not.toContain(key); expect(JSON.stringify(service.snapshot())).not.toContain(key);
  });
  it("fails closed on a redirect without sending credentials to its target", async () => {
    const request = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 302, headers: { Location: "https://untrusted.example.test/collect" } })); const { service } = setup({ request });
    await expect(service.connect({ apiKey: key })).rejects.toMatchObject({ status: 503 });
    expect(request).toHaveBeenCalledOnce(); expect(new URL(String(request.mock.calls[0]?.[0])).origin).toBe("https://api.lovable.dev");
  });
  it("bounds a provider that never resolves a request without automatic retry", async () => {
    vi.useFakeTimers(); const request = vi.fn(() => new Promise<Response>(() => {})); const { service } = setup({ request });
    const done = expect(service.connect({ apiKey: key })).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(12_001); await done; expect(request).toHaveBeenCalledOnce();
  });
  it("bounds a stalled body even when an injected transport does not implement AbortSignal", async () => {
    vi.useFakeTimers(); const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"data":')); } });
    const request = vi.fn(async () => new Response(stream, { headers: { "Content-Type": "application/json" } })); const { service } = setup({ request });
    const done = expect(service.connect({ apiKey: key })).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(12_001); await done; expect(request).toHaveBeenCalledOnce();
  });
  it("registers real-shaped public site references without fetching or confusing reference with control", () => {
    const { service, request } = setup();
    const site = service.addSite({ name: "Public site (fictional fixture)", url: "https://www.example.com/", lovableProjectId: projectId, repoUrl: "https://github.com/fictional/site" });
    expect(site.check.state).toBe("unchecked"); expect(site.fixture).toBe(false); expect(request).not.toHaveBeenCalled();
    expect(service.addSite({ name: "Renamed fixture", url: site.url }).id).toBe(site.id); expect(service.snapshot().sites).toHaveLength(1);
    for (const url of ["http://example.com", "https://127.0.0.1/", "https://localhost/", "https://service.internal/", "https://example.com/?token=secret", "https://user:pass@example.com", "https://bad.example.test"]) expect(() => service.addSite({ name: "Bad fixture", url })).toThrow();
    expect(() => service.addSite({ name: "Bad fixture", url: "https://example.com/", repoUrl: "https://github.com/login?token=secret" })).toThrow();
  });
  it("checks public availability only through the existing safe website adapter and sanitises failures", async () => {
    const { service, rt, request } = setup(); const check = vi.spyOn(rt.atlas.deps.websiteChecker, "check").mockResolvedValue({ reachable: true, status: 200, title: "Source <script> text", checkedAt: "2026-10-26T08:00:00Z" });
    const site = service.addSite({ name: "Public site fixture", url: "https://example.com/" }); await service.checkSite(site.id);
    expect(check).toHaveBeenCalledExactlyOnceWith("https://example.com/"); expect(service.snapshot().sites[0]?.check).toMatchObject({ state: "reachable", status: 200 }); expect(request).not.toHaveBeenCalled();
    check.mockRejectedValue(new Error(key)); await service.checkSite(site.id); expect(service.snapshot().sites[0]?.check.state).toBe("error"); expect(JSON.stringify(service.snapshot())).not.toContain(key);
  });
  it("never makes a provider or website request in fictional mode", async () => {
    const { service, rt, request } = setup({ mode: "fake" }); const check = vi.spyOn(rt.atlas.deps.websiteChecker, "check");
    await expect(service.connect({ apiKey: key })).rejects.toMatchObject({ status: 409 }); await service.refresh();
    const site = service.addSite({ name: "Fictional site (fictional)", url: "https://site.example.test/" }); await service.checkSite(site.id);
    expect(service.snapshot().lovable.state).toBe("fake"); expect(service.snapshot().sites[0]?.check.state).toBe("fake"); expect(site.fixture).toBe(true); expect(request).not.toHaveBeenCalled(); expect(check).not.toHaveBeenCalled();
  });
  it("exposes website routes only behind owner auth and same-origin JSON mutations", async () => {
    const { service, rt } = setup(); const app = new Hono();
    installOwnerAuth(app, rt, { publicOrigin: origin, ownerAccessKey: ownerKey }); installWebsiteRoutes(app, service);
    expect((await app.request(origin + "/api/websites")).status).toBe(401);
    const login = await app.request(origin + "/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ accessKey: ownerKey }) });
    const cookie = /__Host-atlas_session=[a-f0-9]{64}/.exec(login.headers.get("set-cookie") ?? "")![0];
    const post = (path: string, body: unknown) => app.request(origin + path, { method: "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await app.request(origin + "/api/websites/lovable/connect", { method: "POST", headers: { Cookie: cookie, Origin: "https://untrusted.example.test", "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: key }) })).status).toBe(403);
    expect((await post("/api/websites/lovable/connect", { apiKey: key })).status).toBe(200);
    const siteResponse = await post("/api/websites/sites", { name: "Example fixture", url: "https://example.com/" }); expect(siteResponse.status).toBe(200); expect((await siteResponse.json()).sites).toHaveLength(1);
    expect((await post("/api/websites/lovable/disconnect", { token: "unexpected" })).status).toBe(400);
    expect((await post("/api/websites/lovable/disconnect", {})).status).toBe(200); expect(service.snapshot().lovable.state).toBe("not_connected");
    expect((await post("/api/websites/sites/unknown/check", {})).status).toBe(404);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { buildRuntime, type Runtime } from "./runtime.js";
const origin = "https://jarvis.example.test", key = "fictional-owner-key-".repeat(3);
const runtimes: Runtime[] = [];
async function setup() {
  const rt = buildRuntime({ ATLAS_MODE: "fake", ATLAS_PUBLIC_ORIGIN: origin }); runtimes.push(rt);
  const app = createApp(rt, { ownerAccessKey: key, publicOrigin: origin });
  const login = await app.request(origin + "/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ accessKey: key }) });
  const cookie = /__Host-atlas_session=[a-f0-9]{64}/.exec(login.headers.get("set-cookie") ?? "")![0];
  const post = (path: string, value: unknown) => app.request(origin + path, { method: "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(value) });
  const get = (path: string) => app.request(origin + path, { headers: { Cookie: cookie } });
  return { rt, app, cookie, post, get };
}
const leadInput = { businessName: "Boundary Works (fictional)", industry: "Fencing", location: "Berwick (fictional test)", sourceUrl: "https://boundary.example.test/", website: "https://boundary.example.test/", observation: "Fictional test source for a safe API concept.", services: ["Fencing"], contactEmail: "owner@boundary.example.test" };
async function prepare(s: Awaited<ReturnType<typeof setup>>) { const response = await s.post("/api/acquisition/leads", leadInput); expect(response.status).toBe(200); const snapshot = await response.json(); const record = snapshot.records[0]; const prepared = await s.post(`/api/acquisition/leads/${record.id}/prepare`, {}); expect(prepared.status).toBe(200); return (await prepared.json()).records[0]; }
afterEach(() => { runtimes.splice(0).forEach(rt => rt.atlas.deps.store.close()); vi.unstubAllGlobals(); });
describe("private acquisition and scoped public concepts", () => {
  it("protects owner records, HTML previews, mutations and OAuth initiation", async () => {
    const s = await setup();
    for (const path of ["/api/acquisition", "/api/acquisition/demos/unknown/preview", "/api/acquisition/google/setup", "/api/acquisition/mail/providers", "/api/acquisition/mail/setup?provider=resend", "/api/owner-updates"]) expect((await s.app.request(origin + path)).status).toBe(401);
    expect((await s.app.request(origin + "/api/acquisition/leads", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(leadInput) })).status).toBe(401);
    expect((await s.app.request(origin + "/api/acquisition/google/link", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await s.app.request(origin + "/api/acquisition/leads", { method: "POST", headers: { Cookie: s.cookie, "Content-Type": "application/json" }, body: JSON.stringify(leadInput) })).status).toBe(403);
    expect((await s.app.request(origin + "/integrations/google/callback?code=forged&state=forged")).status).toBe(403);
  });
  it("allows explicit non-Google sender selection and private branding preparation without sending", async () => {
    const s = await setup(); const request = vi.fn().mockRejectedValue(new Error("No provider call expected")); vi.stubGlobal("fetch", request);
    const catalogue = await (await s.get("/api/acquisition/mail/providers")).json();
    expect(catalogue.selected).toBe("gmail"); expect(catalogue.providers.map((p: any) => p.id)).toContain("resend");
    expect((await s.post("/api/acquisition/mail/provider", { provider: "resend" })).status).toBe(200);
    expect(s.rt.mailProviders.selected()).toBe("resend");
    expect((await s.post("/api/acquisition/mail/provider", { provider: "smtp", token: "not-accepted" })).status).toBe(400);
    const record = await prepare(s);
    const enriched = await s.post(`/api/acquisition/leads/${record.id}/enrich`, { refresh: true });
    expect(enriched.status).toBe(200); const next = (await enriched.json()).records[0];
    expect(next.demo.publicPath).toBeNull(); expect(next.contact.basis).toBe("none_established");
    expect((await s.post(`/api/acquisition/leads/${record.id}/enrich`, { refresh: "yes", approved: true })).status).toBe(400);
    const guide = await s.get("/api/acquisition/mail/setup?provider=resend"); expect(guide.status).toBe(200); expect(await guide.text()).toContain("RESEND_API_KEY");
    const updates = await (await s.get("/api/owner-updates")).json(); expect(updates.settings.emailEnabled).toBe(false); expect(updates.settings.messageEnabled).toBe(false);
    expect(s.rt.fakes.mailer.sent).toHaveLength(0); expect(request).not.toHaveBeenCalled();
  });
  it("prepares private real HTML and drafts while sender is disconnected, without publish or send", async () => {
    const s = await setup(); const record = await prepare(s);
    expect(record.draft.status).toBe("blocked"); expect(record.demo.publicPath).toBeNull();
    expect(record.contact.basis).toBe("none_established"); expect(s.rt.fakes.mailer.sent).toHaveLength(0);
    const preview = await s.get(record.demo.previewPath);
    expect(preview.status).toBe(200); expect(preview.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'"); expect(preview.headers.get("Content-Security-Policy")).toContain("script-src 'none'"); expect(preview.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    const html = await preview.text(); expect(html).toContain("FICTIONAL TEST RECORD"); expect(html).toContain("Boundary Works"); expect(html).not.toContain("<form");
    const attempted = await s.post(`/api/acquisition/leads/${record.id}/approve-send`, { expectedHash: record.draft.contentHash }); expect(attempted.status).toBe(409); expect(s.rt.fakes.mailer.sent).toHaveLength(0);
  });
  it("publishes only an exact owner-approved concept and makes revocation effective", async () => {
    const s = await setup(); const record = await prepare(s);
    const stale = await s.post(`/api/acquisition/leads/${record.id}/publish`, { expectedHtmlHash: "a".repeat(64) }); expect(stale.status).toBe(409);
    const response = await s.post(`/api/acquisition/leads/${record.id}/publish`, { expectedHtmlHash: record.demo.htmlHash }); expect(response.status).toBe(200);
    const current = (await response.json()).records[0]; expect(current.demo.publicPath).toMatch(/^\/demos\/[A-Za-z0-9_-]+$/);
    const publicResponse = await s.app.request(origin + current.demo.publicPath); expect(publicResponse.status).toBe(200); expect(publicResponse.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'"); expect(publicResponse.headers.get("X-Robots-Tag")).toContain("noindex"); expect(publicResponse.headers.get("Set-Cookie")).toBeNull();
    expect(s.rt.atlas.approvals.list().some(a => a.action === "approve.production_deploy" && a.status === "consumed")).toBe(true);
    await s.post(`/api/acquisition/leads/${record.id}/revoke`, {}); expect((await s.app.request(origin + current.demo.publicPath)).status).toBe(404);
  });
  it("serves a real unsubscribe confirmation and persists global suppression without owner login", async () => {
    const s = await setup(); const record = await prepare(s);
    const url = /https:\/\/[^\s]+\/unsubscribe\/[A-Za-z0-9_-]+/.exec(record.draft.text)![0];
    const before = await s.app.request(url); expect(before.status).toBe(200); expect(await before.text()).not.toContain(leadInput.contactEmail);
    const response = await s.app.request(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }); expect(response.status).toBe(200); expect(await response.text()).toContain("unsubscribed");
    const snapshot = await (await s.get("/api/acquisition")).json(); expect(snapshot.records[0].draft.status).toBe("cancelled");
    expect((await s.app.request(origin + "/unsubscribe/invalid")).status).toBe(404);
  });
  it("rejects forged authority fields and invalid JSON rather than accepting source instructions", async () => {
    const s = await setup();
    expect((await s.post("/api/acquisition/leads", { ...leadInput, approved: true })).status).toBe(400);
    expect((await s.post("/api/acquisition/sender", { name: "Owner", organisation: "Studio", email: "owner@example.test", contactDetails: "reply", providerToken: "secret" })).status).toBe(400);
    expect((await s.post("/api/acquisition/discover", { area: "Berwick", count: 100 })).status).toBe(400);
    const response = await s.app.request(origin + "/api/acquisition/leads", { method: "POST", headers: { Origin: origin, Cookie: s.cookie, "Content-Type": "application/json" }, body: "{" }); expect(response.status).toBe(400);
  });
  it("runs fictional discovery through the real workflow and voice commands never bypass exact email review", async () => {
    const s = await setup(); const found = await s.post("/api/command", { text: "Jarvis, find three companies near Berwick and create demos" }); expect(found.status).toBe(200); expect((await found.json()).reply).toContain("3");
    const records = (await (await s.get("/api/acquisition")).json()).records; expect(records).toHaveLength(3); expect(records.every((r: any) => r.demo && r.draft)).toBe(true);
    const send = await s.post("/api/command", { text: "Jarvis, send emails to those companies" }); const result = await send.json(); expect(result.outcome).toBe("awaiting_approval"); expect(s.rt.fakes.mailer.sent).toHaveLength(0);
    expect((await s.post("/api/acquisition/google/link", {})).status).toBe(503);
  });
});

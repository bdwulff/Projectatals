import { afterEach, describe, expect, it, vi } from "vitest";
import { inflateRawSync } from "node:zlib";
import * as ts from "typescript";
import { createApp } from "./app.js";
import { buildRuntime, type Runtime } from "./runtime.js";

const origin = "https://jarvis.example.test";
const ownerKey = "fictional-site-rebuild-owner-key-".repeat(2);
const privateToken = "fictional-provider-token-never-in-public-code";
const created: Runtime[] = [];

async function setup() {
  vi.useFakeTimers();
  const network = vi.fn().mockRejectedValue(new Error("No external provider request is authorised by this integration test."));
  vi.stubGlobal("fetch", network);
  const rt = buildRuntime({ ATLAS_MODE: "fake", ATLAS_PUBLIC_ORIGIN: origin, ATLAS_OWNER_ACCESS_KEY: ownerKey, ELEVENLABS_API_KEY: privateToken });
  created.push(rt);
  rt.acquisition.saveSender({ name: "Review Owner (fictional)", organisation: "Review Digital (fictional)", email: "hello@review.example.test", contactDetails: "Reply to hello@review.example.test" }, "Review Owner (fictional)");
  const app = createApp(rt, { ownerAccessKey: ownerKey, publicOrigin: origin });
  const request = (path: string, init: RequestInit = {}) => app.request(origin + path, init);
  const login = await request("/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ accessKey: ownerKey }) });
  expect(login.status).toBe(200);
  const cookie = /__Host-atlas_session=[a-f0-9]{64}/.exec(login.headers.get("set-cookie") ?? "")![0];
  const get = (path: string) => request(path, { headers: { Cookie: cookie } });
  const post = (path: string, body: unknown) => request(path, { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { rt, request, get, post, cookie, network };
}

function add(rt: Runtime, name: string, change: { website?: string | null; sourceUrl?: string; industry?: string } = {}) {
  return rt.acquisition.addLead({ businessName: `${name} (fictional)`, location: "Officer, Victoria", industry: change.industry ?? "Carpentry and outdoor construction", website: change.website ?? null, sourceUrl: change.sourceUrl ?? `https://www.facebook.com/fictional-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, observation: "Fictional public business listing. No own website is recorded; absence has not been independently confirmed.", services: ["Timber screens", "Outdoor decks"], contactEmail: `owner@${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.example.test` });
}

async function run(s: Awaited<ReturnType<typeof setup>>) {
  const response = await s.post("/api/site-rebuilds/run", {});
  expect(response.status).toBe(200);
  await vi.runAllTimersAsync();
  const snapshot = await (await s.get("/api/site-rebuilds")).json();
  expect(["completed", "partial"]).toContain(snapshot.latestReport?.state);
  return snapshot;
}

function unzip(zip: Buffer): Record<string, string> {
  const files: Record<string, string> = {};
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const compressed = zip.readUInt32LE(offset + 18), expanded = zip.readUInt32LE(offset + 22);
    const nameLength = zip.readUInt16LE(offset + 26), extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    expect(name).not.toMatch(/(^|\/)\.\.(\/|$)|^\//);
    expect(files[name]).toBeUndefined();
    const data = inflateRawSync(zip.subarray(start, start + compressed));
    expect(data.length).toBe(expanded);
    files[name] = data.toString("utf8"); offset = start + compressed;
  }
  expect(zip.readUInt32LE(offset)).toBe(0x02014b50);
  expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  return files;
}

afterEach(() => {
  vi.clearAllTimers();
  for (const rt of created.splice(0)) rt.atlas.deps.store.close();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("owner-only immersive rebuild integration", () => {
  it("requires owner authentication and same-origin JSON and refuses send/publication fields", async () => {
    const s = await setup();
    expect((await s.request("/api/site-rebuilds")).status).toBe(401);
    expect((await s.request("/api/site-rebuilds/run", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await s.request("/api/site-rebuilds/run", { method: "POST", headers: { Cookie: s.cookie, Origin: "https://foreign.example.test", "Content-Type": "application/json" }, body: "{}" })).status).toBe(403);
    expect((await s.request("/api/site-rebuilds/run", { method: "POST", headers: { Cookie: s.cookie, Origin: origin, "Content-Type": "text/plain" }, body: "{}" })).status).toBe(415);
    expect((await s.post("/api/site-rebuilds/run", { sendEmails: true, publish: true })).status).toBe(400);
    expect(s.rt.atlas.jobs.list()).toHaveLength(0);
    expect(s.network).not.toHaveBeenCalled();
  });

  it("rebuilds all eligible recorded prospects, preserves edited drafts and leaves unrelated send jobs queued", async () => {
    const s = await setup();
    const first = add(s.rt, "Boundary Timber"), second = add(s.rt, "Evening Movement", { industry: "Pilates and movement studio" });
    const old = s.rt.acquisition.prepare(first.id, { templateId: "clarity" });
    const edited = s.rt.acquisition.saveDraft(old.id, { expectedHash: old.draft!.contentHash, subject: "My personally reviewed introduction", text: old.draft!.text + "\nA note that I wrote myself and want preserved." });
    const oldLink = /https:\/\/jarvis\.example\.test\/demos\/[A-Za-z0-9_-]+/.exec(edited.draft!.text)![0];
    const unrelatedSend = vi.fn();
    s.rt.atlas.jobs.register("unrelated_send_probe", unrelatedSend);
    s.rt.atlas.jobs.enqueue("unrelated_send_probe", {}, { idempotencyKey: "fictional-unrelated-send" });
    const before = s.rt.atlas.prospects.list().length;
    const snapshot = await run(s), report = snapshot.latestReport;
    expect(report.targetCount).toBe(2); expect(report.rebuiltCount).toBe(2);
    expect(report.businesses.filter((row: any) => row.state === "ready").map((row: any) => row.leadId).sort()).toEqual([first.id, second.id].sort());
    expect(s.rt.atlas.prospects.list()).toHaveLength(before);
    const current = (await s.rt.acquisition.snapshot()).records.find(record => record.id === first.id)!;
    expect(current.demo?.templateId).toBe("immersive"); expect(current.demo?.publicPath).toBeNull();
    expect(current.draft?.subject).toBe(edited.draft?.subject);
    expect(current.draft?.text).toContain("A note that I wrote myself and want preserved.");
    expect(current.draft?.text).not.toContain(oldLink);
    expect(current.draft?.contentHash).not.toBe(edited.draft?.contentHash);
    expect(s.rt.atlas.jobs.list().find(job => job.idempotencyKey === "fictional-unrelated-send")?.status).toBe("queued");
    expect(unrelatedSend).not.toHaveBeenCalled(); expect(s.rt.fakes.mailer.sent).toHaveLength(0);
    expect(s.rt.atlas.quotes.list()).toHaveLength(0); expect(s.network).not.toHaveBeenCalled();
  });

  it("excludes an owned website even when acquisition metadata is null and excludes customers/suppression/unsafe states", async () => {
    const s = await setup();
    const eligible = add(s.rt, "Sourced Social Business");
    add(s.rt, "Find Local Plumbers Near Me", { sourceUrl: "https://www.yellowpages.com.au/search/plumbers/officer", industry: "Plumbing search results" });
    const owned = add(s.rt, "Owned Website Business", { website: "https://owned-business.example.com", sourceUrl: "https://owned-business.example.com/about" });
    const contradictory = s.rt.atlas.deps.store.getDoc<any>("acquisition_records", owned.id)!.doc;
    contradictory.website = null; s.rt.atlas.deps.store.upsertDoc("acquisition_records", owned.id, contradictory);
    const customer = add(s.rt, "Already A Customer"), suppressed = add(s.rt, "Do Not Contact"), queued = add(s.rt, "Queued Submission"), uncertain = add(s.rt, "Uncertain Submission");
    const customerProspect = s.rt.atlas.prospects.require(customer.prospectId);
    customerProspect.stage = "accepted"; s.rt.atlas.deps.store.upsertDoc("prospects", customerProspect.id, customerProspect);
    s.rt.atlas.prospects.suppress(suppressed.prospectId, "Fictional do-not-contact request.");
    for (const [record, status] of [[queued, "queued"], [uncertain, "uncertain"]] as const) {
      const prepared = s.rt.acquisition.prepare(record.id);
      prepared.draft!.status = status; s.rt.atlas.deps.store.upsertDoc("acquisition_records", prepared.id, prepared);
    }
    const snapshot = await run(s);
    expect(snapshot.latestReport.targetCount).toBe(1);
    expect(snapshot.latestReport.businesses[0].leadId).toBe(eligible.id);
    expect(snapshot.latestReport.spokenSummary).not.toMatch(/confirmed (?:no|without) website/i);
    expect(snapshot.latestReport.businesses[0].classificationLabel).toMatch(/recorded|social|directory/i);
    expect(s.rt.fakes.mailer.sent).toHaveLength(0); expect(s.network).not.toHaveBeenCalled();
  });

  it("creates one truthful owner notification containing the actual review list and deduplicates a repeated batch", async () => {
    const s = await setup();
    const first = add(s.rt, "Listed Timber"), second = add(s.rt, "Listed Movement", { industry: "Pilates" });
    add(s.rt, "Excluded Existing Site", { website: "https://excluded-site.example.com", sourceUrl: "https://excluded-site.example.com" });
    const snapshot = await run(s), report = snapshot.latestReport;
    const notification = s.rt.atlas.notifications.list().find(item => item.id === report.notificationId);
    expect(notification).toBeDefined();
    expect(notification?.body).toContain(first.businessName); expect(notification?.body).toContain(second.businessName);
    expect(notification?.body).not.toContain("Excluded Existing Site");
    expect(notification?.body).toContain("#pipeline");
    expect(notification?.deliveries.some(delivery => delivery.channel === "dashboard")).toBe(true);
    expect(notification?.deliveries).not.toEqual(expect.arrayContaining([expect.objectContaining({ channel: "email" })]));
    expect(report.fixture).toBe(true); expect(report.spokenSummary).toMatch(/fictional/i);
    const hash = (await s.rt.acquisition.snapshot()).records.find(record => record.id === first.id)!.demo!.htmlHash;
    const repeated = await run(s);
    expect(repeated.latestReport.id).toBe(report.id);
    expect((await s.rt.acquisition.snapshot()).records.find(record => record.id === first.id)!.demo!.htmlHash).toBe(hash);
    expect(s.rt.atlas.notifications.list().filter(item => item.eventKey === notification?.eventKey)).toHaveLength(1);
    expect(s.rt.fakes.mailer.sent).toHaveLength(0); expect(s.network).not.toHaveBeenCalled();
  });

  it("downloads matching editable immersive source without secrets/private links and retains the script-free preview policy", async () => {
    const s = await setup();
    const lead = add(s.rt, "Proof Timber");
    const snapshot = await run(s), row = snapshot.latestReport.businesses[0];
    expect(row.leadId).toBe(lead.id);
    const record = (await s.rt.acquisition.snapshot()).records.find(item => item.id === lead.id)!;
    const preview = await s.get(record.demo!.previewPath);
    expect(preview.status).toBe(200); expect(preview.headers.get("Content-Security-Policy")).toContain("script-src 'none'");
    const html = await preview.text(); expect(html).not.toMatch(/<script\b|<iframe\b|\bonclick=/i);
    const response = await s.get(`/api/acquisition/leads/${lead.id}/source.zip`);
    expect(response.status).toBe(200); expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const files = unzip(Buffer.from(await response.arrayBuffer())), source = Object.values(files).join("\n");
    for (const secret of [ownerKey, privateToken]) expect(source).not.toContain(secret);
    expect(source).not.toMatch(/\/demos\/[A-Za-z0-9_-]{20,}|\/unsubscribe\/[A-Za-z0-9_-]{20,}|client_secret|refresh_token|__Host-atlas_session/);
    expect(files["src/App.tsx"]).toContain(lead.businessName);
    expect(files["src/App.tsx"]).not.toMatch(/dangerouslySetInnerHTML|<iframe|srcDoc|fetch\(|XMLHttpRequest/);
    const result = ts.transpileModule(files["src/App.tsx"]!, { fileName: "App.tsx", reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } });
    expect(result.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error)).toEqual([]);
    expect(s.rt.fakes.mailer.sent).toHaveLength(0); expect(s.network).not.toHaveBeenCalled();
  });

  it("recovers a reserved generated demo after interruption before the record switch without creating a second artifact", async () => {
    const s = await setup(), lead = add(s.rt, "Restart Timber");
    const original = s.rt.acquisition.prepare(lead.id, { templateId: "clarity" });
    const edited = s.rt.acquisition.saveDraft(lead.id, { expectedHash: original.draft!.contentHash, subject: "Keep this owner subject", text: original.draft!.text + "\nKeep my owner note across restart." });
    const store = s.rt.atlas.deps.store, persist = store.upsertDoc.bind(store);
    const interrupted = vi.spyOn(store, "upsertDoc").mockImplementation((collection, id, document: any) => {
      if (collection === "acquisition_records" && document.demo?.templateId === "immersive") throw new Error("Fictional interruption before durable lead switch.");
      return persist(collection, id, document);
    });
    const options = { templateId: "immersive", preserveDraft: true, idempotencyKey: "review-restart-before-record" };
    expect(() => s.rt.acquisition.prepare(lead.id, options)).toThrow("interruption");
    interrupted.mockRestore();
    const reservation = store.listDocs<any>("acquisition_preparations")[0]!.doc;
    expect(reservation.completed).toBe(false);
    const resumed = s.rt.acquisition.prepare(lead.id, options);
    expect(resumed.demo?.id).toBe(reservation.demoId);
    expect(store.listDocs("acquisition_demos")).toHaveLength(2);
    expect(resumed.draft?.version).toBe(edited.draft!.version + 1);
    expect(resumed.draft?.subject).toBe(edited.draft?.subject);
    expect(resumed.draft?.text).toContain("Keep my owner note across restart.");
    expect(s.rt.acquisition.prepare(lead.id, options).draft?.version).toBe(resumed.draft?.version);
    expect(s.rt.fakes.mailer.sent).toHaveLength(0); expect(s.network).not.toHaveBeenCalled();
  });

  it("does not repeat a completed record switch if interrupted before its completion marker and refuses a changed source under the same key", async () => {
    const s = await setup(), lead = add(s.rt, "Completion Timber");
    const original = s.rt.acquisition.prepare(lead.id, { templateId: "clarity" });
    const store = s.rt.atlas.deps.store, persist = store.upsertDoc.bind(store);
    const interrupted = vi.spyOn(store, "upsertDoc").mockImplementation((collection, id, document: any) => {
      if (collection === "acquisition_preparations" && document.completed === true) throw new Error("Fictional interruption before completion marker.");
      return persist(collection, id, document);
    });
    const options = { templateId: "immersive", preserveDraft: true, idempotencyKey: "review-restart-after-record" };
    expect(() => s.rt.acquisition.prepare(lead.id, options)).toThrow("interruption");
    interrupted.mockRestore();
    const switched = store.getDoc<any>("acquisition_records", lead.id)!.doc;
    expect(switched.demo.templateId).toBe("immersive");
    const resumed = s.rt.acquisition.prepare(lead.id, options);
    expect(resumed.demo?.id).toBe(switched.demo.id);
    expect(resumed.draft?.version).toBe(original.draft!.version + 1);
    expect(store.listDocs("acquisition_demos")).toHaveLength(2);
    const changed = store.getDoc<any>("acquisition_records", lead.id)!.doc;
    changed.services = ["A newly verified service after the original run"];
    store.upsertDoc("acquisition_records", lead.id, changed);
    expect(() => s.rt.acquisition.prepare(lead.id, options)).toThrow(/changed/);
    expect(s.rt.fakes.mailer.sent).toHaveLength(0); expect(s.network).not.toHaveBeenCalled();
  });
});

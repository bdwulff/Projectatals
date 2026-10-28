import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AcquisitionRecord, Prospect } from "@atlas/core";
import { buildRuntime, type Runtime } from "./runtime.js";
import { classifyWebsitePresence, isBusinessListingTitle, SiteRebuilds, type SiteRebuildReport } from "./site-rebuilds.js";

const runtimes: Runtime[] = [];
const origin = "https://jarvis.example.test";
function setup(db?: string, mode: "live" | "fake" = "fake") {
  vi.useFakeTimers();
  const rt = buildRuntime({ ATLAS_MODE: "fake", ATLAS_PUBLIC_ORIGIN: origin, ATLAS_DB_PATH: db }); runtimes.push(rt);
  const now = () => new Date("2026-10-28T01:00:00Z");
  const service = new SiteRebuilds({ atlas: rt.atlas, acquisition: rt.acquisition, mode, clock: now });
  const originalPrepare = rt.acquisition.prepare.bind(rt.acquisition);
  const prepare = vi.spyOn(rt.acquisition, "prepare").mockImplementation((id, options) => {
    // Renderer implementation has its own compile/visual suites. This injected renderer never calls a provider.
    const result = originalPrepare(id, { templateId: "clarity" });
    result.demo!.templateId = "immersive";
    result.demo!.templateName = "Immersive test renderer (fictional)";
    rt.atlas.deps.store.upsertDoc("acquisition_records", result.id, result);
    return result;
  });
  return { rt, service, prepare, now };
}
function add(rt: Runtime, number: number, change: Partial<Prospect> = {}) {
  return rt.atlas.prospects.upsert({ businessName: `Example Works ${number} (fictional)`, location: "Berwick, Victoria (fictional)", industry: "Fencing trades", website: null,
    evidence: [{ id: `fictional-evidence-${number}`, observation: "Fictional directory business profile; no independent website recorded.", sourceUrl: `https://www.yellowpages.com.au/vic/berwick/example-works-${number}.html`, reviewedAt: "2026-10-28T01:00:00Z", status: "unverified", method: "search_result", uncertainty: "Search-only fixture; presence remains unverified." }],
    commercialOpportunity: "Fictional private design exercise.", recommendedScope: "Private concept only.", internalRecommendedPriceAud: null, fixture: true, ...change }).prospect;
}
async function finish(service: SiteRebuilds) {
  await vi.advanceTimersByTimeAsync(1000);
  return (await service.snapshot()).latestReport!;
}
afterEach(() => { vi.clearAllTimers(); for (const rt of runtimes.splice(0)) rt.atlas.deps.store.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("website-presence classification", () => {
  it("never treats a missing URL as confirmed absence and lets either own-site field win", () => {
    expect(classifyWebsitePresence({ websites: [null, undefined], evidence: [] })).toBe("not_recorded");
    expect(classifyWebsitePresence({ websites: [null, "https://example.com"], evidence: [] })).toBe("own_site");
    expect(classifyWebsitePresence({ websites: ["https://example.com", null], evidence: [] })).toBe("own_site");
    expect(classifyWebsitePresence({ websites: [null], evidence: [{ sourceUrl: "https://example.com/contact" }] })).toBe("unknown");
  });

  it("recognises social/directory pages with host boundaries and does not confuse named domains", () => {
    for (const url of ["https://facebook.com/exampleworks", "https://www.instagram.com/exampleworks", "https://www.yellowpages.com.au/vic/exampleworks", "https://www.google.com/maps/place/Example"]) {
      expect(classifyWebsitePresence({ websites: [url], evidence: [] })).toBe("social_only");
    }
    expect(classifyWebsitePresence({ websites: ["https://facebook.com.attacker.example.com"], evidence: [] })).toBe("own_site");
    expect(classifyWebsitePresence({ websites: ["https://myyellowpages.com.au"], evidence: [] })).toBe("own_site");
    expect(classifyWebsitePresence({ websites: ["javascript:alert(1)"], evidence: [] })).toBe("unknown");
    expect(classifyWebsitePresence({ websites: ["https://127.0.0.1"], evidence: [] })).toBe("unknown");
    expect(classifyWebsitePresence({ websites: ["https://user:secret@example.com"], evidence: [] })).toBe("unknown");
  });

  it("excludes category, vacancy and government listings without rejecting normal company names", () => {
    for (const name of ["Fencing Contractors in Pakenham", "Businesses for Sale", "FitnessJobs", "Top 10 Plumbing Companies", "Local Council", "Job Vacancies"]) expect(isBusinessListingTitle(name)).toBe(true);
    for (const name of ["Job's Plumbing", "Best Fencing Pty Ltd", "Officer Car Care", "Example Fencing (fictional)"]) expect(isBusinessListingTitle(name)).toBe(false);
  });
});

describe("private no-own-website rebuild batches", () => {
  it("rebuilds every matching business beyond the daily discovery count and creates a review notification", async () => {
    const s = setup(); for (let i = 0; i < 7; i++) add(s.rt, i);
    const search = vi.spyOn(s.rt.atlas, "researchProspects"), enrich = vi.spyOn(s.rt.acquisition, "enrichAndPrepare"), publish = vi.spyOn(s.rt.acquisition, "publish"), send = vi.spyOn(s.rt.acquisition, "approveAndSend");
    const snapshot = await s.service.runNow(); expect(snapshot.run.state).toBe("queued"); expect(s.prepare).not.toHaveBeenCalled();
    const report = await finish(s.service);
    expect(report).toMatchObject({ state: "completed", targetCount: 7, rebuiltCount: 7, skippedCount: 0, fixture: true });
    expect(report.businesses.every(row => row.demoReady && row.previewPath?.startsWith("/api/acquisition/demos/") && row.sourcePath?.endsWith("/source.zip"))).toBe(true);
    expect(s.prepare).toHaveBeenCalledTimes(7);
    expect(s.prepare.mock.calls.every(([, options]) => options?.preserveDraft === true && Boolean(options.idempotencyKey))).toBe(true);
    expect(search).not.toHaveBeenCalled(); expect(enrich).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
    const notice = s.rt.atlas.notifications.list().find(n => n.id === report.notificationId)!;
    expect(notice.title).toContain("7 potential client demos"); expect(notice.body).toContain(report.reviewPath);
    for (const business of report.businesses) expect(notice.body).toContain(business.name);
    expect(s.rt.fakes.mailer.sent).toHaveLength(0);
  });

  it("uses exact target/profile/policy idempotency and does not rebuild unchanged generated outputs", async () => {
    const s = setup(); add(s.rt, 1);
    await s.service.runNow(); const first = await finish(s.service);
    await s.service.runNow(); await finish(s.service);
    expect((await s.service.snapshot()).latestReport?.id).toBe(first.id); expect(s.prepare).toHaveBeenCalledOnce();
    expect(s.rt.atlas.notifications.list().filter(n => n.eventKey.includes(first.id))).toHaveLength(1);
    const p = s.rt.atlas.prospects.list()[0]!; p.location = "Pakenham, Victoria (fictional)"; s.rt.atlas.deps.store.upsertDoc("prospects", p.id, p);
    await s.service.runNow(); const changed = await finish(s.service);
    expect(changed.id).not.toBe(first.id); expect(s.prepare).toHaveBeenCalledTimes(2);
  });

  it("excludes established sites, unsafe drafts, archived/suppressed/customer/fixture/category entries", async () => {
    const s = setup(undefined, "live");
    const eligible = add(s.rt, 1, { fixture: false });
    add(s.rt, 2, { fixture: false, website: "https://official.example.com" });
    add(s.rt, 3, { fixture: false, stage: "accepted" });
    add(s.rt, 4, { fixture: false, contactEligibility: { lawfulBasis: "none_established", suppressed: true } });
    add(s.rt, 5); // Fixture is never a live prospect.
    add(s.rt, 6, { fixture: false, businessName: "Fencing Contractors in Berwick" });
    const archived = add(s.rt, 7, { fixture: false }); const a = s.rt.acquisition.importExistingProspect(archived.id); a.archivedAt = s.now().toISOString(); s.rt.atlas.deps.store.upsertDoc("acquisition_records", a.id, a);
    for (const [index, status] of ["queued", "submitting", "uncertain", "accepted", "cancelled"].entries()) {
      const p = add(s.rt, index + 10, { fixture: false }), record = s.rt.acquisition.importExistingProspect(p.id); s.rt.acquisition.prepare(record.id);
      const current = s.rt.atlas.deps.store.getDoc<AcquisitionRecord>("acquisition_records", record.id)!.doc;
      current.draft!.status = status as NonNullable<AcquisitionRecord["draft"]>["status"]; s.rt.atlas.deps.store.upsertDoc("acquisition_records", current.id, current);
    }
    const mismatch = add(s.rt, 20, { fixture: false }); const m = s.rt.acquisition.importExistingProspect(mismatch.id); m.website = "https://record-only-official.example.com"; s.rt.atlas.deps.store.upsertDoc("acquisition_records", m.id, m);
    const snapshot = await s.service.snapshot(); expect(snapshot.candidates.map(row => row.prospectId)).toEqual([eligible.id]);
  });

  it("preserves owner changes made while the exact batch is queued", async () => {
    const s = setup(); const p = add(s.rt, 1); await s.service.runNow();
    p.website = "https://newly-found.example.com"; s.rt.atlas.deps.store.upsertDoc("prospects", p.id, p);
    const report = await finish(s.service); expect(report).toMatchObject({ state: "partial", rebuiltCount: 0, skippedCount: 1 }); expect(s.prepare).not.toHaveBeenCalled();
  });

  it("reports partial failures without leaking exception details or claiming delivery", async () => {
    const s = setup(); add(s.rt, 1); add(s.rt, 2);
    s.prepare.mockImplementationOnce(() => { throw new Error("provider-secret-never-persist"); });
    await s.service.runNow(); const report = await finish(s.service);
    expect(report).toMatchObject({ state: "partial", targetCount: 2, rebuiltCount: 1 });
    expect(JSON.stringify(report)).not.toContain("provider-secret-never-persist"); expect(report.spokenSummary).toContain("needs attention");
    expect(report.spokenSummary).toContain("Nothing was emailed to clients or published");
  });

  it("leaves unrelated outbound work queued while privately rebuilding", async () => {
    const s = setup(); add(s.rt, 1); const outbound = vi.fn();
    s.rt.atlas.jobs.register("outbound", outbound); s.rt.atlas.jobs.enqueue("outbound", {}, { idempotencyKey: "previous-approved-outbound", runAfter: s.now() });
    await s.service.runNow(); await finish(s.service);
    expect(outbound).not.toHaveBeenCalled(); expect(s.rt.atlas.deps.store.getJobByKey("previous-approved-outbound")?.status).toBe("queued");
  });

  it("resumes queued private work after restart without duplicating ready rows or notices", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-site-rebuild-"));
    try {
      const db = join(dir, "test.sqlite"), first = setup(db); add(first.rt, 1); add(first.rt, 2);
      const queued = await first.service.runNow(); const id = queued.latestReport!.id;
      vi.clearAllTimers(); first.rt.atlas.deps.store.close(); runtimes.splice(runtimes.indexOf(first.rt), 1);
      const restarted = setup(db); const report = await finish(restarted.service);
      expect(report.id).toBe(id); expect(report).toMatchObject({ state: "completed", rebuiltCount: 2 }); expect(restarted.prepare).toHaveBeenCalledTimes(2);
      await restarted.service.runNow(); await finish(restarted.service); expect(restarted.prepare).toHaveBeenCalledTimes(2);
      expect(restarted.rt.atlas.notifications.list().filter(n => n.eventKey.includes(id))).toHaveLength(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("retains a completed row when the process stops between private builds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-site-rebuild-cursor-"));
    try {
      const db = join(dir, "test.sqlite"), first = setup(db); add(first.rt, 1); add(first.rt, 2);
      const queued = await first.service.runNow();
      await vi.advanceTimersByTimeAsync(20);
      const interrupted = (await first.service.snapshot()).latestReport!;
      expect(interrupted.state).toBe("running");
      expect(interrupted.businesses.filter(row => row.state === "ready")).toHaveLength(1);
      const completedPath = interrupted.businesses.find(row => row.state === "ready")!.previewPath;
      vi.clearAllTimers(); first.rt.atlas.deps.store.close(); runtimes.splice(runtimes.indexOf(first.rt), 1);
      const restarted = setup(db); const report = await finish(restarted.service);
      expect(report.id).toBe(queued.latestReport!.id); expect(report).toMatchObject({ state: "completed", rebuiltCount: 2 });
      expect(restarted.prepare).toHaveBeenCalledOnce();
      expect(report.businesses.some(row => row.previewPath === completedPath)).toBe(true);
      expect(restarted.rt.atlas.notifications.list().filter(n => n.eventKey.includes(report.id))).toHaveLength(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("honestly reports an empty eligible set and does not expose stored fingerprints", async () => {
    const s = setup(); add(s.rt, 1, { website: "https://official.example.com" });
    await s.service.runNow(); const report = await finish(s.service);
    expect(report).toMatchObject({ state: "completed", targetCount: 0, rebuiltCount: 0 });
    expect(report.spokenSummary).toContain("No eligible existing prospects"); expect(JSON.stringify(report)).not.toContain("fingerprints"); expect(s.prepare).not.toHaveBeenCalled();
  });
});

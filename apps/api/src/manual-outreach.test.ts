import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { Atlas, SqliteStore, fake, type AcquisitionRecord, type Prospect } from "@atlas/core";
import { ManualOutreach, installManualOutreachRoutes } from "./manual-outreach.js";
import { ProspectPricing } from "./prospect-pricing.js";
import type { DiscoveryProgram } from "./discovery-program.js";
import { installOwnerAuth } from "./auth.js";
import type { Runtime } from "./runtime.js";
import { noWebsiteQualificationKey } from "./no-website-research.js";

const stores: SqliteStore[] = [], dirs: string[] = [];
const origin = "https://jarvis.example.test", start = "2026-10-30T00:00:00Z";
const preview = "https://preview.example.test/concepts/fictional-reviewed-preview";
const source = "https://directory.example.test/fictional-cleaning";
function bundle(change: Record<string, unknown> = {}) {
  const draft = (subject: string) => ({ subject, text: `Hi Fictional Works team,\n\nA fictional source-specific draft. View the illustrative preview: ${preview}\n\nWhich service would you lead with?\n\nFictional owner\nTo stop future emails, reply unsubscribe.` });
  return { version: 1, generatedAt: start, prospects: [{ businessName: "Fictional Works (fictional)", location: "Berwick, Victoria", industry: "Fictional cleaning", contactEmail: "owner@fictional.example.test", sourceUrl: source, observation: "Fictional published listing describes domestic cleaning.", opportunity: "Explain the cleaning services and make requesting a quote simple.", checkedAt: start, previewUrl: preview, previewExpiresAt: "2027-01-01T00:00:00Z", eligible: true, holdReason: null, reviewFlags: ["Fictional test; review relevance before composing."], initial: draft("Initial fictional draft"), followUp1: draft("First useful fictional follow-up"), followUp2: draft("Second useful fictional follow-up"), fixture: true, ...change }] };
}
function setup(options: { dbPath?: string; seed?: unknown; seedPath?: string; mode?: "live" | "fake"; noSeed?: boolean } = {}) {
  let at = new Date(start);
  const dir = mkdtempSync(join(tmpdir(), "atlas-manual-outreach-")); dirs.push(dir);
  const seedPath = options.seedPath ?? join(dir, "private-seed.json");
  if (!options.noSeed && !options.seedPath) writeFileSync(seedPath, JSON.stringify(options.seed ?? bundle()));
  const store = new SqliteStore(options.dbPath ?? ":memory:"); stores.push(store);
  const mailer = new fake.FakeMailer(), send = vi.spyOn(mailer, "send");
  const atlas = new Atlas({ store, mailer, telephony: new fake.FakeTelephony(), boxsafe: new fake.FakeBoxSafeGateway(), stripe: new fake.FakeStripeGateway(), websiteChecker: new fake.FakeWebsiteChecker(), research: { find: async () => [] }, clock: () => at, config: { ownerName: "Fictional owner", ownerEmail: "sender@example.test", ownerPhone: null, businessFromAddress: "sender@example.test", budgetLimitAud: 300, gstRegistered: false } });
  store.setMemory("acquisition.sender", { name: "Fictional owner", organisation: "Fictional Studio", email: "sender@example.test", contactDetails: "https://studio.example.test" });
  const mode = options.mode ?? "fake", pricing = new ProspectPricing({ atlas, mode, publicOrigin: origin, clock: () => at });
  const discovery = { settings: () => ({ enabled: true, count: 20, target: "no_website" }) } as unknown as DiscoveryProgram;
  const make = (path = seedPath) => new ManualOutreach({ atlas, pricing, discovery, mode, publicOrigin: origin, env: { ATLAS_OUTREACH_SEED_PATH: path }, clock: () => at });
  return { store, atlas, mailer, send, pricing, discovery, seedPath, service: make(), make, setAt: (value: string) => { at = new Date(value); } };
}
function addRecord(s: ReturnType<typeof setup>, change: Partial<AcquisitionRecord> = {}, prospectChange: Partial<Prospect> = {}) {
  const prospect: Prospect = { id: "prospect_fictional", businessName: "Fictional Works (fictional)", location: "Berwick, Victoria", industry: "Fictional cleaning", website: null, stage: "research", evidence: [{ id: "evidence_fictional", sourceUrl: source, observation: "Fictional cleaning listing", status: "unverified", reviewedAt: start, method: "search_result" }], commercialOpportunity: "Fictional scope exercise", recommendedScope: "Review first", internalRecommendedPriceAud: null, qualification: "unqualified", contactEligibility: { lawfulBasis: "none_established", suppressed: false }, outreach: [], createdAt: start, updatedAt: start, fixture: true, ...prospectChange };
  s.store.upsertDoc("prospects", prospect.id, prospect);
  const record: AcquisitionRecord = { id: "lead_fictional", prospectId: prospect.id, businessName: prospect.businessName, location: prospect.location, industry: prospect.industry, website: null, sourceUrl: source, observation: "Fictional public source observation", services: ["Domestic cleaning", "Office cleaning"], createdAt: start, updatedAt: start, contact: { email: "owner@fictional.example.test", sourceUrl: source, basis: "none_established", evidence: "Fictional contact source", roleRelevant: false, noMarketingProhibition: false }, demo: null, draft: null, ...change };
  s.store.upsertDoc("acquisition_records", record.id, record);
  s.store.upsertDoc("discovery_program_reports", "outreach_2026-10-30", { day: "2026-10-30", businesses: [{ leadId: record.id }] });
  s.store.setMemory(noWebsiteQualificationKey(record.id), { day: "2026-10-30", checkedAt: start, sourceUrl: source, email: record.contact?.email, noIndependentWebsiteFound: true, searchQueries: ["Fictional Works Berwick official website"] });
  s.pricing.sync(); return record;
}
function act(service: ManualOutreach, id: string, input: { expectedRevision: number; action: string; stage?: string }) {
  const stage = service.snapshot().rows.find(r => r.leadId === id)?.stages.find(s => s.id === input.stage);
  return service.update(id, { ...input, ...(["reviewed", "sent"].includes(input.action) && stage ? { expectedDraftHash: stage.contentHash } : {}) });
}
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe("manual outreach sequence", () => {
  it("loads reviewed research without sending, requesting a provider or changing canonical drafts/prices", () => {
    const s = setup(), record = addRecord(s), before = s.store.getDoc("acquisition_records", record.id)!.doc;
    const prices = s.store.listDocs("prospect_pricing"), fetch = vi.spyOn(globalThis, "fetch");
    const snapshot = s.service.snapshot();
    expect(snapshot.rows).toHaveLength(1); expect(snapshot.counts).toMatchObject({ ready: 1, due: 0, newToday: 1, shortfall: 19 });
    expect(snapshot.rows[0]).toMatchObject({ sourceKind: "reviewed_seed", eligible: true, previewReady: true, checkedAt: start, revision: 0, status: "active" });
    expect(snapshot.rows[0]!.stages.map(d => [d.id, d.reviewed, d.ready, d.sentAt])).toEqual([["initial", false, true, null], ["follow_up_1", false, false, null], ["follow_up_2", false, false, null]]);
    expect(fetch).not.toHaveBeenCalled(); expect(s.send).not.toHaveBeenCalled(); expect(s.store.getDoc("acquisition_records", record.id)!.doc).toEqual(before); expect(s.store.listDocs("prospect_pricing")).toEqual(prices); expect(s.atlas.quotes.list()).toEqual([]);
  });

  it("requires exact current review and a revision before the owner can record a send", () => {
    const s = setup(), id = s.service.snapshot().rows[0]!.leadId;
    expect(() => act(s.service, id, { expectedRevision: 0, action: "sent", stage: "initial" })).toThrow(/Review this exact draft/);
    const reviewed = act(s.service, id, { expectedRevision: 0, action: "reviewed", stage: "initial" }).rows[0]!;
    expect(reviewed.stages[0]).toMatchObject({ reviewed: true, sentAt: null, ready: true });
    expect(() => act(s.service, id, { expectedRevision: 0, action: "sent", stage: "initial" })).toThrow(/changed/);
    const sent = act(s.service, id, { expectedRevision: 1, action: "sent", stage: "initial" }).rows[0]!;
    expect(sent.stages[0]).toMatchObject({ sentAt: new Date(start).toISOString(), ready: false });
    expect(sent.stages[1]).toMatchObject({ dueAt: "2026-11-02T00:00:00.000Z", ready: false });
    expect(() => act(s.service, id, { expectedRevision: 2, action: "sent", stage: "initial" })).toThrow(/already recorded/);
    expect(s.send).not.toHaveBeenCalled();
  });

  it("spaces follow-ups from actual manual sends and never creates a second pending reminder for the same stage", () => {
    const s = setup(), id = s.service.snapshot().rows[0]!.leadId;
    act(s.service, id, { expectedRevision: 0, action: "reviewed", stage: "initial" });
    act(s.service, id, { expectedRevision: 1, action: "sent", stage: "initial" });
    act(s.service, id, { expectedRevision: 2, action: "reviewed", stage: "follow_up_1" });
    expect(() => act(s.service, id, { expectedRevision: 3, action: "sent", stage: "follow_up_1" })).toThrow(/wait until/);
    s.setAt("2026-11-04T00:00:00Z"); expect(s.service.snapshot().counts.due).toBe(1);
    const first = act(s.service, id, { expectedRevision: 3, action: "sent", stage: "follow_up_1" }).rows[0]!;
    expect(first.stages[2]).toMatchObject({ dueAt: "2026-11-08T00:00:00.000Z", ready: false });
    s.setAt("2026-11-08T00:00:00Z"); expect(s.service.snapshot().rows[0]!.stages[2]!.ready).toBe(true);
    act(s.service, id, { expectedRevision: 4, action: "reviewed", stage: "follow_up_2" });
    act(s.service, id, { expectedRevision: 5, action: "sent", stage: "follow_up_2" });
    expect(s.service.snapshot().counts.due).toBe(0); expect(s.send).not.toHaveBeenCalled();
  });

  it.each(["replied", "closed", "do_not_contact"] as const)("stops every stage for %s and prevents resume-through-hold", action => {
    const s = setup(), id = s.service.snapshot().rows[0]!.leadId;
    const row = act(s.service, id, { expectedRevision: 0, action }).rows[0]!;
    expect(row.status).toBe(action); expect(row.stages.every(d => !d.ready)).toBe(true);
    expect(() => act(s.service, id, { expectedRevision: 1, action: "resume" })).toThrow(/remain stopped|Only a temporary/);
    expect(() => act(s.service, id, { expectedRevision: 1, action: "hold" })).toThrow(/remain stopped/);
  });

  it("allows temporary hold/resume while preserving review state and does not let a hold bypass an evidence problem", () => {
    const s = setup(), id = s.service.snapshot().rows[0]!.leadId;
    act(s.service, id, { expectedRevision: 0, action: "reviewed", stage: "initial" });
    expect(act(s.service, id, { expectedRevision: 1, action: "hold" }).rows[0]!.stages[0]!.ready).toBe(false);
    expect(act(s.service, id, { expectedRevision: 2, action: "resume" }).rows[0]!.stages[0]).toMatchObject({ ready: true, reviewed: true });
    s.setAt("2026-12-02T00:00:00Z"); expect(s.service.snapshot().rows[0]).toMatchObject({ eligible: false, holdReason: expect.stringContaining("thirty days") });
  });

  it("preserves owner states and import dates on restart, clears changed-copy review and keeps the exact sent copy", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-manual-persist-")); dirs.push(dir); const path = join(dir, "db.sqlite");
    const s = setup({ dbPath: path }), id = s.service.snapshot().rows[0]!.leadId;
    act(s.service, id, { expectedRevision: 0, action: "reviewed", stage: "initial" });
    const changed = bundle(); changed.prospects[0]!.initial.text += "\nOwner-reviewed content changed."; writeFileSync(s.seedPath, JSON.stringify(changed));
    const reloaded = s.make(); expect(reloaded.snapshot().rows[0]!.stages[0]!.reviewed).toBe(false);
    expect(() => act(reloaded, id, { expectedRevision: 1, action: "reviewed", stage: "initial" })).toThrow(/changed/);
    act(reloaded, id, { expectedRevision: 2, action: "reviewed", stage: "initial" });
    const sentCopy = act(reloaded, id, { expectedRevision: 3, action: "sent", stage: "initial" }).rows[0]!.stages[0]!.text;
    changed.prospects[0]!.initial.text += "\nA later research revision."; writeFileSync(s.seedPath, JSON.stringify(changed));
    s.setAt("2026-10-31T00:00:00Z"); const restarted = s.make();
    expect(restarted.snapshot().rows[0]!.stages[0]).toMatchObject({ text: sentCopy, sentAt: new Date(start).toISOString() }); expect(restarted.snapshot().counts.newToday).toBe(0);
    expect(restarted.snapshot().rows[0]!.revision).toBe(5);
  });

  it("deduplicates seed/live records and inherits suppression and manual-reply notes", () => {
    const s = setup(), record = addRecord(s);
    expect(s.service.snapshot().rows).toHaveLength(1);
    s.pricing.update(record.id, { expectedRevision: 1, manualEmailStatus: "replied" });
    expect(s.service.snapshot().rows[0]).toMatchObject({ status: "replied" }); expect(s.service.snapshot().counts.ready).toBe(0);
    const p = s.atlas.prospects.require(record.prospectId); p.contactEligibility.suppressed = true; s.store.upsertDoc("prospects", p.id, p);
    expect(s.service.snapshot().rows[0]).toMatchObject({ eligible: false, holdReason: expect.stringContaining("suppressed") });
  });

  it("holds conflicting identities, expired previews and explicit research holds", () => {
    const conflict = setup(); addRecord(conflict, { contact: { email: "changed@fictional.example.test", sourceUrl: source, basis: "none_established", evidence: "Fictional changed identity", roleRelevant: false, noMarketingProhibition: false } }); expect(conflict.service.snapshot().rows[0]!.holdReason).toMatch(/do not agree/);
    const expired = setup({ seed: bundle({ previewExpiresAt: "2026-10-29T00:00:00Z" }) }); expect(expired.service.snapshot().rows[0]).toMatchObject({ eligible: false, previewReady: false });
    const hold = setup({ seed: bundle({ eligible: false, holdReason: "Fictional contact still requires confirmation." }) }); expect(hold.service.snapshot().counts.ready).toBe(0);
    const conflictingAlias = setup({ seed: bundle({ eligible: false, eligibility: "ready", holdReason: "Explicit hold wins over the older alias." }) }); expect(conflictingAlias.service.snapshot().counts.ready).toBe(0);
  });

  it("uses only a public proof link for new private concepts and keeps unsupported dynamic research off the ready list", () => {
    const s = setup({ noSeed: true }), record = addRecord(s);
    const row = s.service.snapshot().rows[0]!;
    expect(row).toMatchObject({ sourceKind: "daily_research", eligible: true, previewReady: false, previewUrl: null, proofUrl: "https://wulffdigital.com/#work" });
    expect(row.stages.every(d => d.text.includes(row.proofUrl) && !d.text.includes("/api/acquisition/") && d.text.includes("?"))).toBe(true);
    expect(row.stages[0]!.text).toContain("cleaning jobs");
    s.store.setMemory(noWebsiteQualificationKey(record.id), null);
    expect(s.service.snapshot().rows[0]).toMatchObject({ eligible: false, holdReason: expect.stringContaining("current source") });
  });

  it("accepts only active published metadata for dynamic external demo links", () => {
    const s = setup({ noSeed: true }); addRecord(s, { demo: { id: "fictional_demo", templateId: "simple", templateName: "Fictional Simple", htmlHash: "a".repeat(64), previewPath: "/api/acquisition/demos/fictional_demo/preview", publicPath: "/demos/fictional-public-token", publishedAt: start, expiresAt: "2026-11-30T00:00:00Z" } });
    const row = s.service.snapshot().rows[0]!; expect(row.previewReady).toBe(true); expect(row.previewUrl).toBe(origin + "/demos/fictional-public-token"); expect(row.stages[0]!.text).toContain(row.previewUrl);
  });

  it("rejects malformed, duplicate, unsafe, oversized or symlinked imports atomically without inventing replacements", () => {
    for (const seed of [bundle({ sourceUrl: "javascript:alert(1)" }), bundle({ initial: { subject: "Header\r\nBcc: attacker@example.test", text: `Draft ${preview}` } }), bundle({ initial: { subject: "Fictional quote", text: `Price $999 ${preview}` } }), bundle({ checkedAt: "2099-01-01T00:00:00Z" }), { version: 1, prospects: [bundle().prospects[0], bundle().prospects[0]] }]) {
      const s = setup({ seed }); expect(s.service.snapshot().rows).toEqual([]); expect(s.service.snapshot().notes.join(" ")).toContain("could not be validated");
    }
    const dir = mkdtempSync(join(tmpdir(), "atlas-manual-link-")); dirs.push(dir); const actual = join(dir, "actual.json"), link = join(dir, "linked.json"); writeFileSync(actual, JSON.stringify(bundle())); symlinkSync(actual, link);
    expect(setup({ seedPath: link }).service.snapshot().rows).toEqual([]);
    const oversized = join(dir, "large.json"); writeFileSync(oversized, " ".repeat(2 * 1024 * 1024 + 1)); expect(setup({ seedPath: oversized }).service.snapshot().rows).toEqual([]);
    expect(setup({ mode: "live" }).service.snapshot().rows).toEqual([]);
  });

  it("requires real owner authentication and same-origin JSON for private review and mutation", async () => {
    const s = setup(), app = new Hono(), accessKey = "fictional-owner-secret-key-32-bytes-only";
    installOwnerAuth(app, { atlas: s.atlas, mode: "fake" } as Runtime, { ownerAccessKey: accessKey, publicOrigin: origin }); installManualOutreachRoutes(app, s.service);
    expect((await app.request(origin + "/api/manual-outreach")).status).toBe(401);
    const id = s.service.snapshot().rows[0]!.leadId;
    expect((await app.request(origin + `/api/manual-outreach/leads/${id}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: 0, action: "reviewed", stage: "initial" }) })).status).toBe(401);
    const login = await app.request(origin + "/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ accessKey }) }); const cookie = login.headers.getSetCookie().at(-1)!.split(";")[0]!;
    const get = await app.request(origin + "/api/manual-outreach", { headers: { Cookie: cookie } }); expect(get.status).toBe(200); expect(get.headers.get("cache-control")).toBe("no-store"); expect(get.headers.get("x-robots-tag")).toContain("noindex");
    const update = (originHeader: string, body: unknown) => app.request(origin + `/api/manual-outreach/leads/${id}`, { method: "POST", headers: { Cookie: cookie, Origin: originHeader, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await update("https://attacker.example.test", { expectedRevision: 0, action: "reviewed", stage: "initial" })).status).toBe(403);
    expect((await update(origin, { expectedRevision: 0, action: "reviewed", stage: "initial", text: "Changed-copy injection" })).status).toBe(400);
    expect((await update(origin, { expectedRevision: 0, action: "reviewed", stage: "initial", expectedDraftHash: s.service.snapshot().rows[0]!.stages[0]!.contentHash })).status).toBe(200);
    expect((await update(origin, { expectedRevision: 0, action: "hold" })).status).toBe(409); expect(s.send).not.toHaveBeenCalled();
  });

  it("rejects a stale dynamic draft hash after sender details change, even at the same stored revision", () => {
    const s = setup({ noSeed: true }); addRecord(s);
    const old = s.service.snapshot().rows[0]!, hash = old.stages[0]!.contentHash;
    s.store.setMemory("acquisition.sender", { name: "Changed fictional owner", organisation: "Changed fictional studio", email: "other@example.test", contactDetails: "https://changed.example.test" });
    const changed = s.service.snapshot().rows[0]!; expect(changed.revision).toBe(old.revision); expect(changed.stages[0]!.contentHash).not.toBe(hash);
    expect(() => s.service.update(old.leadId, { expectedRevision: old.revision, action: "reviewed", stage: "initial", expectedDraftHash: hash })).toThrow(/email text changed/);
    expect(() => s.service.update(old.leadId, { expectedRevision: old.revision, action: "reviewed", stage: "initial" })).toThrow(/exact draft hash/);
    expect(changed.stages[0]!.reviewed).toBe(false);
  });

  it("holds legacy contact states with no sent date and checks every exact duplicate for prior stops", () => {
    const s = setup(), record = addRecord(s);
    const row = s.store.getDoc<Record<string, unknown>>("prospect_pricing", record.id)!.doc;
    s.store.upsertDoc("prospect_pricing", record.id, { ...row, manualEmailStatus: "sent", manualEmailSentAt: null });
    expect(s.service.snapshot().rows[0]).toMatchObject({ eligible: false, holdReason: expect.stringContaining("without a valid sent date") });
    s.store.upsertDoc("prospect_pricing", record.id, { ...row, manualEmailStatus: "sent", manualEmailSentAt: "invalid-date" });
    expect(s.service.snapshot().rows[0]).toMatchObject({ eligible: false, holdReason: expect.stringContaining("without a valid sent date") });
    s.store.upsertDoc("prospect_pricing", record.id, { ...row, manualEmailStatus: "not_sent", manualEmailSentAt: null });
    const duplicate = { ...record, id: "lead_other_fictional" }; s.store.upsertDoc("acquisition_records", duplicate.id, duplicate); s.pricing.sync();
    s.pricing.update(duplicate.id, { expectedRevision: 1, manualEmailStatus: "replied" });
    expect(s.service.snapshot().rows).toHaveLength(1); expect(s.service.snapshot().rows[0]!.status).toBe("replied"); expect(s.service.snapshot().counts.ready).toBe(0);
  });

  it.each(["sent", "replied", "closed", "hold"])("retains a daily row’s %s history when a curated preview later replaces its identity", action => {
    const s = setup({ noSeed: true }); addRecord(s);
    const row = s.service.snapshot().rows[0]!;
    if (action === "sent") {
      act(s.service, row.leadId, { expectedRevision: 0, action: "reviewed", stage: "initial" });
      act(s.service, row.leadId, { expectedRevision: 1, action, stage: "initial" });
    } else act(s.service, row.leadId, { expectedRevision: 0, action });
    const before = s.service.snapshot().rows[0]!;
    s.setAt("2026-10-31T00:00:00Z"); writeFileSync(s.seedPath, JSON.stringify(bundle()));
    const migrated = s.make(), after = migrated.snapshot().rows[0]!;
    expect(after.leadId).not.toBe(before.leadId); expect(after.sourceKind).toBe("reviewed_seed");
    expect(after.stages[0]!.ready).toBe(false); expect(after.revision).toBeGreaterThan(before.revision);
    expect(migrated.snapshot().counts.newToday).toBe(0);
    if (action === "sent") expect(after.stages[0]).toMatchObject({ sentAt: before.stages[0]!.sentAt, text: before.stages[0]!.text });
    else expect(after.status).toBe(action);
  });
});

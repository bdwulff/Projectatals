import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { Hono } from "hono";
import { Atlas, SqliteStore, fake, type AcquisitionRecord, type Prospect } from "@atlas/core";
import { ProspectPricing, installProspectPricingRoutes } from "./prospect-pricing.js";
import { createPricingCsv, createPricingWorkbook } from "./prospect-pricing-workbook.js";
import { installOwnerAuth } from "./auth.js";
import type { Runtime } from "./runtime.js";
const stores: SqliteStore[] = [], dirs: string[] = [];
const now = new Date("2026-10-29T00:30:00Z"), origin = "https://jarvis.example.test";
function setup(path = ":memory:", mode: "live" | "fake" = "fake") {
  const store = new SqliteStore(path); stores.push(store);
  const mailer = new fake.FakeMailer();
  const atlas = new Atlas({ store, mailer, telephony: new fake.FakeTelephony(), boxsafe: new fake.FakeBoxSafeGateway(), stripe: new fake.FakeStripeGateway(), websiteChecker: new fake.FakeWebsiteChecker(), research: { find: vi.fn(async () => []) }, clock: () => now, config: { ownerName: "Fictional owner", ownerEmail: "owner@example.test", ownerPhone: null, businessFromAddress: "sender@example.test", budgetLimitAud: 300, gstRegistered: false } });
  return { store, atlas, mailer, pricing: new ProspectPricing({ atlas, mode, publicOrigin: origin, clock: () => now }) };
}
function add(s: ReturnType<typeof setup>, id: string, count = 3, overrides: Partial<Prospect> = {}) {
  const prospect: Prospect = { id: `prospect_${id}`, businessName: `Example Works ${id} (fictional)`, location: "Berwick, Victoria", industry: "Fictional gardening", website: null, stage: "research", evidence: [{ id: `evidence_${id}`, sourceUrl: `https://directory.example.com/${id}`, observation: "Fictional listing; independent site remains unverified.", status: "unverified", reviewedAt: now.toISOString(), method: "search_result" }], commercialOpportunity: "Fictional private scope exercise", recommendedScope: "Review first", internalRecommendedPriceAud: null, qualification: "unqualified", contactEligibility: { lawfulBasis: "none_established", suppressed: false }, outreach: [], createdAt: "2026-10-28T15:00:00Z", updatedAt: now.toISOString(), fixture: true, ...overrides };
  s.store.upsertDoc("prospects", prospect.id, prospect);
  const record: AcquisitionRecord = { id: `lead_${id}`, prospectId: prospect.id, businessName: prospect.businessName, location: prospect.location, industry: prospect.industry, website: prospect.website, sourceUrl: prospect.evidence[0]!.sourceUrl, observation: prospect.evidence[0]!.observation, services: Array.from({ length: count }, (_, i) => `Recorded service ${i + 1}`), createdAt: prospect.createdAt, updatedAt: now.toISOString(), contact: { email: `owner@${id}.example.test`, sourceUrl: `https://directory.example.com/${id}/contact`, basis: "none_established", evidence: "Fictional source candidate only", roleRelevant: false, noMarketingProhibition: false }, demo: { id: `demo_${id}`, templateId: "immersive", templateName: "Fictional test concept", htmlHash: "a".repeat(64), previewPath: `/api/acquisition/demos/demo_${id}/preview`, publicPath: null, expiresAt: "2026-11-01T00:00:00Z" }, draft: { id: `draft_${id}`, version: 1, from: "sender@example.test", to: `owner@${id}.example.test`, subject: "Private concept review (fictional)", text: "Owner-written email. Please review this fictional concept.", contentHash: "b".repeat(32), status: "draft", blockers: ["Contact permission not established"] } };
  s.store.upsertDoc("acquisition_records", record.id, record); return record;
}
/** Independent ZIP reader checks local directory bytes and decompresses the actual exported files. */
function unzip(buffer: Buffer): Record<string, string> {
  const files: Record<string, string> = {}; let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    expect(buffer.readUInt16LE(offset + 8)).toBe(8);
    const size = buffer.readUInt32LE(offset + 18), nameLength = buffer.readUInt16LE(offset + 26), extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString(), start = offset + 30 + nameLength + extraLength;
    const data = inflateRawSync(buffer.subarray(start, start + size)); expect(data.length).toBe(buffer.readUInt32LE(offset + 22)); files[name] = data.toString(); offset = start + size;
  }
  expect(buffer.readUInt32LE(offset)).toBe(0x02014b50); expect(buffer.readUInt32LE(buffer.length - 22)).toBe(0x06054b50); expect(buffer.readUInt16LE(buffer.length - 12)).toBe(Object.keys(files).length); return files;
}
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe("private prospect price storage and joins", () => {
  it("suggests explicit service-count scopes and preserves existing internal prices without sending or inventing integrations", () => {
    const s = setup(); add(s, "zero", 0); add(s, "four", 4); add(s, "five", 5); add(s, "eight", 8); add(s, "nine", 9); add(s, "prior", 3, { internalRecommendedPriceAud: 875.5 });
    const send = vi.spyOn(s.mailer, "send"), fetch = vi.spyOn(globalThis, "fetch");
    expect(s.pricing.sync()).toEqual({ created: 6, updated: 0, total: 6 });
    const rows = s.pricing.snapshot().rows, byId = (id: string) => rows.find(r => r.leadId === `lead_${id}`)!.price;
    expect(byId("zero").suggestedQuoteAud).toBe(699); expect(byId("four")).toMatchObject({ suggestedQuoteAud: 699, proposedPages: 1 }); expect(byId("five")).toMatchObject({ suggestedQuoteAud: 999, proposedPages: 3 }); expect(byId("eight").suggestedQuoteAud).toBe(999); expect(byId("nine")).toMatchObject({ suggestedQuoteAud: 1499, proposedPages: 5 }); expect(byId("prior")).toMatchObject({ suggestedQuoteAud: 875.5, quoteBasis: "existing_internal_recommendation" });
    expect(byId("nine").proposedScope).toContain("No booking, commerce or custom integrations are assumed"); expect(rows.every(r => r.price.gstStatus === "unconfirmed" && r.price.exclusions.join(" ").includes("Hosting"))).toBe(true); expect(send).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps owner quote/scope/status edits after daily refresh and restart without altering an email or customer quote", () => {
    const dir = mkdtempSync(join(tmpdir(), "pricing-fixture-")); dirs.push(dir); const path = join(dir, "fixture.db"), s = setup(path), lead = add(s, "edited"); s.pricing.sync();
    const before = s.store.getDoc<AcquisitionRecord>("acquisition_records", lead.id)!.doc;
    const updated = s.pricing.update(lead.id, { expectedRevision: 1, suggestedQuoteAud: 825.25, proposedScope: "Owner-defined two-page starting scope.", notes: "Private margin note: keep out of emails.", manualEmailStatus: "sent" }).rows[0]!;
    expect(updated.price).toMatchObject({ revision: 2, suggestedQuoteAud: 825.25, quoteBasis: "owner_edited", manualEmailStatus: "sent", manualEmailSentAt: now.toISOString() });
    expect(s.store.getDoc("acquisition_records", lead.id)!.doc).toEqual(before); expect(s.atlas.quotes.list()).toEqual([]);
    before.services = Array.from({ length: 10 }, (_, i) => `Revised source-backed service ${i}`); s.store.upsertDoc("acquisition_records", lead.id, before); s.pricing.sync();
    const reopened = setup(path); expect(reopened.pricing.snapshot().rows[0]!.price).toMatchObject({ revision: 2, suggestedQuoteAud: 825.25, proposedScope: "Owner-defined two-page starting scope.", notes: "Private margin note: keep out of emails." });
    expect(() => s.pricing.update(lead.id, { expectedRevision: 1, notes: "Stale edit" })).toThrow(/changed/); expect(s.mailer.sent).toEqual([]);
  });
  it("refreshes automatic recommendations while retaining owner status/notes, and treats live fixture/orphan/archived leads as unavailable", () => {
    const s = setup(); const lead = add(s, "refresh", 2); s.pricing.sync(); s.pricing.update(lead.id, { expectedRevision: 1, notes: "Retain my note", manualEmailStatus: "follow_up" }); lead.services = Array.from({ length: 6 }, (_, i) => `Source service ${i}`); s.store.upsertDoc("acquisition_records", lead.id, lead); expect(s.pricing.sync().updated).toBe(1); expect(s.pricing.snapshot().rows[0]!.price).toMatchObject({ revision: 3, suggestedQuoteAud: 999, notes: "Retain my note", manualEmailStatus: "follow_up" });
    const live = new ProspectPricing({ atlas: s.atlas, mode: "live" }); expect(live.snapshot().rows).toEqual([]); const liveLead = add(s, "live", 3, { fixture: false }); expect(live.snapshot().rows.map(r => r.leadId)).toEqual([liveLead.id]); liveLead.archivedAt = now.toISOString(); s.store.upsertDoc("acquisition_records", liveLead.id, liveLead); expect(live.snapshot().rows).toEqual([]); expect(() => live.update(lead.id, { expectedRevision: 3, notes: "Hidden fixture" })).toThrow(/not found/);
  });
  it("joins fresh contact/demo facts and Melbourne report membership without persisting writes during export", () => {
    const s = setup(), lead = add(s, "joined"); lead.createdAt = "2026-10-27T14:30:00Z"; s.store.upsertDoc("acquisition_records", lead.id, lead); s.store.upsertDoc("discovery_program_reports", "daily", { day: "2026-10-29", businesses: [{ leadId: lead.id }] });
    s.store.setMemory("acquisition.sender", { name: "Fictional owner", organisation: "Example Studio", email: "sender@example.test", contactDetails: "Phone: 0400 000 000" });
    const before = s.store.listDocs("prospect_pricing"); const snap = s.pricing.snapshot("2026-10-29"), row = snap.rows[0]!;
    expect(row.discoveryDays).toEqual(["2026-10-28", "2026-10-29"]); expect(row.previewPath).toBe(`/api/acquisition/demos/${lead.demo!.id}/preview`); expect(row.previewUrl).toBe(origin + row.previewPath); expect(row.contactReviewRequired).toBe(true); expect(snap.sender.ownerPhone).toBe("0400 000 000");
    expect(s.pricing.snapshot("2026-10-27").rows).toEqual([]); expect(() => s.pricing.snapshot("2026-02-30")).toThrow(/calendar/); s.pricing.exportCsv(); s.pricing.exportXlsx(); expect(s.store.listDocs("prospect_pricing")).toEqual(before);
    lead.contact = null; lead.sourceUrl = "javascript:alert(1)"; s.store.upsertDoc("acquisition_records", lead.id, lead); expect(s.pricing.snapshot().rows[0]).toMatchObject({ contactEmail: null, sourceUrl: "" });
  });
  it.each([{ suggestedQuoteAud: -1 }, { suggestedQuoteAud: 1.234 }, { suggestedQuoteAud: "699" }, { suggestedQuoteAud: Infinity }, { manualEmailStatus: "auto_sent" }, { manualEmailSentAt: "2999-01-01T00:00:00Z" }, { manualEmailSentAt: "2026-02-30T12:00:00Z" }, { notes: "bad\u0000note" }, { draft: { text: "Price injection" } }])("rejects malformed owner edits atomically: %j", change => {
    const s = setup(), lead = add(s, "invalid"); s.pricing.sync(); const before = s.store.getDoc("prospect_pricing", lead.id)!.doc; expect(() => s.pricing.update(lead.id, { expectedRevision: 1, ...change })).toThrow(); expect(s.store.getDoc("prospect_pricing", lead.id)!.doc).toEqual(before);
  });
});

describe("actual spreadsheet exports", () => {
  it("exports genuine separated OOXML sheets with numbers, escaped inline text, private links and optional unchanged email drafts", () => {
    const s = setup(), lead = add(s, "workbook"); lead.businessName = '=HYPERLINK("https://attacker.example.com") & <unsafe> (fictional)'; lead.observation = "\u0000Invalid XML control plus café & emoji ☕"; s.store.upsertDoc("acquisition_records", lead.id, lead); s.pricing.sync(); s.pricing.update(lead.id, { expectedRevision: 1, notes: "OWNER-ONLY-NOTE", suggestedQuoteAud: 812.5 });
    const files = unzip(s.pricing.exportXlsx(undefined, true)); expect(Object.keys(files)).toHaveLength(8); expect(files["xl/workbook.xml"]).toContain('name="Pricing"'); expect(files["xl/workbook.xml"]).toContain('name="Prospects"'); expect(files["xl/workbook.xml"]).toContain('name="Email drafts"'); expect(files["xl/worksheets/sheet1.xml"]).toContain('<c r="D2" s="2"><v>812.5</v></c>');
    for (const source of Object.values(files)) { expect(source).not.toMatch(/<f(?:\s|>)/); expect(source).not.toContain("\u0000"); }
    expect(files["xl/worksheets/sheet1.xml"]).toContain("&amp; &lt;unsafe&gt;"); expect(files["xl/worksheets/sheet2.xml"]).toContain(origin + `/api/acquisition/demos/${lead.demo!.id}/preview`); expect(files["xl/worksheets/sheet3.xml"]).toContain(lead.draft!.text); expect(files["xl/worksheets/sheet3.xml"]).not.toContain("OWNER-ONLY-NOTE"); expect(files["xl/worksheets/sheet3.xml"]).not.toContain("812.5"); expect(files["[Content_Types].xml"]).toContain("spreadsheetml.sheet.main+xml"); expect(unzip(s.pricing.exportXlsx())["xl/worksheets/sheet3.xml"]).toBeUndefined();
  });
  it("neutralises CSV formulas after whitespace/control prefixes and quotes newlines, commas and source/email text", () => {
    const csv = createPricingCsv({ name: "Pricing", headers: ["a", "b", "c", "d", "e", "f"], rows: [[" =1+1", "\t@SUM(1,1)", "\u200b+cmd", "-1+2", "a,\"b\"\nnext", 699]] });
    expect(csv).toContain('"\' =1+1"'); expect(csv).toContain('"\'\t@SUM(1,1)"'); expect(csv).toContain('"\'\u200b+cmd"'); expect(csv).toContain('"\'-1+2"'); expect(csv).toContain('"a,""b""\nnext"'); expect(csv).toContain('"699"'); expect(csv.startsWith("\ufeff")).toBe(true);
    expect(() => createPricingWorkbook([{ name: "Pricing", headers: ["x"], rows: Array.from({ length: 5001 }, () => ["x"]) }, { name: "Prospects", headers: ["x"], rows: [] }])).toThrow(/limit/);
  });
  it("requires the real owner session and same-origin edit gate, including export endpoints", async () => {
    const s = setup(), lead = add(s, "routes"), app = new Hono(), key = "fictional-owner-access-key-32-bytes-only";
    installOwnerAuth(app, { atlas: s.atlas, mode: "fake" } as Runtime, { ownerAccessKey: key, publicOrigin: origin }); installProspectPricingRoutes(app, s.pricing);
    for (const path of ["/api/prospect-pricing", "/api/prospect-pricing/export.xlsx", "/api/prospect-pricing/export.csv"]) expect((await app.request(origin + path)).status).toBe(401);
    const login = await app.request(origin + "/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ accessKey: key }) }); expect(login.status).toBe(200); const cookie = login.headers.getSetCookie().at(-1)!.split(";")[0]!;
    const response = await app.request(origin + "/api/prospect-pricing", { headers: { Cookie: cookie } }); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const denied = await app.request(origin + `/api/prospect-pricing/leads/${lead.id}`, { method: "POST", headers: { Cookie: cookie, Origin: "https://other.example.test", "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: 0, notes: "Cross-site edit" }) }); expect(denied.status).toBe(403);
    const xlsx = await app.request(origin + "/api/prospect-pricing/export.xlsx?includeDrafts=1", { headers: { Cookie: cookie } }); expect(xlsx.status).toBe(200); expect(xlsx.headers.get("content-type")).toContain("spreadsheetml.sheet"); expect(unzip(Buffer.from(await xlsx.arrayBuffer()))["xl/workbook.xml"]).toContain("Email drafts"); expect((await app.request(origin + "/api/prospect-pricing?day=2026-02-30", { headers: { Cookie: cookie } })).status).toBe(400);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { ResearchLookupResult } from "@atlas/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRuntime, type Runtime } from "./runtime.js";
import { NoWebsiteResearch, noWebsiteQualificationKey, planNoWebsiteDiscovery, type NoWebsiteResearchInput, type NoWebsiteQualification } from "./no-website-research.js";

const runtimes: Runtime[] = [];
const directories: string[] = [];
const initial = () => new Date("2026-10-27T00:00:00Z");
const input = (change: Partial<NoWebsiteResearchInput> = {}): NoWebsiteResearchInput => ({ reportId: "outreach_2026-10-27", area: "Berwick, Victoria", count: 20, templateId: "simple", ...change });
function setup(db?: string) {
  let now = initial();
  const rt = buildRuntime({ ATLAS_MODE: "live", ATLAS_PUBLIC_ORIGIN: "https://jarvis.example.com", ...(db ? { ATLAS_DB_PATH: db } : {}) }); runtimes.push(rt);
  const lookup = vi.fn<(request: { query: string; count?: number }) => Promise<ResearchLookupResult[]>>().mockResolvedValue([]);
  rt.atlas.deps.lookup = { lookup, status: async () => ({ name: "Research (Tavily)", state: "connected", mode: "live", checkedAt: initial().toISOString(), detail: "Fictional mocked keyless lookup for tests." }) };
  const service = new NoWebsiteResearch({ atlas: rt.atlas, acquisition: rt.acquisition, clock: () => now });
  return { rt, lookup, service, advance: (ms = 61_000) => { now = new Date(now.getTime() + ms); }, set: (value: Date) => { now = value; } };
}
function candidate(name = "Acme Local Gardens", email = "acme@businessmail.com", industry = "garden maintenance"): ResearchLookupResult {
  return { title: `${name} | Facebook`, url: "https://www.facebook.com/" + name.replace(/\W/g, "").toLowerCase(), description: `${name} offers ${industry} in Berwick, Victoria. Contact email: ${email}. Public business source for review.`, source: "Tavily", retrievedAt: initial().toISOString(), trust: "untrusted_web_content" };
}
const sector = (query: string) => query.match(/"([^"]+)" "email"$/)?.[1] ?? "garden maintenance";
const card = (input: Pick<ResearchLookupResult, "title" | "url" | "description">): ResearchLookupResult => ({ ...candidate(), ...input });
function addSeed(s: ReturnType<typeof setup>, change: { name?: string; location?: string; email?: string; source?: string; website?: string } = {}) {
  const source = change.source ?? "https://www.wyndham.vic.gov.au/directory/acme-local-gardens";
  const r = s.rt.acquisition.addLead({ businessName: change.name ?? "Acme Local Gardens", location: change.location ?? "Werribee, Victoria", industry: "garden maintenance", sourceUrl: source, contactEmail: change.email ?? "acme@businessmail.com", contactSourceUrl: source, observation: "Owner-reviewed public directory facts. Website absence remains qualified.", ...(change.website ? { website: change.website } : {}) });
  const q: NoWebsiteQualification = { day: "2026-10-27", checkedAt: initial().toISOString(), sourceUrl: source, email: r.contact!.email, noIndependentWebsiteFound: true, searchQueries: ['"Acme Local Gardens" Werribee official website'] };
  s.rt.atlas.deps.store.setMemory(noWebsiteQualificationKey(r.id), q); return r;
}
afterEach(() => { for (const rt of runtimes.splice(0)) rt.atlas.deps.store.close(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("bounded no-independent-website daily source research", () => {
  it("keeps every planned council search inside its municipality and Fresha searches inside relevant sectors", () => {
    const councils: Record<string, string[]> = { "wyndham.vic.gov.au": ["Werribee", "Hoppers Crossing", "Tarneit", "Truganina", "Point Cook", "Wyndham Vale"], "casey.vic.gov.au": ["Cranbourne", "Cranbourne West", "Berwick", "Narre Warren"], "greaterdandenong.vic.gov.au": ["Dandenong", "Noble Park", "Springvale", "Keysborough"], "frankston.vic.gov.au": ["Frankston"] };
    let municipal = 0, appointment = 0;
    for (let day = 1; day <= 31; day++) for (let index = 0; index < 40; index++) {
      const planned = planNoWebsiteDiscovery({ area: "Melbourne and south-east Melbourne, Victoria", day: `2026-10-${String(day).padStart(2, "0")}`, index });
      if (councils[planned.source]) { municipal++; expect(councils[planned.source]).toContain(planned.locality); }
      if (planned.source === "fresha.com") { appointment++; expect(["hair salon", "personal training"]).toContain(planned.industry); }
      expect(planned.query).toBe(`site:${planned.source} "${planned.locality}" "${planned.industry}" "email"`);
    }
    expect(municipal).toBeGreaterThan(0); expect(appointment).toBeGreaterThan(0);
  });

  it("retains requested locality coverage with generic-source fallback and fresh next-day rotation", () => {
    const first = Array.from({ length: 40 }, (_, index) => planNoWebsiteDiscovery({ area: "Officer, Pakenham, Victoria", day: "2026-10-30", index }));
    expect(new Set(first.map(p => p.locality))).toEqual(new Set(["Officer", "Pakenham"]));
    expect(first.every(p => !p.source.endsWith(".gov.au"))).toBe(true);
    const next = Array.from({ length: 40 }, (_, index) => planNoWebsiteDiscovery({ area: "Officer, Pakenham, Victoria", day: "2026-10-31", index }));
    expect(first.map(p => p.query)).not.toEqual(next.map(p => p.query));
  });

  it("resumes to twenty genuinely new email-present businesses without any send, publishing or enrichment", async () => {
    const s = setup(); let batch = 0;
    s.lookup.mockImplementation(async ({ query }) => query.includes('"email"') ? Array.from({ length: 10 }, (_, i) => { const n = ++batch; return candidate(`Local Business ${n}`, `business${n}@businessmail.com`, sector(query)); }) : []);
    const send = vi.spyOn(s.rt.acquisition, "approveAndSend"), publish = vi.spyOn(s.rt.acquisition, "publish"), enrich = vi.spyOn(s.rt.acquisition, "enrichAndPrepare");
    let result = await s.service.step(input());
    for (let i = 0; result.state === "running" && i < 25; i++) { s.advance(); result = await s.service.step(input()); }
    expect(result).toMatchObject({ state: "completed", requestedCount: 20, shortfallCount: 0, searchCount: 22 });
    expect(new Set(result.leadIds).size).toBe(20);
    const records = (await s.rt.acquisition.snapshot()).records;
    expect(records).toHaveLength(20); expect(new Set(records.map(r => r.contact?.email)).size).toBe(20);
    expect(records.every(r => r.website === null && r.contact?.basis === "none_established" && r.demo === null)).toBe(true);
    expect(records.every(r => r.observation.includes("not proof") && r.contact?.sourceUrl.includes("facebook.com"))).toBe(true);
    expect(send).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled(); expect(enrich).not.toHaveBeenCalled(); expect(s.rt.fakes.mailer.sent).toHaveLength(0); expect(s.rt.atlas.quotes.list()).toHaveLength(0);
    await s.service.step(input()); expect(s.lookup).toHaveBeenCalledTimes(22);
  });

  it("keeps two different businesses on the same social host distinct", async () => {
    const s = setup(); s.lookup.mockImplementation(async ({ query }) => query.includes('"email"') ? [candidate("First Local Business", "first@businessmail.com", sector(query)), candidate("Second Local Business", "second@businessmail.com", sector(query))] : []);
    let r = await s.service.step(input({ count: 2 })); s.advance(); r = await s.service.step(input({ count: 2 }));
    expect(r.state).toBe("completed"); expect(r.leadIds).toHaveLength(2);
  });

  it("persists the two-per-minute throttle across instances and reports continuation time without sleeping", async () => {
    const s = setup(); await s.service.step(input());
    const another = new NoWebsiteResearch({ atlas: s.rt.atlas, acquisition: s.rt.acquisition, clock: initial });
    const r = await another.step(input()); expect(s.lookup).toHaveBeenCalledTimes(2); expect(r.state).toBe("running"); expect(r.nextStepAt).toBe("2026-10-27T00:01:00.001Z");
    s.advance(); await s.service.step(input()); expect(s.lookup).toHaveBeenCalledTimes(4);
  });

  it("retains accepted IDs, queued candidates and budget across a real SQLite close/reopen", async () => {
    const directory = mkdtempSync(join(tmpdir(), "atlas-no-website-")); directories.push(directory); const db = join(directory, "atlas.sqlite");
    const first = setup(db); first.lookup.mockImplementation(async ({ query }) => query.includes('"email"') ? [candidate("First Local Business", "first@businessmail.com", sector(query)), candidate("Second Local Business", "second@businessmail.com", sector(query)), candidate("Third Local Business", "third@businessmail.com", sector(query))] : []);
    const a = await first.service.step(input({ count: 3 })); expect(a.leadIds).toHaveLength(1);
    runtimes.splice(runtimes.indexOf(first.rt), 1); first.rt.atlas.deps.store.close();
    const second = setup(db); second.advance(); const b = await second.service.step(input({ count: 3 }));
    expect(b.state).toBe("completed"); expect(b.leadIds).toHaveLength(3); expect(b.leadIds[0]).toBe(a.leadIds[0]); expect(b.searchCount).toBe(4); expect(second.lookup).toHaveBeenCalledTimes(2);
    expect(second.lookup.mock.calls.every(([r]) => r.query.endsWith("official website"))).toBe(true);
  });

  it("shares forty reserved lookups across reports and never fills a shortfall with fake contacts", async () => {
    const s = setup(); let r = await s.service.step(input());
    for (let i = 0; i < 21 && r.state === "running"; i++) { s.advance(); r = await s.service.step(input()); }
    expect(r).toMatchObject({ state: "partial", leadIds: [], shortfallCount: 20, daySearchCount: 40 }); expect(s.lookup).toHaveBeenCalledTimes(40);
    s.advance(); const other = await s.service.step(input({ reportId: "second-report-same-day" }));
    expect(other.state).toBe("partial"); expect(other.searchCount).toBe(0); expect(s.lookup).toHaveBeenCalledTimes(40);
  });

  it("rejects a named business with an independent site found by its exact-name check", async () => {
    const s = setup(); s.lookup.mockImplementation(async ({ query }) => query.includes('"email"') ? [candidate(undefined, undefined, sector(query))] : [{ ...candidate(), title: "Acme Local Gardens Berwick", url: "https://acmelocalgardens.com.au/" }]);
    const r = await s.service.step(input()); expect(r.leadIds).toEqual([]); expect(r.exclusions.ownWebsite).toBe(1); expect((await s.rt.acquisition.snapshot()).records).toHaveLength(0);
  });

  it("accepts a named council-directory profile while rejecting its generic category index", async () => {
    const s = setup(); s.lookup.mockImplementation(async ({ query }) => query.includes('"email"') ? [
      { ...candidate("Acme Local Gardens", undefined, sector(query)), title: "Acme Local Gardens | Business Directory | Wyndham City", url: "https://www.wyndham.vic.gov.au/business-directory/acme-local-gardens" },
      { ...candidate("Business Directory", undefined, sector(query)), title: "Business Directory | Wyndham City", url: "https://www.wyndham.vic.gov.au/business-directory" },
    ] : []);
    const r = await s.service.step(input({ count: 1 })); expect(r.state).toBe("completed"); expect(r.leadIds).toHaveLength(1); expect(r.exclusions.nonBusiness).toBe(1);
    expect((await s.rt.acquisition.snapshot()).records[0]!.sourceUrl).toContain("wyndham.vic.gov.au/business-directory/acme");
  });

  it("accepts a single council entry’s matching title and slug when its contact excerpt does not repeat the name", async () => {
    const s = setup();
    s.lookup.mockImplementation(async ({ query }) => query.includes('"email"') ? [card({ title: "Fictional Blossom Gardens | Business Directory | Wyndham City", url: "https://www.wyndham.vic.gov.au/directory/fictional-blossom-gardens-0", description: `${sector(query)} in Berwick, Victoria. Phone 0400 000 000. E-Mail: fictional-blossom@businessmail.com. Council contact mail@wyndham.vic.gov.au.` })] : []);
    const result = await s.service.step(input({ count: 1 }));
    expect(result.state).toBe("completed"); expect(result.leadIds).toHaveLength(1); expect(s.lookup).toHaveBeenCalledTimes(2);
    const saved = (await s.rt.acquisition.snapshot()).records[0]!; expect(saved.businessName).toBe("Fictional Blossom Gardens"); expect(saved.contact!.email).toBe("fictional-blossom@businessmail.com"); expect(saved.observation).toContain("not proof that none exists");
  });

  it("retains duplicate and owned-website checks after an individual title-and-slug match", async () => {
    const s = setup(); s.rt.atlas.deps.store.upsertDoc("manual_outreach_seeds", "manual_fictional_existing", { businessName: "Fictional Blossom Gardens", contactEmail: "fictional-blossom@businessmail.com" });
    s.lookup.mockImplementation(async ({ query }) => query.includes('"email"') ? [card({ title: "Fictional Blossom Gardens", url: "https://www.wyndham.vic.gov.au/directory/fictional-blossom-gardens", description: `${sector(query)} in Berwick, Victoria. fictional-blossom@businessmail.com` })] : []);
    expect((await s.service.step(input())).leadIds).toEqual([]); expect(s.lookup.mock.calls.every(([request]) => request.query.includes('"email"'))).toBe(true);
    const another = setup(); another.lookup.mockImplementation(async ({ query }) => query.includes('"email"') ? [card({ title: "Fictional New Gardens", url: "https://www.wyndham.vic.gov.au/directory/fictional-new-gardens", description: `${sector(query)} in Berwick, Victoria. new-gardens@businessmail.com` })] : [card({ title: "Fictional New Gardens", url: "https://fictionalnewgardens.com.au", description: "Fictional official business website for this isolated test." })]);
    const rejected = await another.service.step(input({ count: 1 })); expect(rejected.leadIds).toEqual([]); expect(rejected.exclusions.ownWebsite).toBe(1);
  });

  it("does not treat generic, mismatched, shared, ambiguous or multi-business cards as title-only identity", async () => {
    const s = setup();
    s.lookup.mockImplementation(async ({ query }) => query.includes('"email"') ? [
      card({ title: "Directory Search", url: "https://www.wyndham.vic.gov.au/directory/search", description: `${sector(query)} in Berwick. first@businessmail.com` }),
      card({ title: "Fictional Wrong Gardens", url: "https://www.wyndham.vic.gov.au/directory/different-business", description: `${sector(query)} in Berwick. second@businessmail.com` }),
      card({ title: "Fictional Supplier Gardens", url: "https://www.casey.vic.gov.au/provider-directory-old-cheese-factory", description: `${sector(query)} in Berwick. third@businessmail.com` }),
      card({ title: "Fictional Shared Gardens | Another Fictional Business", url: "https://www.wyndham.vic.gov.au/directory/fictional-shared-gardens", description: `${sector(query)} in Berwick. fourth@businessmail.com` }),
      card({ title: "Fictional Related Gardens", url: "https://www.wyndham.vic.gov.au/directory/fictional-related-gardens", description: `${sector(query)} in Berwick. Related businesses: Another Fictional Business. fifth@businessmail.com` }),
      card({ title: "Fictional Ambiguous Gardens", url: "https://www.wyndham.vic.gov.au/directory/fictional-ambiguous-gardens", description: `${sector(query)} in Berwick. sixth@businessmail.com and seventh@businessmail.com` }),
    ] : []);
    const result = await s.service.step(input()); expect(result.leadIds).toEqual([]); expect(s.lookup.mock.calls.every(([request]) => request.query.includes('"email"'))).toBe(true);
    expect(result.exclusions.missingEmail).toBeGreaterThan(0); expect(result.exclusions.nonBusiness).toBeGreaterThan(0); expect(result.exclusions.unverified).toBeGreaterThan(0);
  });

  it("does not guess missing emails or choose between ambiguous recipients", async () => {
    const s = setup(); s.lookup.mockImplementationOnce(async ({ query }) => [
      { ...candidate("No Email Gardens", "", sector(query)), description: `No Email Gardens ${sector(query)} in Berwick. Use our contact form.` },
      { ...candidate("Two Email Gardens", "first@businessmail.com", sector(query)), description: `Two Email Gardens ${sector(query)} in Berwick. first@businessmail.com and other@businessmail.com` },
    ]);
    const r = await s.service.step(input()); expect(r.exclusions.missingEmail).toBe(2); expect(r.leadIds).toEqual([]);
  });

  it("refuses category/search/job pages, locality mismatches and source footer addresses", async () => {
    const s = setup(); s.lookup.mockImplementationOnce(async ({ query }) => [
      { ...candidate("Best 10 Garden Businesses", undefined, sector(query)) },
      { ...candidate("Sydney Local Gardens", undefined, sector(query)), description: "Sydney Local Gardens garden maintenance in Sydney. info@businessmail.com" },
      { ...candidate("Acme Local Gardens", "support@facebook.com", sector(query)) },
      { ...candidate("Acme Local Gardens", "mail@wyndham.vic.gov.au", sector(query)), url: "https://www.wyndham.vic.gov.au/business-directory/acme-local-gardens" },
      { ...candidate("Acme Local Gardens", undefined, sector(query)), url: "http://127.0.0.1/private" },
    ]);
    const r = await s.service.step(input()); expect(r.leadIds).toEqual([]); expect(r.exclusions.nonBusiness).toBe(2); expect(r.exclusions.unverified).toBe(1); expect(r.exclusions.missingEmail).toBe(2);
  });

  it("deduplicates punctuation/name variants and shared email addresses against historical records", async () => {
    const s = setup(); addSeed(s, { name: "A & S Gardens Pty Ltd", email: "prior@businessmail.com" });
    s.lookup.mockImplementationOnce(async ({ query }) => [candidate("A S Gardens", "new@businessmail.com", sector(query)), candidate("Another Local Business", "PRIOR@businessmail.com", sector(query))]);
    const r = await s.service.step(input()); expect(r.exclusions.duplicate).toBe(2); expect(r.leadIds).toHaveLength(0);
  });

  it("reserves an interrupted request, never repeats its query, and resumes at the next cursor", async () => {
    const s = setup(); await s.service.step(input());
    const stored = s.rt.atlas.deps.store.getDoc<any>("no_website_research_states", input().reportId)!.doc;
    const cursor = stored.cursor; stored.inFlight = { kind: "discovery", reservedAt: initial().toISOString() };
    s.rt.atlas.deps.store.upsertDoc("no_website_research_states", input().reportId, stored); s.advance();
    const r = await s.service.step(input()); const latest = s.rt.atlas.deps.store.getDoc<any>("no_website_research_states", input().reportId)!.doc;
    expect(latest.cursor).toBe(cursor + 2); expect(r.errors.join(" ")).toContain("not repeated");
    expect(new Set(s.lookup.mock.calls.map(([request]) => request.query)).size).toBe(4);
  });

  it("does not rediscover a legacy prospect that has not yet been imported into acquisition", async () => {
    const s = setup(); s.rt.atlas.prospects.upsert({ businessName: "Acme Local Gardens", location: "Berwick", industry: "garden maintenance", website: "https://acmelocalgardens.com.au", evidence: [], commercialOpportunity: "Existing research", recommendedScope: "Owner review", internalRecommendedPriceAud: null });
    s.lookup.mockImplementationOnce(async ({ query }) => [candidate(undefined, undefined, sector(query))]);
    const r = await s.service.step(input()); expect(r.exclusions.duplicate).toBe(1); expect(r.leadIds).toEqual([]);
  });

  it("refuses a stale blank acquisition website when its linked prospect has gained an independent site", () => {
    const s = setup(), record = addSeed(s); const prospect = s.rt.atlas.prospects.require(record.prospectId);
    prospect.website = "https://acmelocalgardens.com.au/"; s.rt.atlas.deps.store.upsertDoc("prospects", prospect.id, prospect);
    expect(s.service.seed({ ...input({ area: "Melbourne", count: 1 }), leadIds: [record.id] }).leadIds).toEqual([]);
  });

  it("sanitises provider failures and never retries or starts a fallback", async () => {
    const s = setup(); s.lookup.mockRejectedValueOnce(new Error("secret-provider-body-and-token"));
    const r = await s.service.step(input()); expect(r.state).toBe("partial"); expect(r.searchCount).toBe(1); expect(JSON.stringify(r)).not.toContain("secret-provider");
    await s.service.step(input()); expect(s.lookup).toHaveBeenCalledTimes(1);
  });

  it("expires at the Melbourne midnight boundary and rejects changed report scope", async () => {
    const s = setup(); s.set(new Date("2026-10-27T12:59:59Z")); await s.service.step(input());
    s.set(new Date("2026-10-27T13:00:00Z")); const r = await s.service.step(input()); expect(r.state).toBe("partial"); expect(s.lookup).toHaveBeenCalledTimes(2);
    await expect(s.service.step(input({ count: 19 }))).rejects.toThrow("cannot change scope");
  });

  it("does not start a second backdated request if the first lookup crosses Melbourne midnight", async () => {
    const s = setup(); s.set(new Date("2026-10-27T12:59:59Z"));
    s.lookup.mockImplementationOnce(async () => { s.set(new Date("2026-10-27T13:00:00Z")); return []; });
    const r = await s.service.step(input()); expect(r.state).toBe("partial"); expect(r.searchCount).toBe(1); expect(s.lookup).toHaveBeenCalledTimes(1);
  });

  it("interleaves sectors/sources immediately and rotates tomorrow's discovery queries", async () => {
    const s = setup(); await s.service.step(input({ area: "Melbourne, Victoria" }));
    const first = s.lookup.mock.calls.map(([r]) => r.query); expect(first[0]).not.toBe(first[1]); expect(sector(first[0]!)).not.toBe(sector(first[1]!)); expect(first[0]!.match(/^site:\S+/)?.[0]).not.toBe(first[1]!.match(/^site:\S+/)?.[0]);
    s.set(new Date("2026-10-28T00:00:00Z")); await s.service.step(input({ reportId: "outreach_2026-10-28", area: "Melbourne, Victoria" }));
    expect(s.lookup.mock.calls[2]![0].query).not.toBe(first[0]);
  });

  it("accepts today's explicitly reviewed council and booking-source seeds across Melbourne without new lookups", () => {
    const s = setup(); const a = addSeed(s), b = addSeed(s, { name: "Second Local Business", location: "Cranbourne West, Victoria", email: "second@businessmail.com", source: "https://secondlocalbusiness.setmore.com/" });
    const r = s.service.seed({ ...input({ area: "Melbourne and South Eastern Melbourne, Victoria", count: 2 }), leadIds: [a.id, b.id] });
    expect(r).toMatchObject({ state: "completed", leadIds: [a.id, b.id], shortfallCount: 0, searchCount: 0 }); expect(s.lookup).not.toHaveBeenCalled();
    expect(s.service.seed({ ...input({ area: "Melbourne and South Eastern Melbourne, Victoria", count: 2 }), leadIds: [a.id] }).leadIds).toHaveLength(2);
  });

  it.each(["sent", "replied", "follow_up", "closed", "do_not_contact"])("excludes the private manual-email ledger status %s", status => {
    const s = setup(); const r = addSeed(s); s.rt.atlas.deps.store.upsertDoc("prospect_pricing", r.id, { manualEmailStatus: status });
    expect(s.service.seed({ ...input({ area: "Melbourne", count: 1 }), leadIds: [r.id] }).leadIds).toEqual([]);
  });

  it("excludes previously imported manual prospects by name or email before spending a website lookup", async () => {
    const s = setup();
    s.rt.atlas.deps.store.upsertDoc("manual_outreach_seeds", "manual_fictional_prior", { businessName: "Already Reviewed Local Business", contactEmail: "prior@businessmail.com" });
    s.lookup.mockImplementation(async ({ query }) => query.includes('"email"') ? [candidate("Already Reviewed Local Business", "changed@businessmail.com", sector(query)), candidate("Different Local Business", "prior@businessmail.com", sector(query))] : []);
    const result = await s.service.step(input());
    expect(result.leadIds).toEqual([]); expect(result.exclusions.duplicate).toBe(4);
    expect(s.lookup.mock.calls.every(([request]) => request.query.includes('"email"'))).toBe(true);
  });

  it("keeps globally suppressed email addresses out of new discovery and explicit seed imports", async () => {
    const s = setup(), address = "stopped@businessmail.com";
    s.rt.atlas.deps.store.upsertDoc("acquisition_suppressions", createHash("sha256").update(address).digest("hex"), { source: "owner_manual_outreach" });
    s.lookup.mockImplementation(async ({ query }) => query.includes('"email"') ? [candidate("Stopped Local Business", address, sector(query))] : []);
    const found = await s.service.step(input()); expect(found.leadIds).toEqual([]); expect(found.exclusions.duplicate).toBe(2);
    const lead = addSeed(s, { name: "Stopped Local Business", email: address });
    expect(s.service.seed({ ...input(), leadIds: [lead.id] }).leadIds).toEqual([]);
  });

  it("refuses stale/malformed qualifications, unrelated-region seeds and prior-day reuse", () => {
    const s = setup(); const r = addSeed(s); s.rt.atlas.deps.store.setMemory(noWebsiteQualificationKey(r.id), { checkedAt: "invalid-date" });
    expect(s.service.seed({ ...input({ area: "Melbourne", count: 1 }), leadIds: [r.id] }).leadIds).toEqual([]);
    const other = addSeed(s, { name: "Sydney Local Business", location: "Sydney, NSW", email: "sydney@businessmail.com" });
    expect(s.service.seed({ ...input({ area: "Melbourne", count: 1 }), leadIds: [other.id] }).leadIds).toEqual([]);
    const valid = addSeed(s, { name: "Third Local Business", email: "third@businessmail.com" });
    expect(s.service.seed({ ...input({ area: "Melbourne", count: 1 }), leadIds: [valid.id] }).leadIds).toEqual([valid.id]);
    s.set(new Date("2026-10-28T00:00:00Z")); s.rt.atlas.deps.store.setMemory(noWebsiteQualificationKey(valid.id), { day: "2026-10-28", checkedAt: "2026-10-28T00:00:00Z", sourceUrl: valid.sourceUrl, email: valid.contact!.email, noIndependentWebsiteFound: true, searchQueries: ["fresh explicit check"] });
    expect(s.service.seed({ ...input({ reportId: "outreach_2026-10-28", area: "Melbourne", count: 1 }), leadIds: [valid.id] }).leadIds).toEqual([]);
  });
});

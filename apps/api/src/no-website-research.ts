import { createHash } from "node:crypto";
import { isCustomerStage, type AcquisitionRecord, type AcquisitionService, type Atlas, type ResearchLookupResult } from "@atlas/core";

const STATES = "no_website_research_states", CLAIMS = "no_website_research_claims";
const MAX_LOOKUPS = 40, PER_MINUTE = 2;
const LOCALITIES = ["Melbourne", "South Melbourne", "Richmond", "St Kilda", "Oakleigh", "Clayton", "Springvale", "Dandenong", "Noble Park", "Keysborough", "Cranbourne", "Cranbourne West", "Berwick", "Narre Warren", "Officer", "Pakenham", "Frankston", "Chelsea", "Mordialloc", "Werribee", "Hoppers Crossing", "Tarneit", "Truganina", "Point Cook", "Wyndham Vale", "Laverton", "Footscray", "Sunshine", "Altona", "Newport", "Williamstown", "Brunswick", "Coburg", "Preston", "Epping", "Bundoora", "Reservoir", "Broadmeadows", "Craigieburn"];
const SECTORS = ["garden maintenance", "car detailing", "hair salon", "cafe", "personal training", "cleaning", "fencing", "plumbing"];
const SECTOR_MATCH = [/garden|landscap|lawn|hedg/i, /car detail|auto detail|ceramic coat|paint correction/i, /hair|salon|barber/i, /caf[eé]|coffee|breakfast/i, /personal train|fitness|gym|boxing|pilates/i, /cleaning|cleaner|cleaners/i, /fenc|gates?/i, /plumb|drain|gasfit/i];
const SOURCES = ["wyndham.vic.gov.au", "facebook.com", "yellowpages.com.au", "casey.vic.gov.au", "truelocal.com.au", "greaterdandenong.vic.gov.au", "instagram.com", "localsearch.com.au", "frankston.vic.gov.au", "fresha.com", "setmore.com"];
const SOURCE_LOCALITIES: Readonly<Record<string, readonly string[]>> = {
  "wyndham.vic.gov.au": ["Werribee", "Hoppers Crossing", "Tarneit", "Truganina", "Point Cook", "Wyndham Vale"],
  "casey.vic.gov.au": ["Cranbourne", "Cranbourne West", "Berwick", "Narre Warren"],
  "greaterdandenong.vic.gov.au": ["Dandenong", "Noble Park", "Springvale", "Keysborough"],
  "frankston.vic.gov.au": ["Frankston"],
};
const INTERMEDIARIES = [...SOURCES, "fb.com", "linkedin.com", "linktr.ee", "youtube.com", "tiktok.com", "yelp.com", "yelp.com.au", "google.com", "google.com.au", "bing.com", "australia247.info", "findglocal.com", "whereis.com", "hipages.com.au", "oneflare.com.au", "hotfrog.com.au", "wordofmouth.com.au"];
export type NoWebsiteTemplate = "simple" | "clarity" | "immersive";
export interface NoWebsiteResearchInput { reportId: string; area: string; count: number; templateId: NoWebsiteTemplate }
export interface NoWebsiteQualification { day: string; checkedAt: string; sourceUrl: string; email: string; noIndependentWebsiteFound: true; searchQueries: string[] }
export const noWebsiteQualificationKey = (leadId: string) => `no_website_research.qualification.${leadId}`;
export interface NoWebsiteResearchResult {
  state: "running" | "completed" | "partial" | "blocked"; leadIds: string[];
  requestedCount: number; targetCount: number; candidateCount: number; shortfallCount: number;
  searchCount: number; daySearchCount: number; nextStepAt?: string; errors: string[];
  exclusions: { duplicate: number; missingEmail: number; ownWebsite: number; unverified: number; nonBusiness: number };
}
interface Candidate { name: string; email: string; sourceUrl: string; locality: string; industry: string; excerpt: string; query: string }
interface State {
  input: NoWebsiteResearchInput; day: string; state: NoWebsiteResearchResult["state"]; cursor: number;
  leadIds: string[]; queue: Candidate[]; seen: string[]; searchCount: number; candidateCount: number;
  errors: string[]; exclusions: NoWebsiteResearchResult["exclusions"];
  inFlight?: { kind: "discovery" | "website"; reservedAt: string };
}
interface Budget { count: number; recent: number[] }
interface Options { atlas: Atlas; acquisition: AcquisitionService; clock?: () => Date }
const active = new WeakSet<object>();
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const bounded = (s: string, max: number) => s.replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/&amp;/gi, "&").replace(/&(?:quot|#34);/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim().slice(0, max);
export const noWebsiteBusinessKey = (s: string) => bounded(s, 200).normalize("NFKC").toLocaleLowerCase("en-AU").replace(/\b(?:pty|ltd|limited|proprietary)\b/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
const emailKey = (s: string) => s.trim().toLowerCase();
const providerEmail = (email: string) => {
  const host = email.split("@")[1] ?? "";
  return /^(?:no-?reply|donotreply)@/.test(email) || host.endsWith(".gov.au") || ["example.com", "example.org", ...INTERMEDIARIES].some(domain => host === domain || host.endsWith("." + domain));
};
const day = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
function url(raw: string): URL | null {
  try { const u = new URL(raw); return /^https?:$/.test(u.protocol) && !u.username && !u.password && !u.port && /^[a-z\d.-]+\.[a-z]{2,}$/i.test(u.hostname) && !/(?:^|\.)(?:local|localhost|internal|test|invalid|example)$/.test(u.hostname) && raw.length <= 2048 ? u : null; } catch { return null; }
}
const inHosts = (u: URL, hosts: string[]) => hosts.some(h => u.hostname === h || u.hostname.endsWith("." + h));
const ownSite = (raw: string | null) => { const u = raw ? url(raw) : null; return Boolean(u && !inHosts(u, INTERMEDIARIES)); };
const named = (text: string, name: string) => (` ${noWebsiteBusinessKey(text)} `).includes(` ${noWebsiteBusinessKey(name)} `);
function localities(area: string): string[] {
  if (/\bmelbourne\b|south[ -]?east|south[ -]?eastern/i.test(area)) return LOCALITIES;
  return LOCALITIES.filter(town => new RegExp(`\\b${town.replace(/ /g, "\\s+")}\\b`, "i").test(area));
}
/** A council is searched only for its own supported suburbs. Appointment
 * directories are not queried for unrelated trades. Planning makes no request. */
export function planNoWebsiteDiscovery(input: { area: string; day: string; index: number }): { locality: string; industry: string; source: string; query: string } {
  const towns = localities(input.area);
  if (!towns.length || !/^20\d\d-\d\d-\d\d$/.test(input.day) || !Number.isInteger(input.index) || input.index < 0 || input.index >= MAX_LOOKUPS) throw new RangeError("Use a supported area, day and bounded discovery cursor.");
  const rotation = Number.parseInt(digest(input.day).slice(0, 6), 16), index = input.index;
  const locality = towns[(index * 7 + rotation) % towns.length]!, industry = SECTORS[(index + rotation) % SECTORS.length]!;
  const compatible = SOURCES.filter(source => (!SOURCE_LOCALITIES[source] || SOURCE_LOCALITIES[source]!.includes(locality)) && (source !== "fresha.com" || industry === "hair salon" || industry === "personal training"));
  const source = compatible[(index + Math.floor(index / SOURCES.length) + rotation) % compatible.length]!;
  return { locality, industry, source, query: `site:${source} "${locality}" "${industry}" "email"` };
}
function validate(input: NoWebsiteResearchInput): NoWebsiteResearchInput {
  if (!/^[-a-zA-Z0-9_:]{1,120}$/.test(input.reportId) || !Number.isInteger(input.count) || input.count < 1 || input.count > 20 || !["simple", "clarity", "immersive"].includes(input.templateId) || typeof input.area !== "string" || !input.area.trim() || input.area.length > 160 || /[\u0000-\u001f\u007f]/.test(input.area) || !localities(input.area).length) throw new RangeError("Use one to twenty private demos and a supported Melbourne locality.");
  return { reportId: input.reportId, area: input.area.trim(), count: input.count, templateId: input.templateId };
}
function notBusiness(title: string, path: string): boolean {
  const primary = title.split(/\s+[|–—•-]\s+/)[0]!;
  return /\b(?:top|best)\s+\d|\b(?:search results|jobs?|vacancies|businesses for sale|recruitment|government|newspaper)\b/i.test(primary) || /^(?:(?:local|business|community|trade)\s+)*directory\b/i.test(primary) || /\b(?:businesses|companies|contractors|plumbers|salons|gyms|cafes)\s+(?:in|near|around)\b/i.test(primary) || /\/(?:groups|search|explore|events|jobs|careers|category|categories)(?:\/|$)/i.test(path);
}
function individualCouncilIdentity(source: URL, title: string, name: string, excerpt: string): boolean {
  const host = source.hostname.replace(/^www\./, "");
  if (!SOURCE_LOCALITIES[host] || source.search || /\b(?:other|related|featured)\s+(?:businesses|suppliers|providers|listings)\b/i.test(excerpt)) return false;
  const path = /^\/directory\/([^/]+)\/?$/.exec(source.pathname);
  if (!path) return false;
  let slug: string; try { slug = decodeURIComponent(path[1]!); } catch { return false; }
  if (/^(?:search|category|categories|index|all|providers|suppliers)$/i.test(slug)) return false;
  const identity = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en-AU").replace(/[^\p{L}\p{N}]/gu, "");
  const tails = title.split(/\s+[|–—•-]\s+/).slice(1);
  if (tails.some(value => !/^(?:business directory|wyndham(?: city)?(?: council)?|(?:city of )?casey(?: city)?(?: council)?|greater dandenong(?: city)?(?: council)?|frankston(?: city)?(?: council)?)$/i.test(value))) return false;
  return identity(name) === identity(slug) || identity(name) === identity(slug.replace(/-\d+$/, ""));
}

/** Resumable bounded source research. The caller enforces the keyless-provider
 * gate and schedules continuation; this module has no timer or transport for
 * mail, publishing, speech, models or quotes. Search excerpts remain untrusted.
 */
export class NoWebsiteResearch {
  private readonly store;
  private readonly clock: () => Date;
  constructor(private readonly options: Options) { this.store = options.atlas.deps.store; this.clock = options.clock ?? options.atlas.clock; }
  private budgetKey(d: string) { return `no_website_research.budget.${d}`; }
  private budget(d: string): Budget { return this.store.getMemory<Budget>(this.budgetKey(d)) ?? { count: 0, recent: [] }; }
  private save(s: State) { this.store.upsertDoc(STATES, s.input.reportId, s); }
  private state(raw: NoWebsiteResearchInput): State {
    const input = validate(raw), existing = this.store.getDoc<State>(STATES, input.reportId)?.doc;
    if (existing) {
      if (JSON.stringify(existing.input) !== JSON.stringify(input)) throw new RangeError("An existing research report cannot change scope or target.");
      return existing;
    }
    const s: State = { input, day: day(this.clock()), state: "running", cursor: 0, leadIds: [], queue: [], seen: [], searchCount: 0, candidateCount: 0, errors: [], exclusions: { duplicate: 0, missingEmail: 0, ownWebsite: 0, unverified: 0, nonBusiness: 0 } };
    this.save(s); return s;
  }
  private result(s: State): NoWebsiteResearchResult {
    const b = this.budget(s.day), recent = b.recent.filter(at => this.clock().getTime() - at < 60_000);
    const wait = recent.length >= PER_MINUTE ? new Date(Math.min(...recent) + 60_001).toISOString() : undefined;
    return { state: s.state, leadIds: [...s.leadIds], requestedCount: s.input.count, targetCount: s.input.count, candidateCount: s.candidateCount, shortfallCount: Math.max(0, s.input.count - s.leadIds.length), searchCount: s.searchCount, daySearchCount: b.count, ...(s.state === "running" && wait ? { nextStepAt: wait } : {}), errors: [...s.errors], exclusions: { ...s.exclusions } };
  }
  private records(): AcquisitionRecord[] { return this.store.listDocs<AcquisitionRecord>("acquisition_records", 10_000).map(r => r.doc); }
  private claimKey(kind: string, value: string) { return digest(kind + ":" + value); }
  private claimed(kind: string, value: string) { return Boolean(this.store.getDoc(CLAIMS, this.claimKey(kind, value))); }
  private reserveLead(s: State, record: AcquisitionRecord) {
    for (const [kind, value] of [["name", noWebsiteBusinessKey(record.businessName)], ["email", emailKey(record.contact!.email)], ["lead", record.id]]) this.store.upsertDoc(CLAIMS, this.claimKey(kind!, value!), { reportId: s.input.reportId, day: s.day, leadId: record.id });
    s.leadIds.push(record.id); if (s.leadIds.length >= s.input.count) s.state = "completed"; this.save(s);
  }
  private duplicate(c: Candidate): boolean {
    return this.manuallyKnown(c.name, c.email) || this.claimed("name", noWebsiteBusinessKey(c.name)) || this.claimed("email", emailKey(c.email)) || this.records().some(r => noWebsiteBusinessKey(r.businessName) === noWebsiteBusinessKey(c.name) || emailKey(r.contact?.email ?? "") === emailKey(c.email)) || this.options.atlas.prospects.list().some(p => noWebsiteBusinessKey(p.businessName) === noWebsiteBusinessKey(c.name) || emailKey(this.store.getMemory<{ email?: string }>(`prospect.contact.${p.id}`)?.email ?? "") === emailKey(c.email));
  }
  private manuallyKnown(name: string, email: string): boolean {
    return Boolean(this.store.getDoc("acquisition_suppressions", digest(emailKey(email)))) || this.store.listDocs<{ businessName: string; contactEmail: string }>("manual_outreach_seeds", 100).some(({ doc }) => typeof doc.businessName === "string" && noWebsiteBusinessKey(doc.businessName) === noWebsiteBusinessKey(name) || typeof doc.contactEmail === "string" && emailKey(doc.contactEmail) === emailKey(email));
  }
  /** Only explicitly reviewed private seed qualifications can bypass a lookup.
   * Merely having a draft or a blank website never qualifies an existing lead. */
  seed(input: NoWebsiteResearchInput & { leadIds: string[] }): NoWebsiteResearchResult {
    const { leadIds, ...base } = input, s = this.state(base);
    if (s.state !== "running" || s.day !== day(this.clock())) return this.result(s);
    if (active.has(this.store)) return { ...this.result(s), nextStepAt: new Date(this.clock().getTime() + 60_001).toISOString() };
    if (!Array.isArray(leadIds) || leadIds.length > 20) throw new RangeError("Seed at most twenty explicitly reviewed private leads.");
    for (const id of [...new Set(leadIds)]) {
      if (s.leadIds.includes(id) || s.leadIds.length >= s.input.count) continue;
      const record = this.store.getDoc<AcquisitionRecord>("acquisition_records", id)?.doc;
      const q = this.store.getMemory<NoWebsiteQualification>(noWebsiteQualificationKey(id));
      const p = record ? this.options.atlas.prospects.get(record.prospectId) : null;
      const source = record ? url(record.sourceUrl) : null;
      const checked = q && typeof q.checkedAt === "string" ? new Date(q.checkedAt) : null;
      const manual = this.store.getDoc<{ manualEmailStatus?: string }>("prospect_pricing", id)?.doc?.manualEmailStatus;
      const valid = record && q && p && !record.archivedAt && !p.fixture && !p.contactEligibility.suppressed && p.qualification !== "disqualified" && !isCustomerStage(p.stage) && p.outreach.length === 0 && !["sent", "replied", "follow_up", "closed", "do_not_contact"].includes(manual ?? "") && !["accepted", "queued", "submitting", "uncertain", "cancelled", "simulated"].includes(record.draft?.status ?? "") && !ownSite(record.website) && !ownSite(p.website) && source && source.protocol === "https:" && (inHosts(source, SOURCES) || source.hostname.endsWith(".gov.au") || inHosts(source, ["setmore.com"])) && localities(s.input.area).some(town => named(record.location, town)) && record.contact?.email && !this.manuallyKnown(record.businessName, record.contact.email) && q.day === s.day && checked && Number.isFinite(checked.getTime()) && checked.toISOString().slice(0, 19) === q.checkedAt.slice(0, 19) && checked.getTime() <= this.clock().getTime() && day(checked) === s.day && q.noIndependentWebsiteFound === true && q.sourceUrl === record.sourceUrl && q.sourceUrl === record.contact.sourceUrl && q.email === record.contact.email && Array.isArray(q.searchQueries) && q.searchQueries.length > 0 && q.searchQueries.length <= 6 && q.searchQueries.every(v => typeof v === "string" && v.trim().length > 2 && v.length <= 400) && !this.claimed("lead", id) && !this.claimed("name", noWebsiteBusinessKey(record.businessName)) && !this.claimed("email", emailKey(record.contact.email));
      if (!valid) { s.exclusions.unverified++; continue; }
      s.candidateCount++;
      this.reserveLead(s, record);
    }
    this.save(s); return this.result(s);
  }
  async step(input: NoWebsiteResearchInput): Promise<NoWebsiteResearchResult> {
    const s = this.state(input);
    if (s.state !== "running") return this.result(s);
    if (s.day !== day(this.clock())) { s.state = "partial"; s.errors.push("The Melbourne research day expired. No backdated lookup was made."); this.save(s); return this.result(s); }
    if (active.has(this.store)) return { ...this.result(s), nextStepAt: new Date(this.clock().getTime() + 60_001).toISOString() };
    if (!this.options.atlas.deps.lookup) { s.state = "blocked"; s.errors.push("Public-source lookup is unavailable. No substitute or paid fallback was used."); this.save(s); return this.result(s); }
    active.add(this.store);
    try {
      if (s.inFlight) { s.errors.push("An interrupted lookup had an unknown outcome and was not repeated."); if (s.inFlight.kind === "website") s.exclusions.unverified++; delete s.inFlight; this.save(s); }
      for (let calls = 0; calls < 2 && s.state === "running"; calls++) {
        if (s.day !== day(this.clock())) { s.state = "partial"; s.errors.push("The Melbourne day expired during research. No further backdated lookup was made."); break; }
        const b = this.budget(s.day), now = this.clock().getTime(); b.recent = b.recent.filter(at => now - at < 60_000);
        if (b.count >= MAX_LOOKUPS || s.cursor >= MAX_LOOKUPS) { s.state = "partial"; s.errors.push("The forty-lookup Melbourne-day budget was reached; the remaining target is a reported shortfall."); break; }
        if (b.recent.length >= PER_MINUTE) break;
        let candidate: Candidate | undefined;
        while (s.queue.length && !candidate) {
          const next = s.queue.shift()!;
          if (this.duplicate(next)) s.exclusions.duplicate++; else candidate = next;
        }
        const planned = planNoWebsiteDiscovery({ area: s.input.area, day: s.day, index: s.cursor });
        const { locality, industry } = planned;
        const query = candidate ? `"${candidate.name.replace(/["\\]/g, " ")}" "${candidate.locality}" official website` : planned.query;
        if (!candidate) s.cursor++;
        s.inFlight = { kind: candidate ? "website" : "discovery", reservedAt: this.clock().toISOString() };
        b.count++; b.recent.push(now); s.searchCount++; this.store.setMemory(this.budgetKey(s.day), b); this.save(s);
        let results: ResearchLookupResult[];
        try { results = await this.options.atlas.deps.lookup.lookup({ query, count: 10 }); }
        catch { delete s.inFlight; s.state = "partial"; s.errors.push("A public-source lookup failed or reached its provider limit. No retry, fictional replacement or paid fallback was used."); this.save(s); break; }
        delete s.inFlight;
        if (s.day !== day(this.clock())) { s.state = "partial"; s.errors.push("A lookup crossed the Melbourne day boundary. Its results were not counted as today's new contacts."); break; }
        if (!Array.isArray(results)) { s.state = "partial"; s.errors.push("The lookup response was unusable. No candidates were invented."); break; }
        if (candidate) this.qualify(s, candidate, results.slice(0, 10), query);
        else this.collect(s, results.slice(0, 10), locality, industry, query);
        this.save(s);
      }
      this.save(s); return this.result(s);
    } finally { active.delete(this.store); }
  }
  private collect(s: State, results: ResearchLookupResult[], locality: string, industry: string, query: string) {
    for (const result of results) {
      if (!result || typeof result.title !== "string" || typeof result.description !== "string" || typeof result.url !== "string") { s.exclusions.unverified++; continue; }
      const source = url(result.url), title = bounded(result.title, 240), excerpt = bounded(result.description, 1200);
      if (!source || !inHosts(source, SOURCES) || notBusiness(title, source.pathname)) { s.exclusions.nonBusiness++; continue; }
      const name = bounded(title.split(/\s+[|–—•-]\s+/)[0]!.replace(/\s*\(?(?:Facebook|Instagram|Yellow Pages|True Local|Fresha|Setmore)\)?\s*$/i, ""), 160);
      const key = noWebsiteBusinessKey(name);
      if (key.split(" ").length < 2 || !(named(excerpt, name) || individualCouncilIdentity(source, title, name, excerpt)) || !new RegExp(`\\b${locality.replace(/ /g, "\\s+")}\\b`, "i").test(excerpt) || !SECTOR_MATCH[SECTORS.indexOf(industry)]!.test(title + " " + excerpt) || /@|https?:|\$/.test(name)) { s.exclusions.unverified++; continue; }
      const emails = [...new Set((excerpt.match(/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}/g) ?? []).map(emailKey).filter(e => !providerEmail(e)))];
      if (emails.length !== 1) { s.exclusions.missingEmail++; continue; }
      const c: Candidate = { name, email: emails[0]!, sourceUrl: source.href, locality, industry, excerpt, query };
      if (s.seen.includes(key) || this.duplicate(c)) { s.exclusions.duplicate++; continue; }
      s.seen.push(key); s.candidateCount++; s.queue.push(c);
    }
  }
  private qualify(s: State, candidate: Candidate, results: ResearchLookupResult[], websiteQuery: string) {
    const relevant = results.filter(r => r && typeof r.title === "string" && typeof r.description === "string" && typeof r.url === "string" && named(r.title + " " + r.description, candidate.name));
    if (relevant.some(r => ownSite(r.url))) { s.exclusions.ownWebsite++; return; }
    if (this.duplicate(candidate)) { s.exclusions.duplicate++; return; }
    try {
      const record = this.options.acquisition.addLead({ businessName: candidate.name, location: `${candidate.locality}, Victoria`, industry: candidate.industry, website: null, sourceUrl: candidate.sourceUrl, observation: bounded(`Public source excerpt: ${candidate.excerpt}. A bounded exact-name/locality lookup did not find an independent business website. This is not proof that none exists. Search: ${candidate.query}; ${websiteQuery}. Business identity, facts and email relevance require owner review; no email permission or deliverability is established.`, 1800), contactEmail: candidate.email, contactSourceUrl: candidate.sourceUrl });
      this.store.setMemory(noWebsiteQualificationKey(record.id), { day: s.day, checkedAt: this.clock().toISOString(), sourceUrl: candidate.sourceUrl, email: candidate.email, noIndependentWebsiteFound: true, searchQueries: [candidate.query, websiteQuery] } satisfies NoWebsiteQualification);
      this.reserveLead(s, record);
    } catch { s.exclusions.unverified++; s.errors.push("A source candidate could not be saved. No substitute business or email was invented."); }
  }
}

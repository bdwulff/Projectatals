import { contentHash, isCustomerStage, PermissionLevel, requiredLevel, type AcquisitionRecord, type AcquisitionService, type Atlas, type Evidence, type Prospect } from "@atlas/core";
import type { Hono } from "hono";
import type { Runtime } from "./runtime.js";

const REPORTS = "site_rebuild_reports", JOB = "site_rebuilds", POLICY = "immersive-private-v1";
const MAX_RECORDS = 10_000, MAX_TARGETS = 500;
const UNSAFE_DRAFTS = new Set(["accepted", "queued", "submitting", "uncertain", "simulated", "cancelled"]);
const SOCIAL = ["facebook.com", "fb.com", "instagram.com", "linkedin.com", "tiktok.com", "youtube.com", "youtu.be", "x.com", "twitter.com", "linktr.ee"];
const DIRECTORIES = ["yellowpages.com.au", "truelocal.com.au", "hipages.com.au", "oneflare.com.au", "service.com.au", "findglocal.com", "localsearch.com.au", "hotfrog.com.au", "wordofmouth.com.au", "dlook.com.au", "yelp.com", "yelp.com.au", "australia247.info", "aussieweb.com.au", "pinkpages.com.au", "startlocal.com.au", "whereis.com", "abdirectory.com.au", "fresha.com"];

export interface SiteRebuildEvidence { observation: string; sourceUrl: string; status: string; uncertainty?: string }
export interface SiteRebuildCandidate {
  prospectId: string; leadId?: string; name: string; location: string; industry: string;
  classification: "not_recorded" | "social_only"; classificationLabel: string;
  evidence: SiteRebuildEvidence[]; uncertainty: string;
}
export interface SiteRebuildBusiness extends SiteRebuildCandidate {
  state: "pending" | "building" | "ready" | "skipped" | "failed"; demoReady: boolean;
  previewPath?: string; sourcePath?: string; design?: Record<string, unknown>; error?: string;
}
export interface SiteRebuildReport {
  id: string; state: "queued" | "running" | "completed" | "partial" | "failed";
  startedAt: string; finishedAt?: string; targetCount: number; rebuiltCount: number; skippedCount: number;
  businesses: SiteRebuildBusiness[]; errors: string[]; spokenSummary: string; fixture: boolean;
  notificationId?: string; reviewPath: string;
}
interface StoredReport extends SiteRebuildReport { fingerprints: Record<string, string>; jobKey: string; generation: number; ordinal: number }
interface Options { atlas: Atlas; acquisition: AcquisitionService; mode: "fake" | "live"; clock?: () => Date; notificationPriority?: "routine" | "action_needed" }
interface CandidateInput { prospect: Prospect; record?: AcquisitionRecord }
type Presence = "own_site" | "social_only" | "not_recorded" | "unknown";

export class SiteRebuildError extends Error { constructor(message: string, readonly status: 400 | 409 | 503 = 409) { super(message); } }

function bounded(value: unknown, max: number): string { return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : ""; }
function publicUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || !raw || raw.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(raw)) return null;
  try {
    const u = new URL(raw), host = u.hostname.toLowerCase().replace(/\.$/, "");
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.port || !host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || /(?:^|\.)(?:local|localhost|internal|home|lan|invalid)$/.test(host)) return null;
    return u;
  } catch { return null; }
}
function intermediary(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const suffix = (domains: string[]) => domains.some(domain => host === domain || host.endsWith("." + domain));
  return suffix(SOCIAL) || suffix(DIRECTORIES) || ((host === "google.com" || host === "www.google.com" || host === "google.com.au" || host === "www.google.com.au" || host === "bing.com" || host === "www.bing.com") && /^\/maps(?:\/|$)/.test(url.pathname));
}

/** Missing records are not proof of absence. First-party evidence wins over a blank website field. */
export function classifyWebsitePresence(input: { websites: unknown[]; evidence: Array<Pick<Evidence, "sourceUrl">> }): Presence {
  let social = false;
  for (const raw of input.websites) {
    if (raw === null || raw === undefined || raw === "") continue;
    const url = publicUrl(raw);
    if (!url) return "unknown";
    if (!intermediary(url)) return "own_site";
    social = true;
  }
  for (const evidence of input.evidence) {
    const url = publicUrl(evidence.sourceUrl);
    if (!url) continue;
    if (!intermediary(url)) return "unknown";
    social = true;
  }
  return social ? "social_only" : "not_recorded";
}

function safeEvidence(evidence: Evidence[]): SiteRebuildEvidence[] {
  return evidence.slice(0, 5).map(item => ({ observation: bounded(item.observation, 600), sourceUrl: publicUrl(item.sourceUrl)?.href ?? "", status: bounded(item.status, 30), ...(item.uncertainty ? { uncertainty: bounded(item.uncertainty, 400) } : {}) }));
}

/** Search/category/job-board results are not named potential clients. */
export function isBusinessListingTitle(raw: string): boolean {
  const name = bounded(raw, 200).toLowerCase();
  return /\b(?:business(?:es)? for sale|jobs? board|job vacancies|job search|positions vacant|employment opportunities|search results|business directory|government department|local council)\b/.test(name)
    || /\b(?:top|best)\s+\d+\b/.test(name)
    || /\b(?:contractors|companies|businesses|gyms|plumbers|electricians|jobs)\s+(?:in|near|around)\b/.test(name)
    || /^(?:find|list of|directory of)\b/.test(name)
    || ["fitnessjobs", "businessesforsale", "seek", "indeed"].includes(name.replace(/[^a-z0-9]/g, ""));
}

/** Existing records only: no search, network enrichment, mail, publishing or speech transport exists here. */
export class SiteRebuilds {
  private readonly store;
  private readonly clock: () => Date;
  private scheduled = new Set<string>();

  constructor(private readonly options: Options) {
    this.store = options.atlas.deps.store; this.clock = options.clock ?? options.atlas.clock;
    options.atlas.jobs.register<{ reportId: string }, { reportId: string }>(JOB, payload => this.execute(payload.reportId));
    // Only private code generation resumes. Already-ready rows are retained and never regenerated.
    for (const row of this.store.listDocs<StoredReport>(REPORTS, 20)) {
      if (!["queued", "running"].includes(row.doc.state)) continue;
      const report = row.doc;
      report.state = "queued"; report.generation += 1;
      report.jobKey = `${JOB}:${report.id}:resume:${report.generation}`;
      for (const business of report.businesses) if (business.state === "building") business.state = "pending";
      this.enqueue(report); this.save(report); this.kick(report.jobKey);
    }
  }

  async snapshot() {
    const inventory = this.inventory(), reports = this.reports().slice(0, 5).map(report => this.publicReport(report));
    const latestReport = reports[0] ?? null;
    return { mode: this.options.mode, candidates: inventory.candidates, excludedCount: inventory.excludedCount, latestReport, reports,
      run: latestReport ? { state: latestReport.state, detail: latestReport.spokenSummary } : { state: "idle" as const, detail: "Review existing prospects with no own website recorded, then prepare their private immersive demos." } };
  }

  async runNow() {
    const active = this.reports().find(report => ["queued", "running"].includes(report.state));
    if (active) { this.kick(active.jobKey); return this.snapshot(); }
    const inventory = this.inventory();
    if (inventory.truncated) throw new SiteRebuildError("The stored inventory exceeds this batch's safety limit. No rebuild was started; narrow the review scope.");
    if (inventory.candidates.length > MAX_TARGETS) throw new SiteRebuildError("More than 500 eligible businesses need review. No partial batch was silently started.");
    const fingerprints = Object.fromEntries(inventory.candidates.map(candidate => [candidate.prospectId, this.fingerprint(inventory.inputs.get(candidate.prospectId)!)]));
    const id = `rebuild_${contentHash({ policy: POLICY, mode: this.options.mode, company: this.options.acquisition.company(), targets: fingerprints }).slice(0, 24)}`;
    const existing = this.store.getDoc<StoredReport>(REPORTS, id)?.doc;
    if (existing) { if (["queued", "running"].includes(existing.state)) this.kick(existing.jobKey); return this.snapshot(); }
    const ordinal = (this.store.getMemory<number>("site_rebuilds.sequence") ?? 0) + 1;
    this.store.setMemory("site_rebuilds.sequence", ordinal);
    const report: StoredReport = { id, state: "queued", startedAt: this.iso(), targetCount: inventory.candidates.length, rebuiltCount: 0, skippedCount: 0,
      businesses: inventory.candidates.map(candidate => ({ ...candidate, state: "pending", demoReady: false })), errors: [], spokenSummary: "Private immersive demo preparation is queued. No business has been contacted.", fixture: this.options.mode === "fake",
      reviewPath: `/#pipeline?batch=${encodeURIComponent(id)}`, fingerprints, jobKey: `${JOB}:${id}`, generation: 0, ordinal };
    this.save(report); this.enqueue(report); this.kick(report.jobKey);
    this.options.atlas.audit.record({ actor: "owner", action: "execute.site_rebuilds.run", business: "wulff_studio", outcome: report.fixture ? "simulated" : "completed", detail: { reportId: id, targetCount: report.targetCount, operation: "private_batch_queued", policy: POLICY } });
    return this.snapshot();
  }

  private inventory() {
    const prospects = this.store.listDocs<Prospect>("prospects", MAX_RECORDS + 1).map(row => row.doc);
    const records = this.store.listDocs<AcquisitionRecord>("acquisition_records", MAX_RECORDS + 1).map(row => row.doc);
    const byProspect = new Map(records.map(record => [record.prospectId, record]));
    const candidates: SiteRebuildCandidate[] = [], inputs = new Map<string, CandidateInput>();
    let excludedCount = 0;
    for (const prospect of prospects.sort((a, b) => a.id.localeCompare(b.id))) {
      const record = byProspect.get(prospect.id);
      if ((this.options.mode === "live" && prospect.fixture) || isBusinessListingTitle(prospect.businessName) || isCustomerStage(prospect.stage) || prospect.contactEligibility.suppressed || prospect.qualification === "disqualified" || record?.archivedAt || (record?.draft && UNSAFE_DRAFTS.has(record.draft.status))) { excludedCount++; continue; }
      const evidence = [...prospect.evidence, ...(record?.sourceUrl ? [{ sourceUrl: record.sourceUrl } as Evidence] : [])];
      const classification = classifyWebsitePresence({ websites: [prospect.website, record?.website], evidence });
      if (classification !== "not_recorded" && classification !== "social_only") { excludedCount++; continue; }
      const candidate: SiteRebuildCandidate = { prospectId: prospect.id, ...(record ? { leadId: record.id } : {}), name: bounded(prospect.businessName, 160), location: bounded(prospect.location, 160), industry: bounded(prospect.industry, 120), classification,
        classificationLabel: classification === "social_only" ? "Only social/directory link found" : "No own website recorded", evidence: safeEvidence(prospect.evidence),
        uncertainty: "This is a gap in the recorded research, not proof that the business has no website. Confirm its current online presence before outreach." };
      candidates.push(candidate); inputs.set(prospect.id, { prospect, record });
    }
    return { candidates, inputs, excludedCount, truncated: prospects.length > MAX_RECORDS || records.length > MAX_RECORDS };
  }

  private fingerprint(input: CandidateInput): string {
    const { prospect, record } = input;
    return contentHash({ businessName: prospect.businessName, location: prospect.location, industry: prospect.industry, website: prospect.website, evidence: safeEvidence(prospect.evidence),
      recordWebsite: record?.website ?? prospect.website, services: record?.services ?? [], profile: record?.businessProfile ?? null, company: this.options.acquisition.company(), policy: POLICY });
  }

  private async execute(reportId: string): Promise<{ reportId: string }> {
    const report = this.store.getDoc<StoredReport>(REPORTS, reportId)?.doc;
    if (!report) throw new Error("The private rebuild report is unavailable.");
    if (!["queued", "running"].includes(report.state)) return { reportId };
    report.state = "running"; report.spokenSummary = "I am preparing the private business-specific demos. No client email or publication is being performed."; this.save(report);
    for (const business of report.businesses) {
      if (business.state === "ready" || business.state === "skipped" || business.state === "failed") continue;
      const current = this.inventory().inputs.get(business.prospectId);
      if (!current || this.fingerprint(current) !== report.fingerprints[business.prospectId]) {
        business.state = "skipped"; business.error = "The business record or eligibility changed after this exact batch was requested; its existing work was preserved."; this.updateCounts(report); this.save(report); continue;
      }
      try {
        const record = current.record ?? this.options.acquisition.importExistingProspect(business.prospectId);
        business.leadId = record.id; business.state = "building"; this.save(report);
        const rebuilt = this.options.acquisition.prepare(record.id, { templateId: "immersive", idempotencyKey: `${JOB}:${report.id}:${business.prospectId}`, preserveDraft: true });
        if (!rebuilt.demo || rebuilt.demo.templateId !== "immersive") throw new Error("An immersive private demo was not created.");
        business.state = "ready"; business.demoReady = true; business.previewPath = rebuilt.demo.previewPath; business.sourcePath = `/api/acquisition/leads/${encodeURIComponent(rebuilt.id)}/source.zip`;
        const design = (rebuilt.demo as typeof rebuilt.demo & { designBrief?: Record<string, unknown>; design?: Record<string, unknown> }).designBrief ?? (rebuilt.demo as typeof rebuilt.demo & { design?: Record<string, unknown> }).design;
        if (design) business.design = design;
      } catch { business.state = "failed"; business.error = "This private demo could not be rebuilt. Its stored business record remains available for review."; }
      this.updateCounts(report); this.save(report);
      // Allow the owner UI to read progress; no unrelated queue work is drained.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    this.updateCounts(report);
    report.state = report.businesses.some(business => business.state === "failed") ? report.rebuiltCount > 0 ? "partial" : "failed" : report.skippedCount ? "partial" : "completed";
    report.finishedAt = this.iso(); report.spokenSummary = this.summary(report); this.save(report);
    const ready = report.businesses.filter(business => business.state === "ready");
    const names = ready.slice(0, 30).map(business => `${business.name} — ${business.location}`).join("\n");
    const notice = await this.options.atlas.notifications.emit({ eventKey: `${JOB}:${report.id}:review`, priority: this.options.notificationPriority ?? "action_needed", business: "wulff_studio",
      title: `${ready.length} potential client demo${ready.length === 1 ? "" : "s"} ready for your review`,
      body: `${report.spokenSummary}\n\n${names}${ready.length > 30 ? `\nPlus ${ready.length - 30} more in the private list.` : ""}\n\nReview: ${report.reviewPath}`,
      link: { type: "job", id: this.store.getJobByKey(report.jobKey)!.id } });
    report.notificationId = notice.notification.id; this.save(report);
    this.options.atlas.audit.record({ actor: "atlas", action: "execute.site_rebuilds.run", business: "wulff_studio", outcome: report.fixture ? "simulated" : report.state === "failed" ? "failed" : "completed", detail: { reportId, targetCount: report.targetCount, rebuiltCount: report.rebuiltCount, skippedCount: report.skippedCount, noClientEmail: true, noPublication: true } });
    return { reportId };
  }

  private updateCounts(report: StoredReport) {
    report.rebuiltCount = report.businesses.filter(business => business.state === "ready").length;
    report.skippedCount = report.businesses.filter(business => business.state === "skipped").length;
    report.errors = report.businesses.filter(business => business.state === "failed").map(business => `${business.name}: ${business.error}`);
  }
  private summary(report: StoredReport) {
    const prefix = report.fixture ? "Fictional test report. " : "";
    if (!report.targetCount) return `${prefix}No eligible existing prospects with an own-website research gap were found. I have not claimed that any business has no website. Nothing was emailed or published.`;
    return `${prefix}I rebuilt ${report.rebuiltCount} private business-specific demo${report.rebuiltCount === 1 ? "" : "s"} for potential clients with no own website recorded or only social and directory links. ${report.skippedCount ? `${report.skippedCount} changed records were preserved. ` : ""}${report.errors.length ? `${report.errors.length} demo${report.errors.length === 1 ? " needs" : "s need"} attention. ` : ""}Your review list is ready in Studio. Confirm each business's online presence before outreach. Nothing was emailed to clients or published. No Lovable, model or paid voice credits were used.`;
  }
  private publicReport({ fingerprints: _fingerprints, jobKey: _jobKey, generation: _generation, ordinal: _ordinal, ...report }: StoredReport): SiteRebuildReport { return report; }
  private reports() { return this.store.listDocs<StoredReport>(REPORTS, 20).map(row => row.doc).sort((a, b) => (b.ordinal ?? 0) - (a.ordinal ?? 0) || b.startedAt.localeCompare(a.startedAt)); }
  private enqueue(report: StoredReport) { this.options.atlas.jobs.enqueue(JOB, { reportId: report.id }, { idempotencyKey: report.jobKey, maxAttempts: 1, runAfter: this.clock() }); }
  private save(report: StoredReport) { this.store.upsertDoc(REPORTS, report.id, report); }
  private iso() { return this.clock().toISOString(); }
  private kick(key: string) {
    if (this.scheduled.has(key)) return;
    this.scheduled.add(key);
    const timer = setTimeout(() => {
      this.scheduled.delete(key);
      void this.options.atlas.jobs.runKey(key, this.clock()).then(touched => {
        if (!touched.length && this.store.getJobByKey(key)?.status === "queued") this.kick(key);
      }).catch(() => { /* A closed store or interrupted process never starts external actions. */ });
    }, 20);
    timer.unref();
  }
}

/** Install after owner-session, Origin, JSON and body-size middleware. */
export function installSiteRebuildRoutes(app: Hono, _rt: Runtime, service: SiteRebuilds) {
  app.get("/api/site-rebuilds", async c => {
    try { if (requiredLevel("read.site_rebuilds") !== PermissionLevel.Read) throw new Error(); return c.json(await service.snapshot()); }
    catch { return c.json({ error: "The private rebuild review list could not be loaded." }, 503); }
  });
  app.post("/api/site-rebuilds/run", async c => {
    try {
      if (requiredLevel("execute.site_rebuilds.run") !== PermissionLevel.ExecuteRoutine) throw new SiteRebuildError("Private rebuilding is unavailable under the current action policy.", 503);
      const input: unknown = await c.req.json();
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) throw new SiteRebuildError("Provide an empty private rebuild request. This action cannot send or publish.", 400);
      return c.json(await service.runNow());
    } catch (error) { return c.json({ error: error instanceof SiteRebuildError ? error.message : "The private rebuild batch could not start." }, error instanceof SiteRebuildError ? error.status : error instanceof SyntaxError ? 400 : 503); }
  });
}

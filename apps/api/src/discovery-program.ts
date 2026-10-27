import { contentHash, PermissionLevel, requiredLevel, safeDemoWebsite, type AcquisitionRecord, type AcquisitionService, type Atlas } from "@atlas/core";
import type { Hono } from "hono";
import type { Runtime } from "./runtime.js";

const SETTINGS = "discovery.program.settings", REPORTS = "discovery_program_reports", JOB = "discovery_program";
const TERMINAL = new Set(["accepted", "submitting", "queued", "uncertain", "simulated", "cancelled"]);
export interface DiscoverySettings {
  enabled: boolean; area: string; industry: string; count: number; templateId: "clarity";
  companyName: string; companyWebsite: string; timeZone: "Australia/Melbourne";
}
export interface DiscoveryReport {
  id: string; day: string; state: "queued" | "running" | "completed" | "partial" | "failed" | "skipped" | "already_ran";
  trigger: "manual" | "scheduled"; startedAt: string; finishedAt?: string;
  foundCount: number; preparedCount: number; draftCount: number; logoCount: number; photoCount: number;
  alreadyReadyCount: number; reusedCount: number; newCandidateCount: number;
  businesses: Array<{ leadId: string; name: string; location: string; demoReady: boolean; draftReady: boolean; logoIncluded: boolean; photoCount: number; recipientMissing: boolean }>;
  errors: string[]; spokenSummary: string; fixture: boolean;
}
export interface DiscoveryRunState { state: "idle" | "queued" | "running" | "completed" | "partial" | "failed" | "skipped" | "already_ran" | "blocked"; detail: string; jobId?: string }
interface SavedSettings { settings: DiscoverySettings; revision: number }
interface Payload { reportId: string; day: string; trigger: "manual" | "scheduled"; revision: number; reuseExisting: boolean }
interface Options { atlas: Atlas; acquisition: AcquisitionService; mode: "live" | "fake"; env?: NodeJS.ProcessEnv; clock?: () => Date }
export class DiscoveryProgramError extends Error { constructor(message: string, readonly status: 400 | 409 | 503 = 400) { super(message); } }

export function discoveryDay(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Bounded private preparation only. This class has no mail, publishing, model or speech transport. */
export class DiscoveryProgram {
  private readonly store;
  private readonly clock: () => Date;
  private readonly env: NodeJS.ProcessEnv;
  private kickPending = false;

  constructor(private readonly options: Options) {
    this.store = options.atlas.deps.store;
    this.clock = options.clock ?? options.atlas.clock;
    this.env = options.env ?? {};
    options.atlas.jobs.register<Payload, { reportId: string }>(JOB, async (payload) => this.execute(payload));
    // An interrupted external search has an unknown outcome. Retain its day key and never repeat it.
    for (const row of this.store.listDocs<DiscoveryReport>(REPORTS, 60)) {
      if (row.doc.state !== "running") continue;
      const report = row.doc;
      report.state = "failed"; report.finishedAt = this.iso();
      report.errors = ["The run was interrupted. Its search will not be repeated automatically today. Review the private records before the next daily run."];
      report.spokenSummary = this.summary(report); this.saveReport(report);
    }
  }

  isConfigured(): boolean { return this.saved() !== null; }
  settings(): DiscoverySettings {
    return this.saved()?.settings ?? { enabled: false, area: "Officer, Berwick, Pakenham, Cranbourne, Dandenong, Victoria", industry: "", count: 3, templateId: "clarity", companyName: "Wulff Digital", companyWebsite: "https://wulffdigital.com", timeZone: "Australia/Melbourne" };
  }

  configure(input: unknown): void {
    const settings = validateSettings(input);
    const saved = this.saved();
    if (saved && contentHash(saved.settings) === contentHash(settings)) return;
    this.options.acquisition.configureCompany({ name: settings.companyName, website: settings.companyWebsite });
    this.store.setMemory(SETTINGS, { settings, revision: (saved?.revision ?? 0) + 1 } satisfies SavedSettings);
    this.options.atlas.audit.record({ actor: "owner", action: "execute.discovery.configure", business: "wulff_studio", outcome: "completed", detail: { enabled: settings.enabled, count: settings.count, templateId: settings.templateId, creditFree: true } });
  }

  async snapshot() {
    const reports = this.reports();
    const latestReport = reports[0] ?? null;
    const job = latestReport ? this.store.getJobByKey(`${JOB}:${latestReport.day}`) : null;
    const eligibility = this.store.getMemory<DiscoveryRunState & { day: string }>("discovery.program.eligibility");
    const currentEligibility = eligibility?.day === discoveryDay(this.clock()) && latestReport?.day !== eligibility.day ? eligibility : null;
    const run: DiscoveryRunState = currentEligibility ? { state: currentEligibility.state, detail: currentEligibility.detail } : latestReport ? {
      state: latestReport.state,
      detail: latestReport.state === "queued" ? "Private preparation is queued. No email will be sent or concept published."
        : latestReport.state === "running" ? "Business research and private code preparation are running."
        : latestReport.spokenSummary,
      ...(job ? { jobId: job.id } : {}),
    } : { state: "idle", detail: this.settings().enabled ? "Daily private preparation is enabled. The next worker check will evaluate today's run." : "Save the program settings, then run once or enable daily private preparation." };
    return {
      mode: this.options.mode, configured: this.isConfigured(), settings: this.settings(),
      availability: await this.availability(), latestReport, reports, run,
      costs: { lovableCredits: 0, elevenLabsCredits: 0, llmTokens: 0, detail: "Reusable local code and device speech use no Lovable, ElevenLabs or model credits. New searches use only keyless Tavily with provider limits; configured paid search keys are not used by this program. Existing hosting costs remain." },
    };
  }

  async runNow() {
    if (!this.isConfigured()) throw new DiscoveryProgramError("Save the program settings before running discovery.", 409);
    const state = this.enqueue("manual");
    if (state.state === "blocked") throw new DiscoveryProgramError(state.detail, 409);
    if (state.state === "queued") this.kick();
    return this.snapshot();
  }

  /** Called by the existing background worker; it replaces, rather than duplicates, legacy daily research. */
  async dailyTick(): Promise<DiscoveryRunState> {
    if (!this.isConfigured() || !this.settings().enabled) return this.eligibility({ state: "skipped", detail: "Daily discovery is paused. Manual private preparation remains available." });
    if (this.options.mode !== "live") return this.eligibility({ state: "skipped", detail: "Fictional mode never searches automatically. Run manually for clearly labelled test records." });
    const state = this.enqueue("scheduled");
    if (state.state === "queued") await this.options.atlas.jobs.runKey(`${JOB}:${discoveryDay(this.clock())}`, this.clock());
    const latest = this.reportForDay(discoveryDay(this.clock()));
    return latest ? { state: latest.state === "completed" && state.state !== "queued" ? "already_ran" : latest.state, detail: latest.spokenSummary, ...(state.jobId ? { jobId: state.jobId } : {}) } : state;
  }

  private enqueue(trigger: Payload["trigger"]): DiscoveryRunState {
    const now = this.clock(), day = discoveryDay(now), key = `${JOB}:${day}`;
    const existing = this.store.getJobByKey(key), report = this.reportForDay(day);
    if (existing || report) return { state: report?.state === "completed" ? "already_ran" : report?.state ?? (existing?.status === "queued" ? "queued" : "failed"), detail: report?.spokenSummary ?? "Today's durable discovery key is already reserved; no additional search was made.", ...(existing ? { jobId: existing.id } : {}) };
    const legacy = this.legacyForDay(day);
    if (legacy.state === "running") return this.eligibility({ state: "blocked", detail: "The existing daily research is still queued or running. Wait for it to finish; a second search was not started." });
    if (legacy.state === "failed") return this.eligibility({ state: "blocked", detail: "Today's existing research failed or was interrupted. This program will not repeat that uncertain request. Review its status and try on the next Melbourne day." });
    const reuseExisting = legacy.state === "completed";
    const gate = this.searchGate();
    if (!reuseExisting && gate) return this.eligibility({ state: "blocked", detail: gate });
    const reportId = `discovery_${day}`;
    const queued = this.options.atlas.jobs.enqueue<Payload>(JOB, { reportId, day, trigger, revision: this.saved()!.revision, reuseExisting }, { idempotencyKey: key, maxAttempts: 1, runAfter: now });
    this.saveReport({ id: reportId, day, state: "queued", trigger, startedAt: now.toISOString(), foundCount: 0, preparedCount: 0, draftCount: 0, logoCount: 0, photoCount: 0, alreadyReadyCount: 0, reusedCount: 0, newCandidateCount: 0, businesses: [], errors: [], spokenSummary: "Private business discovery is queued. Nothing has been emailed or published.", fixture: this.options.mode === "fake" });
    return { state: "queued", detail: "Private preparation queued once for this Melbourne day.", jobId: queued.job.id };
  }

  private async execute(payload: Payload): Promise<{ reportId: string }> {
    const report = this.store.getDoc<DiscoveryReport>(REPORTS, payload.reportId)?.doc;
    if (!report) throw new Error("Discovery report is unavailable; no provider request was made.");
    const current = this.saved();
    if (!current || current.revision !== payload.revision || payload.day !== discoveryDay(this.clock()) || (payload.trigger === "scheduled" && (!current.settings.enabled || this.options.mode !== "live"))) {
      report.state = "skipped"; report.finishedAt = this.iso(); report.errors = ["Settings changed, the program was paused, or the day expired before execution. No new search was made."];
      report.spokenSummary = this.summary(report); this.saveReport(report); return { reportId: report.id };
    }
    const gate = payload.reuseExisting ? null : this.searchGate();
    if (gate) { report.state = "skipped"; report.finishedAt = this.iso(); report.errors = [gate]; report.spokenSummary = this.summary(report); this.saveReport(report); return { reportId: report.id }; }
    report.state = "running"; this.saveReport(report);
    const settings = current.settings;
    const before = new Map(this.records().map(record => [record.id, contentHash(record)]));
    const readyBefore = new Set(this.records().filter(record => record.demo && record.draft).map(record => record.id));
    let records: AcquisitionRecord[] = [];
    try {
      if (payload.reuseExisting) {
        const candidates = this.records().filter(record => !TERMINAL.has(record.draft?.status ?? "draft")).slice(0, settings.count);
        for (const candidate of candidates) {
          try { records.push(this.options.acquisition.prepare(candidate.id, { templateId: settings.templateId })); }
          catch { report.errors.push("An existing candidate could not be rebuilt. Its private record remains available for review."); }
        }
        report.reusedCount = records.length;
      } else {
        // The acquisition service performs source-backed discovery and bounded business enrichment.
        records = await this.options.acquisition.discover({ area: settings.area, count: settings.count, ...(settings.industry ? { industry: settings.industry } : {}), templateId: settings.templateId });
        report.foundCount = records.length;
        report.newCandidateCount = records.filter(record => !before.has(record.id)).length;
      }
    } catch {
      report.errors.push("Business discovery could not finish. Any completed private records are retained. No fictional replacement, paid fallback or automatic retry was used.");
      // Only records created by this operation can count after failure. Unrelated owner edits
      // to an older draft must never become newly found business results.
      records = this.records().filter(record => !before.has(record.id)).slice(0, settings.count);
      report.newCandidateCount = records.filter(record => !before.has(record.id)).length;
      report.foundCount = records.length;
    }
    if (this.options.mode === "live" && records.some(record => this.options.atlas.prospects.require(record.prospectId).fixture)) {
      records = []; report.foundCount = 0; report.newCandidateCount = 0; report.reusedCount = 0; report.errors.push("Fictional records were refused in live discovery. No live results are claimed.");
    }
    report.businesses = records.map(record => ({ leadId: record.id, name: record.businessName, location: record.location, demoReady: Boolean(record.demo), draftReady: Boolean(record.draft), logoIncluded: Boolean(record.businessProfile?.logo), photoCount: record.businessProfile?.images.length ?? 0, recipientMissing: !record.contact?.email }));
    report.preparedCount = report.businesses.filter(business => business.demoReady).length;
    report.draftCount = report.businesses.filter(business => business.draftReady).length;
    report.logoCount = report.businesses.filter(business => business.logoIncluded).length;
    report.photoCount = report.businesses.reduce((total, business) => total + business.photoCount, 0);
    report.alreadyReadyCount = records.filter(record => readyBefore.has(record.id)).length;
    report.state = report.errors.length ? records.length ? "partial" : "failed" : "completed";
    report.finishedAt = this.iso(); report.spokenSummary = this.summary(report); this.saveReport(report);
    this.options.atlas.audit.record({ actor: "atlas", action: "execute.discovery.run", business: "wulff_studio", outcome: report.fixture ? "simulated" : report.state === "failed" ? "failed" : "completed", detail: { reportId: report.id, foundCount: report.foundCount, preparedCount: report.preparedCount, reusedCount: report.reusedCount, noEmailSent: true, noPublication: true, creditFree: true } });
    // Routine stays on the private dashboard; it cannot invoke paid or external alert channels.
    await this.options.atlas.notifications.emit({ eventKey: `${JOB}:${report.day}:report`, priority: "routine", business: "wulff_studio", title: "Wulff Digital discovery report ready", body: report.spokenSummary, link: { type: "job", id: this.store.getJobByKey(`${JOB}:${report.day}`)!.id } });
    return { reportId: report.id };
  }

  private summary(report: DiscoveryReport): string {
    const fictional = report.fixture ? "Fictional test report. " : "";
    if (["queued", "running"].includes(report.state)) return report.spokenSummary;
    if (report.state === "skipped") return `${fictional}The discovery run was skipped because its settings changed or it expired. Nothing was emailed or published.`;
    if (report.state === "failed") return `${fictional}Business discovery needs attention. No successful new business results are claimed. Review the report in Studio. Nothing was emailed or published.`;
    const research = report.reusedCount > 0 ? `I reused ${report.reusedCount} previously researched business${report.reusedCount === 1 ? "" : "es"} without another search` : `I found ${report.foundCount} source-backed business candidate${report.foundCount === 1 ? "" : "s"}`;
    return `${fictional}${research} and prepared ${report.preparedCount} private code demo${report.preparedCount === 1 ? "" : "s"} with ${report.draftCount} email draft${report.draftCount === 1 ? "" : "s"}. ${report.logoCount} business logo${report.logoCount === 1 ? "" : "s"} and ${report.photoCount} sourced photo${report.photoCount === 1 ? "" : "s"} are included. ${report.errors.length ? "Some records need attention. " : ""}Review them in Studio. Nothing was emailed or published. No Lovable, ElevenLabs or model credits were used.`;
  }
  private searchGate(): string | null {
    if (this.options.mode === "fake") return null;
    const useBrave = this.env.ATLAS_RESEARCH_PROVIDER === "brave" || (this.env.ATLAS_RESEARCH_PROVIDER !== "tavily" && Boolean(this.env.BRAVE_SEARCH_API_KEY?.trim()));
    if (useBrave || this.env.TAVILY_API_KEY?.trim()) return "Credit-free discovery requires keyless Tavily. A configured paid search key will not be used by this program. Existing private candidates can still be reviewed.";
    return null;
  }
  private async availability() {
    if (this.options.mode === "fake") return { state: "fake" as const, detail: "Manual runs use clearly labelled fictional records. No live business search runs automatically." };
    const gate = this.searchGate();
    if (gate) return { state: "not_connected" as const, detail: gate };
    try {
      const source = this.options.atlas.deps.lookup;
      const status = source ? await source.status() : null;
      return { state: status?.state === "connected" ? "connected" as const : status?.state === "error" ? "error" as const : "not_connected" as const, detail: status?.state === "connected" ? "Keyless discovery has completed a real search. Provider rate limits still apply; there is no paid fallback." : "Keyless Tavily is ready to try, subject to its provider limits. A successful new search has not yet been verified in this process." };
    } catch { return { state: "error" as const, detail: "The research status could not be checked. No fictional replacement is used." }; }
  }
  private legacyForDay(day: string): { state: "none" | "running" | "failed" | "completed" } {
    const jobs = this.store.listJobs(500).filter(job => job.type === "research_prospects" && job.idempotencyKey.startsWith(`research_prospects:${day}:`));
    if (jobs.some(job => ["queued", "running"].includes(job.status))) return { state: "running" };
    if (jobs.some(job => ["dead", "failed"].includes(job.status))) return { state: "failed" };
    if (jobs.some(job => job.status === "succeeded")) return { state: "completed" };
    const legacy = this.store.getMemory<{ day?: string; state?: string }>("background.research.lastRun");
    return legacy?.day !== day ? { state: "none" } : { state: legacy.state === "completed" ? "completed" : legacy.state === "running" ? "running" : legacy.state === "failed" ? "failed" : "none" };
  }
  private records(): AcquisitionRecord[] { return this.store.listDocs<AcquisitionRecord>("acquisition_records", 500).map(row => row.doc).filter(record => !record.archivedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  private reports() { return this.store.listDocs<DiscoveryReport>(REPORTS, 30).map(row => row.doc).sort((a, b) => b.day.localeCompare(a.day)); }
  private reportForDay(day: string) { return this.store.getDoc<DiscoveryReport>(REPORTS, `discovery_${day}`)?.doc ?? null; }
  private saved() { return this.store.getMemory<SavedSettings>(SETTINGS); }
  private eligibility(state: DiscoveryRunState) { this.store.setMemory("discovery.program.eligibility", { ...state, day: discoveryDay(this.clock()) }); return state; }
  private saveReport(report: DiscoveryReport) { this.store.upsertDoc(REPORTS, report.id, report); }
  private iso() { return this.clock().toISOString(); }
  private kick() {
    if (this.kickPending) return;
    this.kickPending = true;
    const timer = setTimeout(() => { this.kickPending = false; void this.options.atlas.jobs.runKey(`${JOB}:${discoveryDay(this.clock())}`, this.clock()).catch(() => {}); }, 0);
    timer.unref();
  }
}

function validateSettings(input: unknown): DiscoverySettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new DiscoveryProgramError("Provide the discovery program settings.");
  const value = input as Record<string, unknown>;
  const allowed = ["enabled", "area", "industry", "count", "templateId", "companyName", "companyWebsite", "timeZone"];
  if (Object.keys(value).some(key => !allowed.includes(key)) || typeof value.enabled !== "boolean" || !Number.isInteger(value.count) || Number(value.count) < 1 || Number(value.count) > 5 || value.templateId !== "clarity" || value.timeZone !== "Australia/Melbourne") throw new DiscoveryProgramError("Use one to five private Clarity demos per Melbourne day and explicit enabled settings.");
  const text = (field: string, max: number, required = true) => {
    const text = value[field];
    if (typeof text !== "string" || /[\u0000-\u001f\u007f]/.test(text) || text.trim().length > max || (required && !text.trim())) throw new DiscoveryProgramError(`Provide valid ${field} settings.`);
    return text.trim();
  };
  const area = text("area", 160), industry = text("industry", 100, false), companyName = text("companyName", 160), companyWebsite = text("companyWebsite", 2000);
  let website: string | null;
  try { website = safeDemoWebsite(companyWebsite); } catch { throw new DiscoveryProgramError("Provide the company's public HTTPS website without credentials or a fragment."); }
  if (!website) throw new DiscoveryProgramError("Provide the company's public HTTPS website.");
  return { enabled: value.enabled, area, industry, count: Number(value.count), templateId: "clarity", companyName, companyWebsite: website.replace(/\/$/, ""), timeZone: "Australia/Melbourne" };
}

/** Install behind the normal owner-session and same-origin JSON middleware. */
export function installDiscoveryProgramRoutes(app: Hono, _rt: Runtime, program: DiscoveryProgram) {
  const permission = (kind: "read.discovery.program" | "execute.discovery.configure" | "execute.discovery.run", level: PermissionLevel) => {
    if (requiredLevel(kind) !== level) throw new DiscoveryProgramError("Discovery program is unavailable under the current action policy.", 503);
  };
  app.get("/api/discovery-program", async c => {
    try { permission("read.discovery.program", PermissionLevel.Read); return c.json(await program.snapshot()); }
    catch { return c.json({ error: "The private discovery report could not be loaded." }, 503); }
  });
  app.post("/api/discovery-program/settings", async c => {
    try { permission("execute.discovery.configure", PermissionLevel.ExecuteRoutine); program.configure(await c.req.json()); return c.json(await program.snapshot()); }
    catch (error) { return c.json({ error: error instanceof DiscoveryProgramError ? error.message : "The discovery settings could not be saved." }, error instanceof DiscoveryProgramError ? error.status : error instanceof SyntaxError ? 400 : 503); }
  });
  app.post("/api/discovery-program/run", async c => {
    try {
      permission("execute.discovery.run", PermissionLevel.ExecuteRoutine);
      const input: unknown = await c.req.json();
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) throw new DiscoveryProgramError("Provide an empty run request. Sending and publishing are not supported by this program.");
      return c.json(await program.runNow());
    } catch (error) { return c.json({ error: error instanceof DiscoveryProgramError ? error.message : "The private discovery run could not be queued." }, error instanceof DiscoveryProgramError ? error.status : error instanceof SyntaxError ? 400 : 503); }
  });
}

import { contentHash, PermissionLevel, requiredLevel, safeDemoWebsite, type AcquisitionRecord, type AcquisitionService, type Atlas } from "@atlas/core";
import type { Hono } from "hono";
import type { Runtime } from "./runtime.js";
import { NoWebsiteResearch, noWebsiteQualificationKey, type NoWebsiteQualification } from "./no-website-research.js";

const SETTINGS = "discovery.program.settings", REPORTS = "discovery_program_reports", JOB = "discovery_program";
const TERMINAL = new Set(["accepted", "submitting", "queued", "uncertain", "simulated", "cancelled"]);
export interface DiscoverySettings {
  enabled: boolean; area: string; industry: string; count: number; templateId: "clarity" | "immersive" | "simple";
  companyName: string; companyWebsite: string; timeZone: "Australia/Melbourne";
  target?: "no_website";
}
export interface DiscoveryReport {
  id: string; day: string; state: "queued" | "running" | "completed" | "partial" | "failed" | "skipped" | "already_ran";
  trigger: "manual" | "scheduled"; startedAt: string; finishedAt?: string;
  foundCount: number; preparedCount: number; draftCount: number; logoCount: number; photoCount: number;
  alreadyReadyCount: number; reusedCount: number; newCandidateCount: number;
  businesses: Array<{ leadId: string; name: string; location: string; demoReady: boolean; draftReady: boolean; logoIncluded: boolean; photoCount: number; recipientMissing: boolean; contactEmail?: string; contactSourceUrl?: string; previewPath?: string }>;
  errors: string[]; spokenSummary: string; fixture: boolean;
  requestedCount?: number; emailReadyCount?: number; shortfallCount?: number; searchCount?: number;
  nextStepAt?: string; settingsRevision?: number; reviewPath?: string; spreadsheetPath?: string;
}
export interface DiscoveryRunState { state: "idle" | "queued" | "running" | "completed" | "partial" | "failed" | "skipped" | "already_ran" | "blocked"; detail: string; jobId?: string }
interface SavedSettings { settings: DiscoverySettings; revision: number }
interface Payload { reportId: string; day: string; trigger: "manual" | "scheduled"; revision: number; reuseExisting: boolean }
interface Options { atlas: Atlas; acquisition: AcquisitionService; mode: "live" | "fake"; env?: NodeJS.ProcessEnv; clock?: () => Date; onPrepared?: () => unknown }
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
  private advancing = false;
  private readonly noWebsiteResearch: NoWebsiteResearch;

  constructor(private readonly options: Options) {
    this.store = options.atlas.deps.store;
    this.clock = options.clock ?? options.atlas.clock;
    this.env = options.env ?? {};
    this.noWebsiteResearch = new NoWebsiteResearch({ atlas: options.atlas, acquisition: options.acquisition, clock: this.clock });
    options.atlas.jobs.register<Payload, { reportId: string }>(JOB, async (payload) => this.execute(payload));
    // An interrupted external search has an unknown outcome. Retain its day key and never repeat it.
    for (const row of this.store.listDocs<DiscoveryReport>(REPORTS, 60)) {
      if (row.doc.state !== "running") continue;
      // The no-website cursor reserves each external lookup before calling it and can resume.
      if (row.doc.id.startsWith("outreach_")) continue;
      const report = row.doc;
      report.state = "failed"; report.finishedAt = this.iso();
      report.errors = ["The run was interrupted. Its search will not be repeated automatically today. Review the private records before the next daily run."];
      report.spokenSummary = this.summary(report); this.saveReport(report);
    }
  }

  isConfigured(): boolean { return this.saved() !== null; }
  settings(): DiscoverySettings {
    return this.saved()?.settings ?? { enabled: false, area: "Officer, Berwick, Pakenham, Cranbourne, Dandenong, Victoria", industry: "", count: 3, templateId: "immersive", companyName: "Wulff Digital", companyWebsite: "https://wulffdigital.com", timeZone: "Australia/Melbourne" };
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
    const latestReport = this.reportForDay(discoveryDay(this.clock())) ?? reports[0] ?? null;
    const job = latestReport ? this.store.getJobByKey(this.jobKey(latestReport.day, latestReport.id.startsWith("outreach_"))) : null;
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
      schedule: { startHour: 7, startMinute: 0, timeZone: "Australia/Melbourne", spreadsheetPath: "/api/prospect-pricing/export.xlsx" },
      costs: { lovableCredits: 0, elevenLabsCredits: 0, llmTokens: 0, detail: "Reusable local code and device speech use no Lovable, ElevenLabs or model credits. New searches use only keyless Tavily with provider limits; configured paid search keys are not used by this program. Existing hosting costs remain." },
    };
  }

  async runNow() {
    if (!this.isConfigured()) throw new DiscoveryProgramError("Save the program settings before running discovery.", 409);
    const state = this.enqueue("manual");
    if (state.state === "blocked") throw new DiscoveryProgramError(state.detail, 409);
    if (state.state === "queued" || state.state === "running") this.kick();
    return this.snapshot();
  }

  /** Import explicit owner-reviewed website/email checks without another provider search. */
  async seedToday(input: unknown) {
    if (!this.isConfigured() || this.settings().target !== "no_website") throw new DiscoveryProgramError("Configure no-website client research before adding reviewed results.", 409);
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(k => k !== "leads")) throw new DiscoveryProgramError("Provide reviewed lead qualifications.");
    const leads = (input as { leads?: unknown }).leads;
    if (!Array.isArray(leads) || leads.length < 1 || leads.length > 20) throw new DiscoveryProgramError("Provide one to twenty reviewed leads.");
    const ids: string[] = [], qualifications: Array<{ id: string; qualification: NoWebsiteQualification }> = [];
    for (const raw of leads) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new DiscoveryProgramError("Provide complete source checks for each lead.");
      const value = raw as Record<string, unknown>;
      if (Object.keys(value).some(k => !["leadId", "sourceUrl", "email", "checkedAt", "searchQueries", "noIndependentWebsiteFound"].includes(k)) || typeof value.leadId !== "string" || !/^acq_[a-zA-Z0-9_-]{1,100}$/.test(value.leadId) || typeof value.sourceUrl !== "string" || value.sourceUrl.length > 2048 || typeof value.email !== "string" || value.email.length > 254 || typeof value.checkedAt !== "string" || value.checkedAt.length > 40 || !Number.isFinite(Date.parse(value.checkedAt)) || value.noIndependentWebsiteFound !== true || !Array.isArray(value.searchQueries) || value.searchQueries.length < 1 || value.searchQueries.length > 6 || value.searchQueries.some(q => typeof q !== "string" || q.trim().length < 3 || q.length > 400 || /[\u0000-\u001f\u007f]/.test(q))) throw new DiscoveryProgramError("Every lead needs its actual source URL, email and dated no-independent-website checks.");
      const record = this.records().find(record => record.id === value.leadId);
      if (!record || record.sourceUrl !== value.sourceUrl || record.contact?.email !== value.email || record.contact.sourceUrl !== value.sourceUrl) throw new DiscoveryProgramError("The reviewed qualification must match the saved source and email.", 409);
      ids.push(value.leadId);
      qualifications.push({ id: value.leadId, qualification: { day: discoveryDay(this.clock()), checkedAt: value.checkedAt, sourceUrl: value.sourceUrl, email: value.email, searchQueries: value.searchQueries as string[], noIndependentWebsiteFound: true } });
    }
    if (new Set(ids).size !== ids.length) throw new DiscoveryProgramError("Provide each reviewed lead only once.");
    const state = this.enqueue("manual");
    const report = this.reportForDay(discoveryDay(this.clock()));
    if (!report || !["queued", "running"].includes(report.state)) throw new DiscoveryProgramError("Today's list is already final. New leads remain available privately for review.", 409);
    for (const row of qualifications) this.store.setMemory(noWebsiteQualificationKey(row.id), row.qualification);
    const result = this.noWebsiteResearch.seed({ reportId: report.id, area: this.settings().area, count: this.settings().count, templateId: this.settings().templateId, leadIds: ids });
    this.options.atlas.audit.record({ actor: "owner", action: "execute.discovery.seed", business: "wulff_studio", outcome: "completed", detail: { reportId: report.id, reviewedCount: ids.length, qualifiedCount: result.leadIds.length, noEmailSent: true, noPublication: true } });
    if (state.state === "queued" || report.state === "running") this.kick();
    return this.snapshot();
  }

  /** Called by the existing background worker; it replaces, rather than duplicates, legacy daily research. */
  async dailyTick(): Promise<DiscoveryRunState> {
    if (!this.isConfigured() || !this.settings().enabled) return this.eligibility({ state: "skipped", detail: "Daily discovery is paused. Manual private preparation remains available." });
    if (this.options.mode !== "live") return this.eligibility({ state: "skipped", detail: "Fictional mode never searches automatically. Run manually for clearly labelled test records." });
    if (this.settings().target === "no_website") {
      const hour = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", hourCycle: "h23" }).format(this.clock()));
      if (hour < 7) return this.eligibility({ state: "skipped", detail: "Your daily client research starts after 7 am Melbourne time." });
      const report = this.reportForDay(discoveryDay(this.clock()));
      if (report?.state === "running") {
        await this.advanceNoWebsite(report);
        const current = this.reportForDay(report.day)!;
        return { state: current.state, detail: current.spokenSummary };
      }
    }
    const state = this.enqueue("scheduled");
    if (state.state === "queued") await this.options.atlas.jobs.runKey(this.jobKey(discoveryDay(this.clock())), this.clock());
    const latest = this.reportForDay(discoveryDay(this.clock()));
    return latest ? { state: latest.state === "completed" && state.state !== "queued" ? "already_ran" : latest.state, detail: latest.spokenSummary, ...(state.jobId ? { jobId: state.jobId } : {}) } : state;
  }

  private enqueue(trigger: Payload["trigger"]): DiscoveryRunState {
    const now = this.clock(), day = discoveryDay(now), key = this.jobKey(day);
    const existing = this.store.getJobByKey(key), report = this.reportForDay(day);
    if (existing || report) return { state: report?.state === "completed" ? "already_ran" : report?.state ?? (existing?.status === "queued" ? "queued" : "failed"), detail: report?.spokenSummary ?? "Today's durable discovery key is already reserved; no additional search was made.", ...(existing ? { jobId: existing.id } : {}) };
    const legacy = this.settings().target === "no_website" ? { state: "none" as const } : this.legacyForDay(day);
    if (legacy.state === "running") return this.eligibility({ state: "blocked", detail: "The existing daily research is still queued or running. Wait for it to finish; a second search was not started." });
    if (legacy.state === "failed") return this.eligibility({ state: "blocked", detail: "Today's existing research failed or was interrupted. This program will not repeat that uncertain request. Review its status and try on the next Melbourne day." });
    const reuseExisting = legacy.state === "completed";
    const gate = this.searchGate();
    if (!reuseExisting && gate) return this.eligibility({ state: "blocked", detail: gate });
    const reportId = `${this.settings().target === "no_website" ? "outreach" : "discovery"}_${day}`;
    const queued = this.options.atlas.jobs.enqueue<Payload>(JOB, { reportId, day, trigger, revision: this.saved()!.revision, reuseExisting }, { idempotencyKey: key, maxAttempts: 1, runAfter: now });
    this.saveReport({ id: reportId, day, state: "queued", trigger, startedAt: now.toISOString(), foundCount: 0, preparedCount: 0, draftCount: 0, logoCount: 0, photoCount: 0, alreadyReadyCount: 0, reusedCount: 0, newCandidateCount: 0, businesses: [], errors: [], spokenSummary: "Private business discovery is queued. Nothing has been emailed or published.", fixture: this.options.mode === "fake", ...(this.settings().target === "no_website" ? { requestedCount: this.settings().count, emailReadyCount: 0, shortfallCount: this.settings().count, settingsRevision: this.saved()!.revision, reviewPath: "/#pipeline", spreadsheetPath: "/api/prospect-pricing/export.xlsx" } : {}) });
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
    if (current.settings.target === "no_website") {
      report.state = "running"; this.saveReport(report);
      await this.advanceNoWebsite(report);
      return { reportId: report.id };
    }
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

  private async advanceNoWebsite(report: DiscoveryReport): Promise<void> {
    if (this.advancing || report.nextStepAt && report.nextStepAt > this.iso()) return;
    this.advancing = true;
    try {
      const saved = this.saved();
      if (!saved || saved.settings.target !== "no_website" || saved.revision !== report.settingsRevision || report.day !== discoveryDay(this.clock()) || report.trigger === "scheduled" && !saved.settings.enabled) {
        report.state = "skipped"; report.finishedAt = this.iso(); report.errors = ["The daily outreach settings changed or the day expired. Existing private results are retained."];
        report.spokenSummary = this.summary(report); this.saveReport(report); return;
      }
      const gate = this.searchGate();
      if (gate) { report.state = "failed"; report.finishedAt = this.iso(); report.errors = [gate]; report.spokenSummary = this.summary(report); this.saveReport(report); return; }
      const result = await this.noWebsiteResearch.step({ reportId: report.id, area: saved.settings.area, count: saved.settings.count, templateId: saved.settings.templateId });
      const ids = new Set(result.leadIds);
      const records = this.records().filter(record => ids.has(record.id));
      for (let i = 0; i < records.length; i++) {
        const record = records[i]!;
        if ((!record.demo || !record.draft || record.demo.templateId !== saved.settings.templateId) && !TERMINAL.has(record.draft?.status ?? "draft")) {
          try { records[i] = this.options.acquisition.prepare(record.id, { templateId: saved.settings.templateId, preserveDraft: true, idempotencyKey: `${report.id}:${record.id}` }); }
          catch { /* An unsafe/changed record is retained but never counted as email-ready. */ }
        }
      }
      this.options.onPrepared?.();
      report.businesses = records.map(record => ({ leadId: record.id, name: record.businessName, location: record.location, demoReady: Boolean(record.demo), draftReady: Boolean(record.draft && record.contact?.email), logoIncluded: Boolean(record.businessProfile?.logo), photoCount: record.businessProfile?.images.length ?? 0, recipientMissing: !record.contact?.email, ...(record.contact ? { contactEmail: record.contact.email, contactSourceUrl: record.contact.sourceUrl } : {}), ...(record.demo ? { previewPath: record.demo.previewPath } : {}) }));
      report.requestedCount = saved.settings.count;
      report.foundCount = records.length; report.newCandidateCount = records.length;
      report.preparedCount = report.businesses.filter(row => row.demoReady).length;
      report.emailReadyCount = report.businesses.filter(row => row.draftReady && row.demoReady && !row.recipientMissing).length;
      report.draftCount = report.emailReadyCount;
      report.shortfallCount = Math.max(0, saved.settings.count - report.emailReadyCount);
      report.logoCount = report.businesses.filter(row => row.logoIncluded).length;
      report.photoCount = report.businesses.reduce((n, row) => n + row.photoCount, 0);
      report.searchCount = result.daySearchCount; report.errors = result.errors;
      report.reviewPath = "/#pipeline"; report.spreadsheetPath = "/api/prospect-pricing/export.xlsx";
      report.nextStepAt = result.nextStepAt;
      report.state = result.state === "running" ? "running" : report.emailReadyCount === saved.settings.count ? "completed" : records.length ? "partial" : "failed";
      if (report.state !== "running") report.finishedAt = this.iso();
      report.spokenSummary = this.summary(report); this.saveReport(report);
      if (report.state !== "running") {
        this.options.atlas.audit.record({ actor: "atlas", action: "execute.discovery.run", business: "wulff_studio", outcome: report.fixture ? "simulated" : report.state === "failed" ? "failed" : "completed", detail: { reportId: report.id, target: "no_website", requestedCount: report.requestedCount, emailReadyCount: report.emailReadyCount, shortfallCount: report.shortfallCount, noEmailSent: true, noPublication: true, creditFree: true } });
        await this.options.atlas.notifications.emit({ eventKey: `daily_outreach:${report.day}:report`, priority: "routine", business: "wulff_studio", title: `Daily client list: ${report.emailReadyCount} of ${report.requestedCount} ready`, body: `${report.spokenSummary}\n\n${report.businesses.map(row => `${row.name} — ${row.location}`).join("\n")}\n\nReview: /#pipeline\nSeparate pricing spreadsheet: /api/prospect-pricing/export.xlsx` });
      }
    } catch {
      report.state = report.businesses.length ? "partial" : "failed"; report.finishedAt = this.iso(); report.errors = ["Daily client research stopped. Saved results are retained; no paid fallback, customer email or publication was attempted."];
      report.spokenSummary = this.summary(report); this.saveReport(report);
    } finally { this.advancing = false; }
  }

  private summary(report: DiscoveryReport): string {
    const fictional = report.fixture ? "Fictional test report. " : "";
    if (report.id.startsWith("outreach_")) {
      const count = report.emailReadyCount ?? 0, target = report.requestedCount ?? 20;
      return `${fictional}${count} of ${target} businesses are ready for your manual email review, with sourced email addresses and private simple website demos. ${report.state === "running" ? "Research will continue in the background within the free search limits. " : count < target ? `${target - count} more are needed; the target was not filled. ` : ""}No independent website was found in the recorded checks; confirm this before outreach. Your suggested AUD prices are in the separate spreadsheet. Nothing was emailed or published.`;
    }
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
  private reports() { return this.store.listDocs<DiscoveryReport>(REPORTS, 60).map(row => row.doc).sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }
  private reportForDay(day: string) { return this.store.getDoc<DiscoveryReport>(REPORTS, `${this.settings().target === "no_website" ? "outreach" : "discovery"}_${day}`)?.doc ?? null; }
  private jobKey(day: string, noWebsite = this.settings().target === "no_website") { return `${noWebsite ? "daily_outreach" : JOB}:${day}`; }
  private saved() { return this.store.getMemory<SavedSettings>(SETTINGS); }
  private eligibility(state: DiscoveryRunState) { this.store.setMemory("discovery.program.eligibility", { ...state, day: discoveryDay(this.clock()) }); return state; }
  private saveReport(report: DiscoveryReport) { this.store.upsertDoc(REPORTS, report.id, report); }
  private iso() { return this.clock().toISOString(); }
  private kick() {
    if (this.kickPending) return;
    this.kickPending = true;
    const timer = setTimeout(() => {
      this.kickPending = false;
      void (async () => {
        const report = this.reportForDay(discoveryDay(this.clock()));
        if (report?.id.startsWith("outreach_") && report.state === "running") await this.advanceNoWebsite(report);
        else await this.options.atlas.jobs.runKey(this.jobKey(discoveryDay(this.clock())), this.clock());
      })().catch(() => {});
    }, 0);
    timer.unref();
  }
}

function validateSettings(input: unknown): DiscoverySettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new DiscoveryProgramError("Provide the discovery program settings.");
  const value = input as Record<string, unknown>;
  const allowed = ["enabled", "area", "industry", "count", "templateId", "companyName", "companyWebsite", "timeZone", "target"];
  if (Object.keys(value).some(key => !allowed.includes(key)) || typeof value.enabled !== "boolean" || !Number.isInteger(value.count) || Number(value.count) < 1 || Number(value.count) > (value.target === "no_website" ? 20 : 5) || !["clarity", "immersive", "simple"].includes(String(value.templateId)) || value.timeZone !== "Australia/Melbourne" || value.target !== undefined && value.target !== "no_website") throw new DiscoveryProgramError("Use up to twenty no-website client drafts per Melbourne day, or up to five general demos, and explicit enabled settings.");
  const text = (field: string, max: number, required = true) => {
    const text = value[field];
    if (typeof text !== "string" || /[\u0000-\u001f\u007f]/.test(text) || text.trim().length > max || (required && !text.trim())) throw new DiscoveryProgramError(`Provide valid ${field} settings.`);
    return text.trim();
  };
  const area = text("area", 160), industry = text("industry", 100, false), companyName = text("companyName", 160), companyWebsite = text("companyWebsite", 2000);
  let website: string | null;
  try { website = safeDemoWebsite(companyWebsite); } catch { throw new DiscoveryProgramError("Provide the company's public HTTPS website without credentials or a fragment."); }
  if (!website) throw new DiscoveryProgramError("Provide the company's public HTTPS website.");
  return { enabled: value.enabled, area, industry, count: Number(value.count), templateId: value.templateId as "clarity" | "immersive" | "simple", companyName, companyWebsite: website.replace(/\/$/, ""), timeZone: "Australia/Melbourne", ...(value.target === "no_website" ? { target: "no_website" as const } : {}) };
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
  app.post("/api/discovery-program/seed", async c => {
    try { permission("execute.discovery.run", PermissionLevel.ExecuteRoutine); return c.json(await program.seedToday(await c.req.json())); }
    catch (error) { return c.json({ error: error instanceof DiscoveryProgramError ? error.message : "The reviewed client checks could not be recorded." }, error instanceof DiscoveryProgramError ? error.status : error instanceof SyntaxError ? 400 : 503); }
  });
}

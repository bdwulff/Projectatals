import { contentHash, isCustomerStage, PermissionLevel, requiredLevel, type AcquisitionRecord, type Atlas } from "@atlas/core";
import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context, Hono } from "hono";
import { discoveryDay, type DiscoveryProgram } from "./discovery-program.js";
import { noWebsiteQualificationKey, type NoWebsiteQualification } from "./no-website-research.js";
import type { ProspectPricing, ProspectPricingRow, ProspectPricingSnapshot } from "./prospect-pricing.js";

const SEEDS = "manual_outreach_seeds", CONTROLS = "manual_outreach_controls";
const STAGES = ["initial", "follow_up_1", "follow_up_2"] as const;
const DAY_MS = 86_400_000, MAX_AGE_MS = 30 * DAY_MS;
const DEFAULT_SEED = fileURLToPath(new URL("../../../private-outreach/seed.json", import.meta.url));
export type ManualOutreachStageId = typeof STAGES[number];
export type ManualOutreachStatus = "active" | "hold" | "replied" | "do_not_contact" | "closed";
export type ManualOutreachAction = "reviewed" | "sent" | "replied" | "hold" | "do_not_contact" | "closed" | "resume";
interface Draft { to: string; subject: string; text: string }
interface Seed {
  id: string; businessName: string; location: string; industry: string; contactEmail: string; sourceUrl: string;
  observation: string; opportunity: string; checkedAt: string; previewUrl: string | null; previewExpiresAt: string | null;
  eligible: boolean; holdReason: string | null; reviewFlags: string[]; drafts: Record<ManualOutreachStageId, Draft>;
  assignedAt: string; assignedDay: string; fixture: boolean;
}
interface StageControl { reviewedHash?: string; sentAt?: string; sentDraft?: Draft }
interface Control { revision: number; status: ManualOutreachStatus; stages: Partial<Record<ManualOutreachStageId, StageControl>>; updatedAt: string }
export interface ManualOutreachStage extends Draft {
  id: ManualOutreachStageId; contentHash: string; reviewed: boolean; sentAt: string | null; dueAt: string | null; ready: boolean;
}
export interface ManualOutreachRow {
  leadId: string; businessName: string; location: string; industry: string; sourceUrl: string; observation: string;
  opportunity?: string; checkedAt: string | null; previewUrl: string | null; previewReady: boolean; proofUrl: string;
  eligible: boolean; holdReason: string | null; reviewFlags: string[]; revision: number; status: ManualOutreachStatus;
  stages: ManualOutreachStage[]; sourceKind: "reviewed_seed" | "daily_research";
}
export interface ManualOutreachSnapshot {
  mode: "live" | "fake"; generatedAt: string; day: string; timeZone: "Australia/Melbourne";
  schedule: { enabled: boolean; startHour: 7; target: number };
  counts: { ready: number; due: number; hold: number; newToday: number; shortfall: number };
  rows: ManualOutreachRow[]; notes: string[];
}
interface Options { atlas: Atlas; pricing: ProspectPricing; discovery: DiscoveryProgram; mode: "live" | "fake"; publicOrigin?: string; env?: NodeJS.ProcessEnv; clock?: () => Date }
export class ManualOutreachError extends Error { constructor(message: string, readonly status: 400 | 404 | 409 | 503 = 400) { super(message); } }

/** Private preparation and owner-reported notes only. This service has no sending or publishing transport. */
export class ManualOutreach {
  private readonly store;
  private readonly clock: () => Date;
  private readonly origin: string | null;
  private seedNote: string | null = null;
  constructor(private readonly options: Options) {
    this.store = options.atlas.deps.store; this.clock = options.clock ?? options.atlas.clock;
    this.origin = httpsUrl(options.publicOrigin)?.replace(/\/$/, "") ?? null;
    this.importSeedFile(options.env?.ATLAS_OUTREACH_SEED_PATH ?? DEFAULT_SEED);
  }

  snapshot(): ManualOutreachSnapshot {
    const now = this.clock(), day = discoveryDay(now), settings = this.options.discovery.settings();
    const target = settings.target === "no_website" ? settings.count : 20;
    const records = this.store.listDocs<AcquisitionRecord>("acquisition_records", 10_000).map(r => r.doc);
    const pricing = this.options.pricing.snapshot(), prices = new Map(pricing.rows.map(r => [r.leadId, r]));
    const used = new Set<string>(), rows: ManualOutreachRow[] = [], assigned = new Map<string, string>();
    for (const { doc: seed } of this.store.listDocs<Seed>(SEEDS, 100)) {
      const matches = records.filter(r => key(r.businessName) === key(seed.businessName) || email(r.contact?.email) === seed.contactEmail);
      const exact = matches.find(r => key(r.businessName) === key(seed.businessName) && email(r.contact?.email) === seed.contactEmail);
      for (const match of matches) used.add(match.id);
      if (this.options.mode === "live" && seed.fixture) continue;
      const related = [...matches].sort((a, b) => this.recordRisk(b, prices.get(b.id)) - this.recordRisk(a, prices.get(a.id)))[0];
      const identityConflict = matches.length > 0 && !exact ? "The new research and saved name or email do not agree. Review the business identity before contact." : null;
      rows.push(this.seedRow(seed, related, related ? prices.get(related.id) : undefined, identityConflict));
      assigned.set(seed.id, seed.assignedDay);
    }
    const reported = new Map<string, string>();
    for (const { doc } of this.store.listDocs<{ day: string; businesses: Array<{ leadId: string }> }>("discovery_program_reports", 60)) {
      if (!/^20\d\d-\d\d-\d\d$/.test(doc.day) || !Array.isArray(doc.businesses)) continue;
      for (const row of doc.businesses) if (typeof row.leadId === "string" && (!reported.has(row.leadId) || reported.get(row.leadId)! > doc.day)) reported.set(row.leadId, doc.day);
    }
    for (const record of records.sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      if (rows.length >= 200) break;
      if (used.has(record.id) || !reported.has(record.id) || record.archivedAt) continue;
      const price = prices.get(record.id); if (!price) continue;
      rows.push(this.dynamicRow(record, price, pricing.sender)); assigned.set(record.id, reported.get(record.id)!);
    }
    rows.sort((a, b) => Number(b.stages.some(s => s.ready)) - Number(a.stages.some(s => s.ready)) || a.businessName.localeCompare(b.businessName));
    const ready = rows.filter(r => r.stages[0]?.ready).length;
    const due = rows.reduce((n, r) => n + r.stages.slice(1).filter(s => s.ready).length, 0);
    const newToday = rows.filter(r => r.eligible && assigned.get(r.leadId) === day).length;
    return { mode: this.options.mode, generatedAt: now.toISOString(), day, timeZone: "Australia/Melbourne", schedule: { enabled: settings.enabled, startHour: 7, target }, counts: { ready, due, hold: rows.filter(r => !r.eligible || r.status !== "active").length, newToday, shortfall: Math.max(0, target - newToday) }, rows, notes: [
      "Open in your email app prepares a draft only. Review and send there, then record Sent manually here. No automatic sending or delivery claim is made.",
      "First follow-up is due three days after the initial email is recorded sent; the second is due four days after the first follow-up. Replies, holds and do-not-contact stop the sequence.",
      "Twenty new businesses per Melbourne day is a target. Backlogged prospects remain visible and are not counted again as newly found today.",
      "Review each dated source, recipient, contact relevance and preview before composing. A published email or missing website does not establish permission or current trading status.",
      ...(this.seedNote ? [this.seedNote] : []),
    ] };
  }

  update(leadId: string, input: unknown): ManualOutreachSnapshot {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ManualOutreachError("Provide the manual sequence update.");
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some(k => !["expectedRevision", "action", "stage", "expectedDraftHash"].includes(k)) || !Number.isInteger(value.expectedRevision) || Number(value.expectedRevision) < 0 || !["reviewed", "sent", "replied", "hold", "do_not_contact", "closed", "resume"].includes(String(value.action))) throw new ManualOutreachError("Choose a recognised manual action and the current revision.");
    if (value.stage !== undefined && !STAGES.includes(value.stage as ManualOutreachStageId)) throw new ManualOutreachError("Choose the initial email or one of its two follow-ups.");
    const row = this.snapshot().rows.find(r => r.leadId === leadId);
    if (!row) throw new ManualOutreachError("This prospect is not in the private review queue.", 404);
    const current = this.control(leadId);
    if (current.revision !== value.expectedRevision) throw new ManualOutreachError("This sequence changed. Refresh and review the current version.", 409);
    const action = value.action as ManualOutreachAction, stageId = value.stage as ManualOutreachStageId | undefined;
    if (["replied", "closed", "do_not_contact"].includes(current.status) && action !== current.status && action !== "do_not_contact") throw new ManualOutreachError("Replied, closed and do-not-contact records remain stopped. They cannot be resumed through a temporary hold.", 409);
    const next: Control = { ...current, revision: current.revision + 1, updatedAt: this.iso(), stages: structuredClone(current.stages) };
    if (action === "reviewed" || action === "sent") {
      const stage = row.stages.find(s => s.id === stageId);
      if (!stage) throw new ManualOutreachError("Choose the draft you reviewed.");
      if (typeof value.expectedDraftHash !== "string" || !/^[a-f0-9]{64}$/.test(value.expectedDraftHash)) throw new ManualOutreachError("Provide the exact draft hash shown with this email.");
      if (value.expectedDraftHash !== stage.contentHash) throw new ManualOutreachError("This email text changed. Refresh and review the current draft before continuing.", 409);
      if (!row.eligible || row.status !== "active") throw new ManualOutreachError("This prospect is held or stopped. Resolve its recorded issue before contact.", 409);
      if (stage.sentAt) throw new ManualOutreachError("This stage is already recorded sent. No duplicate was created.", 409);
      if (action === "sent" && (!stage.reviewed || !stage.ready)) throw new ManualOutreachError("Review this exact draft and wait until its stage is due before recording it sent.", 409);
      next.stages[stage.id] = { ...next.stages[stage.id], ...(action === "reviewed" ? { reviewedHash: draftHash(stage) } : { sentAt: this.iso(), sentDraft: { to: stage.to, subject: stage.subject, text: stage.text } }) };
    } else if (action === "resume") {
      if (current.status !== "hold") throw new ManualOutreachError("Only a temporary hold can be resumed. Replied, closed and do-not-contact records remain stopped.", 409);
      next.status = "active";
    } else {
      if (current.status === "do_not_contact" && action !== "do_not_contact") throw new ManualOutreachError("Do-not-contact records cannot be resumed or downgraded here.", 409);
      next.status = action;
    }
    if (action === "do_not_contact") this.store.upsertDoc("acquisition_suppressions", emailHash(row.stages[0]!.to), { at: this.iso(), source: "owner_manual_outreach" });
    this.store.upsertDoc(CONTROLS, leadId, next);
    this.options.atlas.audit.record({ actor: "owner", action: "execute.record_update", business: "wulff_studio", targetType: "manual_outreach", targetId: leadId, outcome: "completed", detail: { operation: "manual_outreach_note", action, ...(stageId ? { stage: stageId } : {}), revision: next.revision, noEmailSent: true, ownerReportedOnly: true } });
    return this.snapshot();
  }

  private seedRow(seed: Seed, record: AcquisitionRecord | undefined, price: ProspectPricingRow | undefined, conflict: string | null): ManualOutreachRow {
    const previewReady = Boolean(seed.previewUrl && (!seed.previewExpiresAt || Date.parse(seed.previewExpiresAt) > this.clock().getTime()));
    const ageReason = this.evidenceIssue(seed.checkedAt);
    const relatedIssue = this.isSuppressed(seed.contactEmail) ? "This recipient is suppressed from further contact." : this.recordIssue(record, price);
    const holdReason = !seed.eligible ? seed.holdReason || "The researcher marked this business for review before contact." : conflict ?? relatedIssue ?? ageReason ?? (!previewReady ? "The personalised preview is unavailable or expired. Check it before composing." : null);
    return this.buildRow({ leadId: seed.id, businessName: seed.businessName, location: seed.location, industry: seed.industry, sourceUrl: seed.sourceUrl, observation: seed.observation, opportunity: seed.opportunity, checkedAt: seed.checkedAt, previewUrl: seed.previewUrl, previewReady, proofUrl: seed.previewUrl ?? "https://wulffdigital.com/#work", eligible: !holdReason, holdReason, reviewFlags: seed.reviewFlags, sourceKind: "reviewed_seed" }, seed.drafts, record, price);
  }

  private dynamicRow(record: AcquisitionRecord, price: ProspectPricingRow, sender: ProspectPricingSnapshot["sender"]): ManualOutreachRow {
    const q = this.store.getMemory<NoWebsiteQualification>(noWebsiteQualificationKey(record.id));
    const checkedAt = q?.checkedAt ?? null;
    const validSource = Boolean(q && q.noIndependentWebsiteFound && q.email === record.contact?.email && q.sourceUrl === record.sourceUrl && q.sourceUrl === record.contact?.sourceUrl && q.searchQueries?.length);
    const demo = record.demo;
    const previewUrl = demo?.publishedAt && demo.publicPath && /^\/demos\/[A-Za-z0-9_-]+$/.test(demo.publicPath) && Date.parse(demo.expiresAt) > this.clock().getTime() && this.origin ? this.origin + demo.publicPath : null;
    const holdReason = this.recordIssue(record, price) ?? (!validSource ? "This older prospect needs current source and website checks before it can enter the ready queue." : this.evidenceIssue(checkedAt));
    const sourceUrl = httpsUrl(record.contact?.sourceUrl) ?? httpsUrl(record.sourceUrl) ?? "";
    const benefit = industryBenefit(record.industry, record.services);
    const proofUrl = previewUrl ?? "https://wulffdigital.com/#work";
    const facts = record.services.filter(s => typeof s === "string" && s.length < 160).slice(0, 3);
    const observation = validSource ? `The recorded public listing describes ${facts.length ? facts.join(", ") : record.industry.toLowerCase()} in ${record.location}. A dated name and locality search did not find an independent website; this does not prove that none exists.` : "The existing research is awaiting a current source check.";
    const drafts = this.dynamicDrafts(record, benefit, proofUrl, Boolean(previewUrl), sender);
    return this.buildRow({ leadId: record.id, businessName: record.businessName, location: record.location, industry: record.industry, sourceUrl, observation, opportunity: benefit, checkedAt, previewUrl, previewReady: Boolean(previewUrl), proofUrl, eligible: !holdReason && Boolean(sourceUrl), holdReason: holdReason ?? (!sourceUrl ? "A current public contact source is missing." : null), reviewFlags: ["Check current trading and relevance before sending.", ...(!previewUrl ? ["The personalised concept is private; the email links to Wulff Digital’s public work instead."] : [])], sourceKind: "daily_research" }, drafts, record, price);
  }

  private buildRow(base: Omit<ManualOutreachRow, "revision" | "status" | "stages">, drafts: Record<ManualOutreachStageId, Draft>, record?: AcquisitionRecord, price?: ProspectPricingRow): ManualOutreachRow {
    const control = this.control(base.leadId), legacy = price?.price.manualEmailStatus;
    const forced: ManualOutreachStatus | undefined = legacy === "do_not_contact" ? "do_not_contact" : legacy === "replied" ? "replied" : legacy === "closed" ? "closed" : undefined;
    const status = this.isSuppressed(drafts.initial.to) ? "do_not_contact" : forced ?? control.status;
    const legacySentValue = ["sent", "follow_up"].includes(legacy ?? "") ? price?.price.manualEmailSentAt ?? null : record?.draft?.status === "accepted" ? record.draft.acceptedAt ?? null : null;
    const initialLegacySent = validTimestamp(legacySentValue) ? legacySentValue : null;
    const first = control.stages.initial?.sentAt ?? initialLegacySent;
    const follow = control.stages.follow_up_1?.sentAt ?? null;
    const stages = STAGES.map((id, index): ManualOutreachStage => {
      const saved = control.stages[id], draft = saved?.sentDraft ?? drafts[id];
      const sentAt = saved?.sentAt ?? (id === "initial" ? initialLegacySent : null);
      const previousAt = index === 1 ? first : index === 2 ? follow : null;
      const dueAt = index === 0 ? this.iso() : previousAt ? new Date(Date.parse(previousAt) + (index === 1 ? 3 : 4) * DAY_MS).toISOString() : null;
      return { ...draft, id, contentHash: draftHash(draft), reviewed: saved?.reviewedHash === draftHash(draft), sentAt, dueAt, ready: base.eligible && status === "active" && !sentAt && Boolean(dueAt) && Date.parse(dueAt!) <= this.clock().getTime() };
    });
    return { ...base, status, revision: control.revision, stages };
  }

  private recordIssue(record?: AcquisitionRecord, price?: ProspectPricingRow): string | null {
    if (!record) return null;
    const prospect = this.options.atlas.prospects.get(record.prospectId);
    if (record.contact?.email && this.isSuppressed(record.contact.email)) return "This recipient is suppressed from further contact.";
    if (record.archivedAt || !prospect || this.options.mode === "live" && prospect.fixture || prospect.qualification === "disqualified" || prospect.contactEligibility.suppressed || isCustomerStage(prospect.stage)) return "This saved business is archived, suppressed, disqualified or already a client.";
    if (["queued", "submitting", "uncertain", "cancelled", "simulated"].includes(record.draft?.status ?? "")) return "An existing submission is active, uncertain or stopped. Resolve it before preparing another email.";
    if (["sent", "follow_up"].includes(price?.price.manualEmailStatus ?? "") && !validTimestamp(price?.price.manualEmailSentAt) || record.draft?.status === "accepted" && !validTimestamp(record.draft.acceptedAt)) return "A previous contact is recorded without a valid sent date. Resolve that history before preparing another email.";
    if (price?.websiteStatus === "own_site") return "The saved record includes an independent website. Recheck the current opportunity before contact.";
    return null;
  }
  private recordRisk(record: AcquisitionRecord, price?: ProspectPricingRow): number {
    if (this.recordIssue(record, price)) return 1000;
    const state = price?.price.manualEmailStatus;
    return state === "do_not_contact" ? 900 : state === "replied" ? 800 : state === "closed" ? 700 : ["sent", "follow_up"].includes(state ?? "") || record.draft?.status === "accepted" ? 600 : 0;
  }
  private isSuppressed(value: string): boolean { return Boolean(this.store.getDoc("acquisition_suppressions", emailHash(value))); }

  private evidenceIssue(value: string | null): string | null {
    const time = value ? Date.parse(value) : NaN, now = this.clock().getTime();
    return !Number.isFinite(time) || time > now + 5 * 60_000 ? "A valid dated source check is missing." : now - time > MAX_AGE_MS ? "This source check is over thirty days old. Refresh the research before contact." : null;
  }
  private control(id: string): Control { return this.store.getDoc<Control>(CONTROLS, id)?.doc ?? { revision: 0, status: "active", stages: {}, updatedAt: this.iso() }; }
  private iso() { return this.clock().toISOString(); }

  private dynamicDrafts(record: AcquisitionRecord, benefit: string, proofUrl: string, previewReady: boolean, sender: ProspectPricingSnapshot["sender"]): Record<ManualOutreachStageId, Draft> {
    const firstName = sender.name.split(" ")[0] || "Brandon";
    const signature = ["Cheers,", sender.name || "Brandon Wulff", sender.organisation || "Wulff Digital", sender.contactDetails].filter(Boolean).join("\n");
    const offering = record.services.filter(s => typeof s === "string" && s.length < 160).slice(0, 2).join(" and ") || record.industry.toLowerCase();
    const proof = previewReady ? `I’ve put together a website concept for your business: ${proofUrl}` : `Here’s some of our work so you can see the kind of site we can build: ${proofUrl}`;
    const end = `\n\n${signature}\n\nTo stop future emails, reply unsubscribe.`;
    const to = email(record.contact?.email) ?? "";
    return {
      initial: { to, subject: `A website idea for ${record.businessName}`, text: `Hi ${record.businessName} team,\n\nI came across your public listing while looking at ${offering} in ${record.location}. I couldn’t find a separate business website in the checks I made.\n\nI’m ${firstName} from ${sender.organisation || "Wulff Digital"}. ${benefit}\n\n${proof}\n\nWe can tailor the photos, wording and scope around your business and budget. For the finished site, I’d also focus on clear service and location information and fast mobile pages to help Google understand what you offer.\n\nWhich service would you most like the site to bring enquiries for?${end}` },
      follow_up_1: { to, subject: `A thought about ${record.businessName}’s website`, text: `Hi ${record.businessName} team,\n\nOne thought on the website idea: ${benefit}\n\nA short page can explain the service, show your own work and give someone one clear way to enquire, without making them search through separate listings.\n\n${proof}\n\nWould ${offering} be the right place to start?${end}` },
      follow_up_2: { to, subject: `A simple starting point for ${record.businessName}`, text: `Hi ${record.businessName} team,\n\nWe could keep the first version focused: the services you want to promote, your own photos, the area you cover and one straightforward enquiry route. I can help with the wording and details.\n\n${proof}\n\nThe package and scope can be shaped around what you need, with the price agreed before the build.\n\nWould a quick chat about a simple first version be useful?${end}` },
    };
  }

  private importSeedFile(path: string): void {
    let handle: number | undefined;
    try {
      if (!isAbsolute(path) || !path.endsWith(".json") || path.length > 1024) throw new Error("Invalid seed path");
      handle = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = fstatSync(handle); if (!stat.isFile() || stat.size < 2 || stat.size > 2 * 1024 * 1024) throw new Error("Invalid seed file");
      const bytes = readFileSync(handle); if (bytes.length > 2 * 1024 * 1024) throw new Error("Seed exceeded limit");
      const seeds = parseSeeds(JSON.parse(bytes.toString("utf8")), this.clock(), this.options.mode);
      for (const seed of seeds) {
        const previous = this.store.getDoc<Seed>(SEEDS, seed.id)?.doc;
        const history = this.store.listDocs<AcquisitionRecord>("acquisition_records", 10_000).map(r => r.doc).filter(r => key(r.businessName) === key(seed.businessName) || email(r.contact?.email) === seed.contactEmail);
        const existingControl = this.store.getDoc<Control>(CONTROLS, seed.id)?.doc;
        const priorControls = history.flatMap(record => { const control = this.store.getDoc<Control>(CONTROLS, record.id)?.doc; return control ? [control] : []; });
        if (!existingControl && priorControls.length) this.store.upsertDoc(CONTROLS, seed.id, mergeHistory(priorControls, this.iso()));
        if (previous && seedFingerprint(previous) !== seedFingerprint(seed)) {
          const current = this.control(seed.id), stages = structuredClone(current.stages);
          for (const id of STAGES) if (stages[id] && !stages[id]!.sentAt) delete stages[id]!.reviewedHash;
          this.store.upsertDoc(CONTROLS, seed.id, { ...current, stages, revision: current.revision + 1, updatedAt: this.iso() });
        }
        const earlier = priorControls.length ? history.filter(r => validTimestamp(r.createdAt)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.createdAt : undefined;
        this.store.upsertDoc(SEEDS, seed.id, { ...seed, assignedAt: previous?.assignedAt ?? earlier ?? seed.assignedAt, assignedDay: previous?.assignedDay ?? (earlier ? discoveryDay(new Date(earlier)) : seed.assignedDay) });
      }
      this.seedNote = `${seeds.length} researched prospects loaded for private review. This is a reviewed import, not evidence that the daily worker discovered them.`;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) this.seedNote = "The optional private research import could not be validated. Previously saved prospects remain available; no replacement was invented.";
    } finally { if (handle !== undefined) closeSync(handle); }
  }
}

function key(value: string): string { return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function email(value: unknown): string | null { return typeof value === "string" && value.length <= 254 && /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}$/i.test(value) ? value.toLowerCase() : null; }
function httpsUrl(value: unknown): string | null {
  try { if (typeof value !== "string" || value.length > 2000) return null; const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.)/i.test(url.hostname) || !url.hostname.includes(".") || url.hostname.includes(":")) return null; return url.href; } catch { return null; }
}
function draftHash(draft: Draft): string { return createHash("sha256").update(JSON.stringify({ to: draft.to, subject: draft.subject, text: draft.text })).digest("hex"); }
function emailHash(value: string): string { return createHash("sha256").update(value.trim().toLowerCase()).digest("hex"); }
function validTimestamp(value: unknown): boolean { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function mergeHistory(controls: Control[], now: string): Control {
  const strength: Record<ManualOutreachStatus, number> = { active: 0, hold: 1, closed: 2, replied: 3, do_not_contact: 4 };
  const status = [...controls].sort((a, b) => strength[b.status] - strength[a.status])[0]!.status;
  const stages: Control["stages"] = {};
  for (const id of STAGES) {
    const sent = controls.map(c => c.stages[id]).filter((s): s is StageControl => Boolean(s?.sentAt && validTimestamp(s.sentAt))).sort((a, b) => b.sentAt!.localeCompare(a.sentAt!))[0];
    if (sent) stages[id] = { ...sent };
  }
  return { revision: Math.max(...controls.map(c => c.revision)) + 1, status, stages, updatedAt: now };
}
function seedFingerprint(seed: Seed): string { const { assignedAt: _at, assignedDay: _day, ...facts } = seed; return contentHash(facts); }
function text(value: unknown, max: number, optional = false): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || !optional && !value.trim()) throw new Error("Invalid research field"); return value.trim();
}
function parseSeeds(value: unknown, now: Date, mode: "live" | "fake"): Seed[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid research bundle");
  const bundle = value as Record<string, unknown>;
  if (bundle.version !== 1 || !Array.isArray(bundle.prospects) || bundle.prospects.length > 100) throw new Error("Invalid research bundle");
  const names = new Set<string>(), emails = new Set<string>();
  return bundle.prospects.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid prospect");
    const row = item as Record<string, unknown>, businessName = text(row.businessName ?? row.name, 200), contactEmail = email(row.contactEmail ?? row.to);
    const sourceUrl = httpsUrl(row.sourceUrl), previewUrl = row.previewUrl === null || row.previewUrl === undefined ? null : httpsUrl(row.previewUrl);
    const checkedAt = text(row.checkedAt ?? bundle.checkedAt ?? bundle.generatedAt, 40);
    if (!contactEmail || !sourceUrl || row.previewUrl && !previewUrl || !Number.isFinite(Date.parse(checkedAt)) || Date.parse(checkedAt) > now.getTime() + 5 * 60_000 || names.has(key(businessName)) || emails.has(contactEmail) || mode === "live" && row.fixture === true) throw new Error("Invalid or duplicate prospect");
    names.add(key(businessName)); emails.add(contactEmail);
    const id = "manual_" + contentHash([key(businessName), contactEmail]).slice(0, 24);
    const drafts = {} as Record<ManualOutreachStageId, Draft>;
    for (const [id, name] of [["initial", "initial"], ["follow_up_1", "followUp1"], ["follow_up_2", "followUp2"]] as const) {
      const raw = row[name]; if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Missing sequence draft");
      const draft = raw as Record<string, unknown>, subject = text(draft.subject, 200), body = text(draft.text ?? draft.body, 8000);
      if (/[\r\n]/.test(subject) || /A\$|\$\s*\d/.test(body) || !body.includes(previewUrl ?? "https://wulffdigital.com")) throw new Error("Invalid sales draft");
      drafts[id] = { to: contactEmail, subject, text: body };
    }
    const expires = row.previewExpiresAt === null || row.previewExpiresAt === undefined ? null : text(row.previewExpiresAt, 40);
    if (expires && !Number.isFinite(Date.parse(expires))) throw new Error("Invalid preview expiry");
    const eligible = typeof row.eligible === "boolean" ? row.eligible : row.eligibility === "ready";
    if (row.eligible !== undefined && typeof row.eligible !== "boolean") throw new Error("Invalid eligibility");
    const reviewFlags = row.reviewFlags === undefined ? [] : Array.isArray(row.reviewFlags) && row.reviewFlags.length <= 20 ? row.reviewFlags.map(v => text(v, 500)) : (() => { throw new Error("Invalid review flags"); })();
    return { id, businessName, contactEmail, location: text(row.location, 200), industry: text(row.industry, 160), sourceUrl, checkedAt, previewUrl, previewExpiresAt: expires, observation: text(row.observation, 2400), opportunity: text(row.opportunity ?? "A clear website can give customers a useful first introduction and a straightforward enquiry route.", 1200), eligible, holdReason: row.holdReason === null || row.holdReason === undefined ? null : text(row.holdReason, 1000), reviewFlags, drafts, assignedAt: now.toISOString(), assignedDay: discoveryDay(now), fixture: row.fixture === true };
  });
}
function industryBenefit(industry: string, services: string[]): string {
  const context = `${industry} ${services.join(" ")}`.toLowerCase();
  if (/clean|pressure|wash/.test(context)) return "A clear website can show the cleaning jobs you take on, explain the areas you cover and make requesting a quote straightforward.";
  if (/cater|coffee|food|graz|cafe|restaurant/.test(context)) return "A website can bring your food or drinks, occasion details and enquiry route together so customers can plan before they contact you.";
  if (/salon|hair|beauty|lash|barber/.test(context)) return "A website can show your services and your own work, help someone find the location and make an appointment enquiry easy from their phone.";
  if (/event|party|balloon|hire|styling/.test(context)) return "A visual website can show your own setups and hire options, then help someone send through their event date and requirements.";
  if (/tutor|music|lesson|teach/.test(context)) return "A website can explain your lessons, who they suit and how to enquire, giving a new student or parent a clear place to start.";
  if (/landscap|garden|fenc|timber|maintenance|trade/.test(context)) return "A website can show the work you take on, the areas you cover and examples of your own jobs, with a clear route to ask about a project.";
  return "A focused website can explain what you offer, build credibility through your own work and give interested customers a clear way to enquire.";
}

/** Install only after the normal owner-session and same-origin JSON middleware. */
export function installManualOutreachRoutes(app: Hono, service: ManualOutreach): void {
  const headers = (c: Context) => { c.header("Cache-Control", "no-store"); c.header("X-Robots-Tag", "noindex, nofollow, noarchive"); c.header("Referrer-Policy", "no-referrer"); };
  const fail = (c: Context, error: unknown) => error instanceof ManualOutreachError ? c.json({ error: error.message }, error.status) : c.json({ error: "The private manual outreach queue is unavailable. No email was sent." }, error instanceof SyntaxError ? 400 : 503);
  app.get("/api/manual-outreach", c => { try { headers(c); if (requiredLevel("read.records") !== PermissionLevel.Read) throw new ManualOutreachError("The current action policy does not permit this view.", 503); return c.json(service.snapshot()); } catch (error) { return fail(c, error); } });
  app.post("/api/manual-outreach/leads/:id", async c => { try { headers(c); if (requiredLevel("execute.record_update") !== PermissionLevel.ExecuteRoutine) throw new ManualOutreachError("The current action policy does not permit a private note.", 503); return c.json(service.update(c.req.param("id"), await c.req.json())); } catch (error) { return fail(c, error); } });
}

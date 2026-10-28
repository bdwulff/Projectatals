import type { Atlas, AcquisitionRecord, AcquisitionSenderInput, Prospect } from "@atlas/core";
import type { Context, Hono } from "hono";
import { classifyWebsitePresence } from "./site-rebuilds.js";
import { createPricingCsv, createPricingWorkbook, type SpreadsheetSheet } from "./prospect-pricing-workbook.js";
import { noWebsiteQualificationKey, type NoWebsiteQualification } from "./no-website-research.js";

const COLLECTION = "prospect_pricing", RECORDS = "acquisition_records", MAX_RECORDS = 10_000;
const STATUSES = ["not_sent", "sent", "replied", "follow_up", "closed", "do_not_contact"] as const;
export type ManualEmailStatus = typeof STATUSES[number];
export interface ProspectPrice {
  revision: number; suggestedQuoteAud: number; quoteBasis: "existing_internal_recommendation" | "services_heuristic" | "owner_edited";
  proposedPages: 1 | 3 | 5; proposedScope: string; gstStatus: "unconfirmed"; exclusions: string[];
  manualEmailStatus: ManualEmailStatus; manualEmailSentAt: string | null; notes: string; updatedAt: string;
}
interface StoredPrice extends ProspectPrice { leadId: string; sourceFingerprint: string; createdAt: string }
export interface ProspectPricingRow {
  leadId: string; prospectId: string; businessName: string; location: string; industry: string; createdAt: string;
  discoveryDay: string; discoveryDays: string[]; services: string[]; website: string | null;
  websiteStatus: "own_site" | "social_only" | "not_recorded" | "unknown"; noWebsite: boolean; sourceUrl: string; observation: string;
  contactEmail: string | null; contactSourceUrl: string | null; contactReviewRequired: boolean; businessPhone: string | null; address: string | null;
  demoReady: boolean; previewPath: string | null; previewUrl: string | null; sourcePath: string | null; sourceDownloadUrl: string | null; reviewPath: string;
  draft: { from: string; to: string; subject: string; text: string; status: string } | null; price: ProspectPrice;
}
export interface ProspectPricingSnapshot {
  mode: "live" | "fake"; currency: "AUD"; timeZone: "Australia/Melbourne"; generatedAt: string; day: string | null;
  lastSyncedAt: string | null;
  sender: AcquisitionSenderInput & { ownerPhone: string };
  rows: ProspectPricingRow[]; notes: string[];
}
export interface ProspectPricingOptions { atlas: Atlas; mode: "live" | "fake"; publicOrigin?: string; clock?: () => Date }
export class ProspectPricingError extends Error { constructor(message: string, readonly status: 400 | 404 | 409 | 503 = 400) { super(message); } }
function discoveryDay(now: Date): string { const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now); const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)!.value; return `${part("year")}-${part("month")}-${part("day")}`; }
const EXCLUSIONS = ["Hosting and domain registration", "Paid third-party services", "Ongoing maintenance unless separately agreed"];
function text(value: unknown, max: number): string { return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, max) : ""; }
function publicUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try { const u = new URL(value); if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.port || !u.hostname.includes(".") || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(":") || /(?:^|\.)(?:local|localhost|internal|invalid|home|lan)$/.test(u.hostname)) return null; return u.href; } catch { return null; }
}
function origin(value: string | undefined): string | null { const valid = publicUrl(value); if (!valid) return null; const u = new URL(valid); return u.protocol === "https:" && u.pathname === "/" && !u.search && !u.hash ? u.origin : null; }
function email(value: unknown): string | null { const v = text(value, 254); return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(v) ? v : null; }
function amount(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000 && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001; }
function validDay(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^20\d\d-\d\d-\d\d$/.test(value)) throw new ProspectPricingError("Use a Melbourne day in YYYY-MM-DD format.");
  const parsed = new Date(value + "T00:00:00Z"); if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new ProspectPricingError("Provide a real calendar day."); return value;
}
function recordDay(value: string, fallback: Date): string { const date = new Date(value); return discoveryDay(Number.isFinite(date.getTime()) ? date : fallback); }
function recordedServices(record: AcquisitionRecord): string[] {
  const values = [...(Array.isArray(record.services) ? record.services : []), ...(Array.isArray(record.businessProfile?.services) ? record.businessProfile.services : [])];
  const seen = new Set<string>(); return values.map(v => text(v, 150)).filter(v => { const k = v.normalize("NFKC").toLowerCase(); if (!v || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 30);
}

/** Private estimates and owner-reported outreach notes; this service cannot send, publish or create a customer quote. */
export class ProspectPricing {
  private readonly store; private readonly clock: () => Date; private readonly publicOrigin: string | null;
  constructor(private readonly options: ProspectPricingOptions) { this.store = options.atlas.deps.store; this.clock = options.clock ?? options.atlas.clock; this.publicOrigin = origin(options.publicOrigin); }

  /** Daily preparation calls this after creating leads. Existing owner price/scope overrides are preserved. */
  sync(): { created: number; updated: number; total: number } {
    let created = 0, updated = 0; const records = this.records();
    for (const record of records) {
      const prior = this.saved(record.id), next = this.recommendation(record);
      if (!prior) { this.store.upsertDoc(COLLECTION, record.id, { ...next, revision: 1 } satisfies StoredPrice); created++; }
      else if (prior.quoteBasis !== "owner_edited" && prior.sourceFingerprint !== next.sourceFingerprint) {
        this.store.upsertDoc(COLLECTION, record.id, { ...prior, suggestedQuoteAud: next.suggestedQuoteAud, quoteBasis: next.quoteBasis, proposedPages: next.proposedPages, proposedScope: next.proposedScope, sourceFingerprint: next.sourceFingerprint, revision: prior.revision + 1, updatedAt: this.iso() } satisfies StoredPrice); updated++;
      }
    }
    this.store.setMemory("prospect_pricing.last_sync", this.iso()); return { created, updated, total: records.length };
  }

  /** Joins current facts and private links on every request without network access or implicit writes. */
  snapshot(day?: string): ProspectPricingSnapshot {
    const selected = validDay(day), discovery = this.discoveryDays(), now = this.clock();
    const rows = this.records().map(record => this.row(record, discovery.get(record.id) ?? [], now)).filter(row => !selected || row.discoveryDays.includes(selected));
    rows.sort((a, b) => b.discoveryDay.localeCompare(a.discoveryDay) || a.businessName.localeCompare(b.businessName, "en-AU") || a.leadId.localeCompare(b.leadId));
    return { mode: this.options.mode, currency: "AUD", timeZone: "Australia/Melbourne", generatedAt: this.iso(), day: selected ?? null, lastSyncedAt: this.store.getMemory<string>("prospect_pricing.last_sync"), sender: this.sender(), rows,
      notes: ["Private internal starting estimates only; owner review is required before any customer quote.", "GST registration and treatment are unconfirmed. Hosting, domains and external service fees are excluded.", "Scope estimates use recorded service counts, not verified page requirements, bookings or commerce integrations.", "A missing website is not proof that the business has none. Check the cited sources and contact permission.", "Manual email status is an owner-reported log, separate from provider submission status. No email is sent by this feature."] };
  }

  update(leadId: string, input: unknown): ProspectPricingSnapshot {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ProspectPricingError("Provide a pricing update object.");
    const data = input as Record<string, unknown>, allowed = ["expectedRevision", "suggestedQuoteAud", "proposedScope", "manualEmailStatus", "manualEmailSentAt", "notes"];
    if (Object.keys(data).some(k => !allowed.includes(k)) || !Number.isInteger(data.expectedRevision) || Number(data.expectedRevision) < 0 || !Object.keys(data).some(k => k !== "expectedRevision")) throw new ProspectPricingError("Provide editable pricing fields and the current revision.");
    const record = this.records().find(r => r.id === leadId); if (!record) throw new ProspectPricingError("Prospect pricing record not found.", 404);
    const current = this.saved(leadId) ?? this.recommendation(record);
    if (current.revision !== data.expectedRevision) throw new ProspectPricingError("This pricing row changed. Refresh and review the current version.", 409);
    const next: StoredPrice = { ...current, exclusions: [...current.exclusions], revision: current.revision + 1, updatedAt: this.iso() };
    if ("suggestedQuoteAud" in data) { if (!amount(data.suggestedQuoteAud)) throw new ProspectPricingError("Use an AUD amount from zero to one million with at most two decimal places."); next.suggestedQuoteAud = data.suggestedQuoteAud; next.quoteBasis = "owner_edited"; }
    for (const key of ["proposedScope", "notes"] as const) if (key in data) {
      if (typeof data[key] !== "string" || data[key].length > (key === "notes" ? 2000 : 1500) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(data[key])) throw new ProspectPricingError("Scope and notes must be bounded plain text.");
      next[key] = data[key].trim(); if (key === "proposedScope") { if (!next.proposedScope) throw new ProspectPricingError("Provide the proposed scope."); next.quoteBasis = "owner_edited"; }
    }
    if ("manualEmailStatus" in data) { if (!STATUSES.includes(data.manualEmailStatus as ManualEmailStatus)) throw new ProspectPricingError("Choose a recognised manual email status."); next.manualEmailStatus = data.manualEmailStatus as ManualEmailStatus; if (next.manualEmailStatus === "sent" && !next.manualEmailSentAt) next.manualEmailSentAt = this.iso(); if (next.manualEmailStatus === "not_sent") next.manualEmailSentAt = null; }
    if ("manualEmailSentAt" in data) {
      if (data.manualEmailSentAt !== null && (typeof data.manualEmailSentAt !== "string" || !/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(data.manualEmailSentAt) || !Number.isFinite(Date.parse(data.manualEmailSentAt)) || new Date(data.manualEmailSentAt).toISOString().slice(0, 19) !== data.manualEmailSentAt.slice(0, 19) || Date.parse(data.manualEmailSentAt) > this.clock().getTime() + 5 * 60_000)) throw new ProspectPricingError("Use a valid past UTC timestamp or leave the manual sent time empty.");
      next.manualEmailSentAt = data.manualEmailSentAt === null ? null : new Date(data.manualEmailSentAt as string).toISOString();
    }
    if (next.manualEmailStatus === "not_sent" && next.manualEmailSentAt) throw new ProspectPricingError("A not-sent row cannot have a manual sent time.");
    this.store.upsertDoc(COLLECTION, leadId, next);
    this.options.atlas.audit.record({ actor: "owner", action: "prospect.pricing.updated", business: "wulff_studio", targetType: "acquisition_lead", targetId: leadId, outcome: "completed", detail: { revision: next.revision, fields: Object.keys(data).filter(k => k !== "expectedRevision"), manualEmailStatus: next.manualEmailStatus } });
    return this.snapshot();
  }

  exportXlsx(day?: string, includeDrafts = false): Buffer { return createPricingWorkbook(this.sheets(this.snapshot(day), includeDrafts)); }
  exportCsv(day?: string): string {
    const snapshot = this.snapshot(day), sheets = this.sheets(snapshot, false);
    const pricing = sheets[0]!, prospects = sheets[1]!;
    return createPricingCsv({ name: "Pricing", headers: [...pricing.headers, ...prospects.headers.slice(1)], rows: pricing.rows.map((row, i) => [...row, ...prospects.rows[i]!.slice(1)]) });
  }

  private records(): AcquisitionRecord[] {
    return this.store.listDocs<AcquisitionRecord>(RECORDS, MAX_RECORDS).map(r => r.doc).filter(r => !r.archivedAt && (this.options.mode !== "live" || Boolean(this.options.atlas.prospects.get(r.prospectId) && !this.options.atlas.prospects.get(r.prospectId)!.fixture)));
  }
  private saved(id: string): StoredPrice | null { return this.store.getDoc<StoredPrice>(COLLECTION, id)?.doc ?? null; }
  private recommendation(record: AcquisitionRecord): StoredPrice {
    const services = recordedServices(record), count = services.length, proposedPages = count <= 4 ? 1 : count <= 8 ? 3 : 5;
    const prospect = this.options.atlas.prospects.get(record.prospectId), existing = prospect?.internalRecommendedPriceAud;
    const hasExisting = amount(existing), suggestedQuoteAud = hasExisting ? existing : proposedPages === 1 ? 699 : proposedPages === 3 ? 999 : 1499;
    const proposedScope = `${proposedPages === 1 ? "One responsive page" : `Up to ${proposedPages} responsive pages`} based on ${count} recorded service${count === 1 ? "" : "s"}${count ? ": " + services.join(", ") : "; service details still need confirmation"}. Proposed starting scope only; final content, page count and functionality need owner and client review. No booking, commerce or custom integrations are assumed.`;
    return { leadId: record.id, revision: 0, suggestedQuoteAud, quoteBasis: hasExisting ? "existing_internal_recommendation" : "services_heuristic", proposedPages, proposedScope, gstStatus: "unconfirmed", exclusions: [...EXCLUSIONS], manualEmailStatus: "not_sent", manualEmailSentAt: null, notes: "", sourceFingerprint: JSON.stringify([services, hasExisting ? existing : null]), createdAt: this.iso(), updatedAt: this.iso() };
  }
  private row(record: AcquisitionRecord, reportDays: string[], now: Date): ProspectPricingRow {
    const prospect = this.options.atlas.prospects.get(record.prospectId), days = [...new Set([recordDay(record.createdAt, now), ...reportDays])].sort();
    const price = this.saved(record.id) ?? this.recommendation(record), { leadId: _id, sourceFingerprint: _fingerprint, createdAt: _created, ...publicPrice } = price;
    const presence = classifyWebsitePresence({ websites: [record.website, prospect?.website], evidence: prospect?.evidence ?? [] });
    const qualification = this.store.getMemory<NoWebsiteQualification>(noWebsiteQualificationKey(record.id));
    const reviewedAbsence = presence !== "own_site" && qualification?.noIndependentWebsiteFound === true && qualification.sourceUrl === record.sourceUrl && qualification.sourceUrl === record.contact?.sourceUrl && qualification.email === record.contact?.email;
    const source = publicUrl(record.contact?.sourceUrl ?? record.businessProfile?.contactSourceUrl);
    const candidateEmail = source ? email(record.contact?.email ?? record.businessProfile?.contactEmail) : null;
    const previewPath = record.demo ? `/api/acquisition/demos/${encodeURIComponent(record.demo.id)}/preview` : null;
    const sourcePath = record.demo ? `/api/acquisition/leads/${encodeURIComponent(record.id)}/source.zip` : null;
    return { leadId: record.id, prospectId: record.prospectId, businessName: text(record.businessName, 200), location: text(record.location, 200), industry: text(record.industry, 150), createdAt: record.createdAt,
      discoveryDay: days[days.length - 1]!, discoveryDays: days, services: recordedServices(record), website: publicUrl(record.website), websiteStatus: presence, noWebsite: presence === "social_only" || presence === "not_recorded" || reviewedAbsence, sourceUrl: publicUrl(record.sourceUrl) ?? "", observation: text(record.observation, 2000),
      contactEmail: candidateEmail, contactSourceUrl: candidateEmail ? source : null, contactReviewRequired: !record.contact?.reviewedAt || record.contact.basis === "none_established" || !record.contact.roleRelevant || !record.contact.noMarketingProhibition,
      businessPhone: text(record.businessProfile?.phone, 100) || null, address: text(record.businessProfile?.address, 500) || null,
      demoReady: Boolean(record.demo), previewPath, previewUrl: this.link(previewPath), sourcePath, sourceDownloadUrl: this.link(sourcePath), reviewPath: `/#pipeline?review=${encodeURIComponent(record.id)}`,
      draft: record.draft ? { from: record.draft.from, to: record.draft.to, subject: record.draft.subject, text: record.draft.text, status: record.draft.status } : null, price: publicPrice };
  }
  private discoveryDays(): Map<string, string[]> {
    const byLead = new Map<string, string[]>();
    const reports = this.store.listDocs<{ day?: string; businesses?: Array<{ leadId?: string }> }>("discovery_program_reports", 1000);
    for (const { doc } of reports) {
      let day: string | undefined; try { day = validDay(doc.day); } catch { continue; } if (!day || !Array.isArray(doc.businesses)) continue;
      for (const business of doc.businesses) if (typeof business.leadId === "string") byLead.set(business.leadId, [...(byLead.get(business.leadId) ?? []), day]);
    }
    return byLead;
  }
  private sender(): AcquisitionSenderInput & { ownerPhone: string } {
    const saved = this.store.getMemory<Partial<AcquisitionSenderInput> & { ownerPhone?: string; phone?: string }>("acquisition.sender") ?? {};
    const contactDetails = text(saved.contactDetails, 4000), direct = text(saved.ownerPhone ?? saved.phone, 80);
    const extracted = /(?:\+61[\s().-]*|0)[23478](?:[\s().-]*\d){8}(?!\d)/.exec(contactDetails)?.[0] ?? "";
    return { name: text(saved.name, 200), organisation: text(saved.organisation, 200), email: email(saved.email) ?? "", contactDetails, ownerPhone: direct || extracted };
  }
  private sheets(snapshot: ProspectPricingSnapshot, includeDrafts: boolean): SpreadsheetSheet[] {
    const rows = snapshot.rows;
    const pricing: SpreadsheetSheet = { name: "Pricing", headers: ["Business", "Lead ID", "Melbourne discovery day", "Suggested quote AUD", "Basis", "Proposed pages", "Proposed scope", "GST status", "Excluded costs", "Manual email status", "Manual sent at UTC", "Owner notes", "Revision", "Pricing updated UTC"], moneyColumns: [3], rows: rows.map(r => [r.businessName, r.leadId, r.discoveryDay, r.price.suggestedQuoteAud, r.price.quoteBasis, r.price.proposedPages, r.price.proposedScope, "Unconfirmed; internal estimate only", r.price.exclusions.join("; "), r.price.manualEmailStatus, r.price.manualEmailSentAt, r.price.notes, r.price.revision, r.price.updatedAt]) };
    const prospects: SpreadsheetSheet = { name: "Prospects", headers: ["Business", "Location", "Industry", "Services recorded", "Public email candidate", "Contact source", "Contact review required", "Public business phone", "Address", "Recorded website", "Website evidence status", "Research source", "Research observation", "Private demo review", "Private source ZIP", "Jarvis review", "Discovery days", "Jarvis draft submission status"], rows: rows.map(r => [r.businessName, r.location, r.industry, r.services.join("; "), r.contactEmail, r.contactSourceUrl, r.contactReviewRequired ? "Yes; no permission inferred" : "Owner-reviewed; verify before contact", r.businessPhone, r.address, r.website, r.websiteStatus, r.sourceUrl, r.observation, r.previewUrl ?? r.previewPath, r.sourceDownloadUrl ?? r.sourcePath, this.link(r.reviewPath) ?? r.reviewPath, r.discoveryDays.join("; "), r.draft?.status ?? "No draft"]) };
    const sheets = [pricing, prospects];
    if (includeDrafts) sheets.push({ name: "Email drafts", headers: ["Business", "Lead ID", "From", "To", "Subject", "Draft text unchanged", "Provider submission status", "Manual email status", "Sender phone from private settings"], rows: rows.map(r => [r.businessName, r.leadId, r.draft?.from ?? "", r.draft?.to ?? "", r.draft?.subject ?? "", r.draft?.text ?? "", r.draft?.status ?? "No draft", r.price.manualEmailStatus, snapshot.sender.ownerPhone]) });
    return sheets;
  }
  private link(path: string | null): string | null { return path && this.publicOrigin ? this.publicOrigin + path : null; }
  private iso() { return this.clock().toISOString(); }
}

/** Install after the shared owner-session/Origin middleware. No public token route is registered. */
export function installProspectPricingRoutes(app: Hono, service: ProspectPricing): void {
  const fail = (c: Context, error: unknown) => error instanceof ProspectPricingError ? c.json({ error: error.message }, error.status) : error instanceof SyntaxError ? c.json({ error: "Provide a valid JSON pricing update." }, 400) : c.json({ error: "The private spreadsheet could not be prepared. Try a single Melbourne day or refresh the current row." }, 503);
  const headers = (c: Context) => { c.header("Cache-Control", "no-store"); c.header("X-Robots-Tag", "noindex, nofollow, noarchive"); c.header("Referrer-Policy", "no-referrer"); c.header("X-Content-Type-Options", "nosniff"); };
  app.get("/api/prospect-pricing", c => { try { headers(c); return c.json(service.snapshot(c.req.query("day"))); } catch (e) { return fail(c, e); } });
  app.post("/api/prospect-pricing/leads/:id", async c => { try { headers(c); return c.json(service.update(c.req.param("id"), await c.req.json())); } catch (e) { return fail(c, e); } });
  app.get("/api/prospect-pricing/export.xlsx", c => { try { headers(c); const day = validDay(c.req.query("day")), drafts = c.req.query("includeDrafts"); if (drafts !== undefined && drafts !== "0" && drafts !== "1") throw new ProspectPricingError("Use includeDrafts=1 to add the separate email drafts sheet."); const bytes = service.exportXlsx(day, drafts === "1"); c.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); c.header("Content-Disposition", `attachment; filename="jarvis-prospect-pricing-${day ?? "all"}.xlsx"`); return c.body(new Uint8Array(bytes)); } catch (e) { return fail(c, e); } });
  app.get("/api/prospect-pricing/export.csv", c => { try { headers(c); const day = validDay(c.req.query("day")); c.header("Content-Type", "text/csv; charset=utf-8"); c.header("Content-Disposition", `attachment; filename="jarvis-prospect-pricing-${day ?? "all"}.csv"`); return c.body(service.exportCsv(day)); } catch (e) { return fail(c, e); } });
}

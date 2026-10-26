import { createHash, randomBytes } from "node:crypto";
import type { Atlas } from "../orchestrator.js";
import type { Prospect } from "../wulff/prospects.js";
import { contentHash, newId } from "../ids.js";
import { renderDemoWebsite, safeDemoWebsite } from "./demo-renderer.js";
import { DEMO_TEMPLATES, getDemoTemplate, type DemoTemplateId } from "./templates.js";

export interface AcquisitionMailTransport {
  status(): Promise<{ state: "connected" | "not_connected" | "error" | "fake"; provider: string; detail: string; sender?: string }>;
  send(input: { from: string; to: string; subject: string; text: string; approvalId: string; idempotencyKey: string; unsubscribeUrl: string }): Promise<{ providerRef: string; acceptedAt: string }>;
}
export interface AcquisitionOptions {
  publicOrigin?: string;
  mode: "live" | "fake";
  mailer: AcquisitionMailTransport;
  fromAddress?: string;
  senderName?: string;
  organisation?: string;
  contactDetails?: string;
  maxSendsPerDay?: number;
  clock?: () => Date;
}
export interface AcquisitionContactInput {
  email: string;
  sourceUrl: string;
  basis: "none_established" | "express_consent" | "existing_relationship" | "inferred_consent_business";
  evidence: string;
  roleRelevant: boolean;
  noMarketingProhibition: boolean;
}
export interface AcquisitionContact extends AcquisitionContactInput { reviewedBy?: string; reviewedAt?: string }
export interface AcquisitionSenderInput { name: string; organisation: string; email: string; contactDetails: string }
export interface AddAcquisitionLeadInput { businessName: string; location: string; industry: string; website?: string | null; sourceUrl: string; observation: string; services?: string[]; contactEmail?: string; contactSourceUrl?: string }
export type AcquisitionDraftStatus = "draft" | "blocked" | "awaiting_approval" | "queued" | "submitting" | "accepted" | "failed" | "uncertain" | "cancelled" | "simulated";
export interface AcquisitionRecord {
  id: string; prospectId: string; businessName: string; location: string; industry: string; website: string | null; sourceUrl: string; observation: string; services: string[]; createdAt: string; updatedAt: string;
  /** Internal archive metadata is retained for audit; archived leads are excluded from normal snapshots. */
  archivedAt?: string;
  archiveReason?: string;
  contact: AcquisitionContact | null;
  demo: { id: string; templateId: DemoTemplateId; templateName: string; htmlHash: string; previewPath: string; publicPath: string | null; publishedAt?: string; expiresAt: string } | null;
  draft: { id: string; version: number; from: string; to: string; subject: string; text: string; contentHash: string; status: AcquisitionDraftStatus; blockers: string[]; approvalId?: string; providerRef?: string; acceptedAt?: string } | null;
}
export interface AcquisitionSnapshot {
  mode: "live" | "fake";
  templates: typeof DEMO_TEMPLATES;
  discovery: { state: "connected" | "not_connected" | "error" | "fake"; provider: string; detail: string };
  email: { state: "connected" | "not_connected" | "error" | "fake"; provider: string; detail: string };
  sender: AcquisitionSenderInput & { ready: boolean; detail: string };
  records: AcquisitionRecord[];
}
interface InternalDemo { id: string; leadId: string; html: string; csp: string; htmlHash: string; publicTokenHash: string; publicPath: string; expiresAt: string; publishedAt?: string; revokedAt?: string }
interface UnsubscribeRecord { tokenHash: string; emailHash: string; leadId: string }
interface PrivateLead { unsubscribeToken: string; unsubscribeEmail: string }
interface SendPayload { leadId: string; expectedHash: string; day: string }
interface SendAttempt { id: string; leadId: string; draftId: string; emailHash: string; businessId: string; day: string; reservedAt: string; state: "submitting" | "accepted" | "uncertain"; providerRef?: string }
const RECORDS = "acquisition_records", DEMOS = "acquisition_demos", TOKENS = "acquisition_demo_tokens", PRIVATE = "acquisition_private", UNSUB = "acquisition_unsubscribe", SUPPRESSED = "acquisition_suppressions", ATTEMPTS = "acquisition_attempts", RESERVED = "acquisition_reservations";
const SEND_JOB = "acquisition_outreach_send";
const TERMINAL = new Set<AcquisitionDraftStatus>(["accepted", "uncertain", "simulated"]);
const ELIGIBILITY = new Set(["none_established", "express_consent", "existing_relationship", "inferred_consent_business"]);

export class AcquisitionError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 503 = 409) { super(message); this.name = "AcquisitionError"; }
}

/** Private preparation is independent of transport readiness. Only explicit exact-version actions publish or send. */
export class AcquisitionService {
  private readonly store;
  private readonly clock: () => Date;
  private readonly origin: string;
  private readonly dailyLimit: number;
  private readonly approving = new Set<string>();

  constructor(private readonly atlas: Atlas, private readonly options: AcquisitionOptions) {
    this.store = atlas.deps.store;
    this.clock = options.clock ?? atlas.clock;
    this.origin = validOrigin(options.publicOrigin, options.mode);
    const limit = options.maxSendsPerDay ?? 5;
    if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new AcquisitionError("Daily outreach limit must be from one to five.", 400);
    this.dailyLimit = limit;
    this.atlas.jobs.register<SendPayload, { status: AcquisitionDraftStatus; providerRef?: string }>(SEND_JOB, async (payload) => this.executeSend(payload));
    // A process interrupted after reserving an attempt must not resubmit that email after restart.
    for (const row of this.store.listDocs<AcquisitionRecord>(RECORDS)) {
      const record = row.doc;
      if (record.draft?.status === "submitting") { record.draft.status = "uncertain"; record.draft.blockers = ["A previous submission was interrupted. Check the provider before any further contact; it will not be retried automatically."]; this.save(record); }
    }
  }

  async snapshot(): Promise<AcquisitionSnapshot> {
    const email = await this.mailStatus();
    const sender = this.senderStatus(email);
    const lookup = this.atlas.deps.lookup;
    const source = this.atlas.deps.research as unknown as { status?: () => Promise<{ state: AcquisitionSnapshot["discovery"]["state"]; name?: string; provider?: string; detail: string }> };
    let discovery: AcquisitionSnapshot["discovery"] = { state: this.options.mode === "fake" ? "fake" : "not_connected", provider: "Business discovery", detail: "Discovery has not yet verified a search connection." };
    try { const result = lookup ? await lookup.status() : source.status ? await source.status() : null; if (result) discovery = { state: result.state, provider: "provider" in result && typeof result.provider === "string" ? result.provider : result.name ?? "Business discovery", detail: result.detail }; }
    catch { discovery = { state: "error", provider: "Business discovery", detail: "Discovery connection could not be checked." }; }
    const records = this.records().map(record => {
      if (record.draft && !TERMINAL.has(record.draft.status) && !["queued", "submitting", "cancelled"].includes(record.draft.status)) {
        record.draft.blockers = this.blockers(record, email, sender);
        record.draft.status = record.draft.blockers.length ? "blocked" : "draft";
      }
      return record;
    });
    return { mode: this.options.mode, templates: DEMO_TEMPLATES, discovery, email, sender, records };
  }

  async discover(input: { area: string; industry?: string; count: number }): Promise<AcquisitionRecord[]> {
    const area = required(input.area, "Area", 160);
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > 5) throw new AcquisitionError("Discover one to five companies at a time.", 400);
    const prospects = await this.atlas.researchProspects({ area, count: input.count, ...(input.industry ? { industries: [required(input.industry, "Industry", 100)] } : {}) });
    return prospects.slice(0, input.count).map(prospect => this.importProspect(prospect)).filter(record => !record.archivedAt).map(record => record.demo && record.draft ? record : this.prepare(record.id));
  }

  addLead(input: AddAcquisitionLeadInput): AcquisitionRecord {
    const businessName = required(input.businessName, "Business name", 160), location = required(input.location, "Location", 160), industry = required(input.industry, "Industry", 120);
    const sourceUrl = sourceUrlValue(input.sourceUrl, this.options.mode), observation = required(input.observation, "Source observation", 1800);
    const website = input.website ? sourceUrlValue(input.website, this.options.mode) : null;
    const services = servicesValue(input.services ?? []);
    const { prospect } = this.atlas.prospects.upsert({ businessName, location, industry, website, commercialOpportunity: "Independent website concept prepared from the recorded public source; commercial interest is unverified.", recommendedScope: "Independent website concept for owner review.", internalRecommendedPriceAud: null, evidence: [{ id: newId("evd"), reviewedAt: this.iso(), observation, sourceUrl, method: "manual", status: "unverified", uncertainty: "Source-backed research is not contact permission or proof of purchase intent." }], fixture: this.options.mode === "fake" });
    const existing = this.records(true).find(record => record.prospectId === prospect.id);
    if (existing?.archivedAt) throw new AcquisitionError("This lead is archived and cannot be imported again without an explicit restore.");
    if (existing) return existing;
    const record: AcquisitionRecord = { id: newId("acq"), prospectId: prospect.id, businessName, location, industry, website, sourceUrl, observation, services, createdAt: this.iso(), updatedAt: this.iso(), contact: null, demo: null, draft: null };
    if (input.contactEmail) record.contact = { email: emailValue(input.contactEmail, this.options.mode), sourceUrl: sourceUrlValue(input.contactSourceUrl ?? input.sourceUrl, this.options.mode), basis: "none_established", evidence: "", roleRelevant: false, noMarketingProhibition: false };
    this.save(record);
    return record;
  }

  prepare(leadId: string, options: { templateId?: string } = {}): AcquisitionRecord {
    const record = this.require(leadId);
    this.assertEditable(record);
    if (options.templateId !== undefined) getDemoTemplate(options.templateId as DemoTemplateId);
    const prospect = this.atlas.prospects.require(record.prospectId);
    let website: string | null = null;
    try { website = safeDemoWebsite(record.website); } catch { /* Preserve legacy/fixture sources as evidence, never as unsafe public links. */ }
    const rendered = renderDemoWebsite({ businessName: record.businessName, location: record.location, industry: record.industry, services: record.services, website, contactEmail: record.contact?.email, templateId: options.templateId as DemoTemplateId | undefined, fixture: Boolean(prospect.fixture) });
    const id = newId("demo"), rawToken = token(), expiresAt = new Date(this.clock().getTime() + 14 * 86_400_000).toISOString();
    const internal: InternalDemo = { id, leadId, html: rendered.html, csp: rendered.contentSecurityPolicy, htmlHash: sha(rendered.html), publicTokenHash: sha(rawToken), publicPath: `/demos/${rawToken}`, expiresAt };
    this.store.upsertDoc(DEMOS, id, internal);
    this.store.upsertDoc(TOKENS, internal.publicTokenHash, { demoId: id });
    record.demo = { id, templateId: rendered.templateId, templateName: rendered.templateName, htmlHash: internal.htmlHash, previewPath: `/api/acquisition/demos/${id}/preview`, publicPath: null, expiresAt };
    this.compose(record);
    this.atlas.audit.record({ actor: "agent:design", action: "acquisition.demo.prepared", business: "wulff_studio", targetType: "acquisition", targetId: record.id, outcome: "completed", detail: { demoId: id, htmlHash: internal.htmlHash, templateId: rendered.templateId } });
    return record;
  }

  saveContact(leadId: string, input: AcquisitionContactInput, ownerName: string): AcquisitionRecord {
    const record = this.require(leadId); this.assertEditable(record);
    if (!ELIGIBILITY.has(input.basis) || typeof input.roleRelevant !== "boolean" || typeof input.noMarketingProhibition !== "boolean") throw new AcquisitionError("Provide an explicit contact eligibility determination.", 400);
    record.contact = { email: emailValue(input.email, this.options.mode), sourceUrl: sourceUrlValue(input.sourceUrl, this.options.mode), basis: input.basis, evidence: optionalText(input.evidence, "Contact evidence", 2000), roleRelevant: input.roleRelevant, noMarketingProhibition: input.noMarketingProhibition, reviewedBy: required(ownerName, "Owner name", 120), reviewedAt: this.iso() };
    this.atlas.deps.store.setMemory(`prospect.contact.${record.prospectId}`, { email: record.contact.email });
    if (record.demo) this.compose(record); else this.save(record);
    this.atlas.audit.record({ actor: "owner", action: "acquisition.contact.reviewed", business: "wulff_studio", targetType: "acquisition", targetId: record.id, outcome: "completed", detail: { basis: record.contact.basis, sourceUrl: record.contact.sourceUrl } });
    return record;
  }

  saveSender(input: AcquisitionSenderInput, ownerName: string): AcquisitionSenderInput {
    required(ownerName, "Owner name", 120);
    const sender = { name: required(input.name, "Sender name", 120), organisation: required(input.organisation, "Organisation", 160), email: emailValue(input.email, this.options.mode), contactDetails: required(input.contactDetails, "Sender contact details", 500) };
    this.store.setMemory("acquisition.sender", sender);
    for (const record of this.records()) if (record.demo && record.draft && !TERMINAL.has(record.draft.status) && record.draft.status !== "submitting") this.compose(record);
    this.atlas.audit.record({ actor: "owner", action: "acquisition.sender.saved", business: "wulff_studio", outcome: "completed", detail: { email: sender.email } });
    return sender;
  }

  saveDraft(leadId: string, input: { subject: string; text: string; expectedHash: string }): AcquisitionRecord {
    const record = this.require(leadId); this.assertEditable(record); this.assertHash(record, input.expectedHash);
    const draft = record.draft!, internal = this.internal(record), sender = this.sender();
    const subject = required(input.subject, "Email subject", 180), text = requiredBody(input.text, 9000);
    const unsubscribeUrl = this.unsubscribeUrl(record), demoUrl = this.url(internal.publicPath);
    if (![demoUrl, unsubscribeUrl, sender.name, sender.organisation, sender.contactDetails].every(value => value && text.includes(value))) throw new AcquisitionError("Keep the exact demo link, unsubscribe link and sender identity/contact details in the email.", 400);
    draft.subject = subject; draft.text = text; draft.version += 1; draft.status = "draft"; draft.blockers = []; delete draft.approvalId;
    delete draft.providerRef; delete draft.acceptedAt;
    draft.contentHash = contentHash(this.payload(record));
    this.save(record);
    return record;
  }

  async approveAndSend(leadId: string, expectedHash: string, ownerName: string): Promise<AcquisitionRecord> {
    const record = this.require(leadId); this.assertHash(record, expectedHash);
    if (this.approving.has(leadId) || ["queued", "submitting", ...TERMINAL].includes(record.draft!.status)) return record;
    this.approving.add(leadId);
    try {
      const email = await this.mailStatus();
      const current = this.require(leadId); this.assertHash(current, expectedHash);
      const blockers = this.blockers(current, email, this.senderStatus(email));
      if (blockers.length) { current.draft!.status = "blocked"; current.draft!.blockers = blockers; this.save(current); throw new AcquisitionError(blockers.join(" "), 409); }
      const by = required(ownerName, "Owner name", 120), payload = this.payload(current);
      const approval = this.atlas.approvals.request({ action: "approve.outreach_campaign", business: "wulff_studio", subject: `acquisition:${current.id}`, title: `Publish concept and email ${current.businessName}`, summary: "Publish this independent concept for up to fourteen days and send this exact initial email once.", card: { lines: [{ label: "To", value: current.draft!.to }, { label: "From", value: current.draft!.from }, { label: "Subject", value: current.draft!.subject }, { label: "Message", value: current.draft!.text }, { label: "Demo", value: `${current.demo!.templateName} · ${current.demo!.htmlHash}` }, { label: "Eligibility", value: current.contact!.evidence }], actions: ["approve", "reject"], risk: "One initial commercial email and publication of an unofficial website concept. Acceptance is not delivery." }, payload });
      this.atlas.approvals.decide(approval.id, "approve", by, "Owner explicitly selected Approve & send this version for this exact message and demo.");
      current.draft!.approvalId = approval.id; current.draft!.status = "queued"; current.draft!.blockers = []; this.save(current);
      this.atlas.jobs.enqueue(SEND_JOB, { leadId, expectedHash, day: day(this.clock()) }, { idempotencyKey: `acquisition:${current.draft!.id}:${expectedHash}`, maxAttempts: 1, runAfter: this.clock() });
      await this.atlas.jobs.runOnce(20, this.clock());
      return this.require(leadId);
    } finally { this.approving.delete(leadId); }
  }

  publish(leadId: string, expectedHtmlHash: string, ownerName: string): AcquisitionRecord {
    const record = this.require(leadId), demo = this.internal(record);
    if (demo.htmlHash !== expectedHtmlHash || sha(demo.html) !== expectedHtmlHash) throw new AcquisitionError("The demo changed. Review its current version before publishing.");
    this.assertPublishable(record, demo);
    if (!demo.publishedAt) {
      const payload = { leadId, demoId: demo.id, htmlHash: demo.htmlHash, publicUrl: this.url(demo.publicPath), expiresAt: demo.expiresAt, unofficial: true };
      const approval = this.atlas.approvals.request({ action: "approve.production_deploy", business: "wulff_studio", subject: `acquisition-publish:${demo.id}`, title: `Publish independent concept for ${record.businessName}`, summary: "Publish the exact reviewed static concept; no email is sent.", card: { lines: [{ label: "Business", value: record.businessName }, { label: "Demo hash", value: demo.htmlHash }, { label: "Expires", value: demo.expiresAt }], actions: ["approve", "reject"] }, payload });
      this.atlas.approvals.decide(approval.id, "approve", required(ownerName, "Owner name", 120));
      this.atlas.approvals.consume(`acquisition-publish:${demo.id}`, payload);
      this.activate(record, demo);
    }
    return record;
  }

  revoke(leadId: string): void {
    const record = this.require(leadId);
    for (const row of this.store.listDocs<InternalDemo>(DEMOS)) if (row.doc.leadId === leadId) { row.doc.revokedAt = this.iso(); this.store.upsertDoc(DEMOS, row.id, row.doc); }
    if (record.demo) record.demo.publicPath = null;
    if (record.draft && !TERMINAL.has(record.draft.status) && record.draft.status !== "submitting") { record.draft.status = "cancelled"; record.draft.blockers = ["The owner revoked this concept."]; }
    this.save(record);
  }

  archive(leadId: string, reason: string, ownerName: string): void {
    const record = this.require(leadId, true);
    const archiveReason = required(reason, "Archive reason", 600), by = required(ownerName, "Owner name", 120);
    if (record.archivedAt) return;
    this.revoke(leadId);
    const archived = this.require(leadId, true);
    archived.archivedAt = this.iso(); archived.archiveReason = archiveReason;
    if (archived.draft && !TERMINAL.has(archived.draft.status) && archived.draft.status !== "submitting") { archived.draft.status = "cancelled"; archived.draft.blockers = ["This lead was archived."]; }
    this.save(archived);
    this.atlas.audit.record({ actor: "owner", action: "acquisition.lead.archived", business: "wulff_studio", targetType: "acquisition", targetId: leadId, outcome: "completed", detail: { reason: archiveReason, by } });
  }

  ownerPreview(demoId: string): { html: string; csp: string } | null { const demo = this.store.getDoc<InternalDemo>(DEMOS, demoId)?.doc; const lead = demo ? this.store.getDoc<AcquisitionRecord>(RECORDS, demo.leadId)?.doc : null; return demo && lead && !lead.archivedAt ? { html: demo.html, csp: demo.csp } : null; }
  publicPreview(rawToken: string): { html: string; csp: string } | null {
    if (!validToken(rawToken)) return null;
    const pointer = this.store.getDoc<{ demoId: string }>(TOKENS, sha(rawToken))?.doc;
    const demo = pointer ? this.store.getDoc<InternalDemo>(DEMOS, pointer.demoId)?.doc : null;
    return demo?.publishedAt && !demo.revokedAt && new Date(demo.expiresAt).getTime() > this.clock().getTime() && sha(demo.html) === demo.htmlHash ? { html: demo.html, csp: demo.csp } : null;
  }
  unsubscribePreview(rawToken: string): { alreadySuppressed: boolean } | null {
    if (!validToken(rawToken)) return null;
    const record = this.store.getDoc<UnsubscribeRecord>(UNSUB, sha(rawToken))?.doc;
    return record ? { alreadySuppressed: Boolean(this.store.getDoc(SUPPRESSED, record.emailHash)) } : null;
  }
  unsubscribe(rawToken: string): boolean {
    if (!validToken(rawToken)) return false;
    const tokenRecord = this.store.getDoc<UnsubscribeRecord>(UNSUB, sha(rawToken))?.doc;
    if (!tokenRecord) return false;
    this.store.upsertDoc(SUPPRESSED, tokenRecord.emailHash, { at: this.iso(), source: "unsubscribe_link" });
    for (const record of this.records(true)) if (record.contact && sha(record.contact.email.toLowerCase()) === tokenRecord.emailHash) { this.atlas.prospects.suppress(record.prospectId, "Unsubscribed using the outreach email link."); if (record.draft && !TERMINAL.has(record.draft.status) && record.draft.status !== "submitting") { record.draft.status = "cancelled"; record.draft.blockers = ["This recipient unsubscribed."]; this.save(record); } }
    return true;
  }

  private async executeSend(job: SendPayload): Promise<{ status: AcquisitionDraftStatus; providerRef?: string }> {
    let record = this.require(job.leadId, true);
    if (record.archivedAt) return { status: "cancelled" };
    if (!record.draft || record.draft.status !== "queued") return { status: record.draft?.status ?? "cancelled" };
    if (record.draft.contentHash !== job.expectedHash) return { status: record.draft.status };
    try {
      this.assertHash(record, job.expectedHash);
      if (job.day !== day(this.clock())) throw new AcquisitionError("This queued message expired. Review a new version before sending.");
      const email = await this.mailStatus(); record = this.require(job.leadId, true);
      if (record.archivedAt) return { status: "cancelled" };
      if (!record.draft || record.draft.contentHash !== job.expectedHash || record.draft.status !== "queued") return { status: record.draft?.status ?? "cancelled" };
      this.assertHash(record, job.expectedHash);
      if (job.day !== day(this.clock())) throw new AcquisitionError("This queued message expired. Review a new version before sending.");
      const blockers = this.blockers(record, email, this.senderStatus(email));
      if (blockers.length) throw new AcquisitionError(blockers.join(" "));
      const demo = this.internal(record); this.assertPublishable(record, demo);
      const payload = this.payload(record);
      const approval = this.atlas.approvals.consume(`acquisition:${record.id}`, payload);
      const emailHash = sha(record.draft!.to.toLowerCase());
      const attempt: SendAttempt = { id: newId("outreach"), leadId: record.id, draftId: record.draft!.id, emailHash, businessId: record.prospectId, day: job.day, reservedAt: this.iso(), state: "submitting" };
      this.store.upsertDoc(ATTEMPTS, attempt.id, attempt);
      this.store.upsertDoc(RESERVED, `email:${emailHash}`, { attemptId: attempt.id });
      this.store.upsertDoc(RESERVED, `business:${record.prospectId}`, { attemptId: attempt.id });
      const key = `acquisition.quota.${job.day}`, count = this.store.getMemory<number>(key) ?? 0; this.store.setMemory(key, count + 1);
      record.draft!.status = "submitting"; this.save(record);
      this.activate(record, demo);
      try {
        const result = await this.options.mailer.send({ from: record.draft!.from, to: record.draft!.to, subject: record.draft!.subject, text: record.draft!.text, approvalId: approval.id, idempotencyKey: `outreach-${record.draft!.id}-${job.expectedHash}`, unsubscribeUrl: this.unsubscribeUrl(record) });
        if (!result.providerRef?.trim() || (this.options.mode === "live" && /^(?:fake|simulated|test)[_:-]/i.test(result.providerRef)) || !Number.isFinite(Date.parse(result.acceptedAt))) throw new Error("Invalid provider acknowledgement");
        record.draft!.status = this.options.mode === "fake" ? "simulated" : "accepted"; record.draft!.providerRef = result.providerRef; record.draft!.acceptedAt = result.acceptedAt; record.draft!.blockers = []; this.save(record);
        attempt.state = "accepted"; attempt.providerRef = result.providerRef; this.store.upsertDoc(ATTEMPTS, attempt.id, attempt);
        this.atlas.prospects.recordOutreach(record.prospectId, { at: result.acceptedAt, channel: "email", subject: record.draft!.subject, providerRef: result.providerRef, approvalId: approval.id });
        this.atlas.audit.record({ actor: "atlas", action: "acquisition.email.accepted", business: "wulff_studio", targetType: "acquisition", targetId: record.id, outcome: this.options.mode === "fake" ? "simulated" : "completed", detail: { providerRef: result.providerRef, approvalId: approval.id, draftHash: job.expectedHash } });
        return { status: record.draft!.status, providerRef: result.providerRef };
      } catch {
        record.draft!.status = "uncertain"; record.draft!.blockers = ["The provider did not return a verified acceptance record. Check its activity before any further contact. This message will not retry automatically."]; this.save(record);
        attempt.state = "uncertain"; this.store.upsertDoc(ATTEMPTS, attempt.id, attempt);
        return { status: "uncertain" };
      }
    } catch (error) {
      if (record.draft && record.draft.status !== "submitting" && record.draft.status !== "cancelled" && record.draft.contentHash === job.expectedHash) {
        record.draft.status = "blocked";
        record.draft.blockers = [error instanceof AcquisitionError ? error.message : "The exact approved message could not be verified. Review its current version."];
        // A preflight-only failure may be reconsidered by a new explicit owner action,
        // never by retrying this job/approval. Changing the version creates a fresh hash.
        record.draft.version += 1;
        record.draft.contentHash = contentHash(this.payload(record));
        delete record.draft.approvalId;
        this.save(record);
      }
      return { status: record.draft?.status ?? "blocked" };
    }
  }

  private importProspect(prospect: Prospect): AcquisitionRecord {
    const existing = this.records(true).find(record => record.prospectId === prospect.id); if (existing) return existing;
    const evidence = prospect.evidence[0];
    const record: AcquisitionRecord = { id: newId("acq"), prospectId: prospect.id, businessName: prospect.businessName.slice(0, 160), location: prospect.location.slice(0, 160), industry: prospect.industry.slice(0, 120), website: prospect.website, sourceUrl: evidence?.sourceUrl ?? prospect.website ?? "", observation: evidence?.observation ?? "Discovery candidate; identity and location require review.", services: [], createdAt: this.iso(), updatedAt: this.iso(), contact: null, demo: null, draft: null };
    const stored = this.store.getMemory<{ email?: string }>(`prospect.contact.${prospect.id}`);
    if (stored?.email) { try { record.contact = { email: emailValue(stored.email, this.options.mode), sourceUrl: record.sourceUrl, basis: "none_established", evidence: "", roleRelevant: false, noMarketingProhibition: false }; } catch { /* Invalid extracted addresses never become contacts. */ } }
    this.save(record); return record;
  }
  private compose(record: AcquisitionRecord): void {
    const sender = this.sender(), demo = this.internal(record), prior = record.draft;
    const to = record.contact?.email ?? ""; this.ensureUnsubscribe(record, to);
    const subject = `A website concept for ${record.businessName}`;
    const text = [`Hi ${record.businessName} team,`, "", `I’m ${sender.name || "Brandon"} from ${sender.organisation || "Wulff Studio"}. I came across your business while researching ${record.location}.`, `I put together an independent website concept showing a possible direction for your online presence:`, "", this.url(demo.publicPath), "", "It’s an unsolicited design concept, not your official website. If the direction interests you, you can reply and we can discuss what would be useful for your business. There’s no commitment.", "", sender.name, sender.organisation, sender.contactDetails, "", `Prefer no further contact? Unsubscribe here: ${this.unsubscribeUrl(record)}`].join("\n");
    record.draft = { id: prior?.id ?? newId("draft"), version: (prior?.version ?? 0) + 1, from: sender.email, to, subject, text, contentHash: "", status: "draft", blockers: [] };
    record.draft.contentHash = contentHash(this.payload(record)); this.save(record);
  }
  private payload(record: AcquisitionRecord) {
    const draft = record.draft; if (!draft) throw new AcquisitionError("Prepare a demo and email first.");
    const demo = this.internal(record);
    return { leadId: record.id, draftId: draft.id, version: draft.version, from: draft.from, to: draft.to, subject: draft.subject, text: draft.text, demoId: demo.id, demoHtmlHash: demo.htmlHash, publicUrl: this.url(demo.publicPath), expiresAt: demo.expiresAt, sender: this.sender(), contactEligibility: record.contact, unsubscribeUrl: this.unsubscribeUrl(record), oneInitialMessageOnly: true };
  }
  private blockers(record: AcquisitionRecord, email: Awaited<ReturnType<AcquisitionService["mailStatus"]>>, sender: AcquisitionSnapshot["sender"]): string[] {
    const blockers: string[] = [];
    if (!record.demo) blockers.push("Prepare a website concept first.");
    if (!this.origin) blockers.push("A public HTTPS Jarvis origin is needed for demo and unsubscribe links.");
    if (!sender.ready) blockers.push(sender.detail);
    const contact = record.contact;
    if (!contact?.email) blockers.push("Add a source-backed recipient email address.");
    else {
      if (contact.basis === "none_established" || !contact.reviewedBy || !contact.reviewedAt || contact.evidence.length < 12 || !contact.roleRelevant || !contact.noMarketingProhibition) blockers.push("Record the owner’s contact eligibility evidence and relevance determination before sending.");
      if (this.store.getDoc(SUPPRESSED, sha(contact.email.toLowerCase())) || this.atlas.prospects.require(record.prospectId).contactEligibility.suppressed) blockers.push("This recipient or business is suppressed from contact.");
      if (this.store.getDoc(RESERVED, `email:${sha(contact.email.toLowerCase())}`) || this.store.getDoc(RESERVED, `business:${record.prospectId}`)) blockers.push("An initial message has already been reserved for this recipient or business. Automatic follow-ups are disabled.");
    }
    if ((this.store.getMemory<number>(`acquisition.quota.${day(this.clock())}`) ?? 0) >= this.dailyLimit) blockers.push("The daily initial-email limit has been reached.");
    if (record.demo) { const demo = this.internal(record); if (demo.revokedAt || Date.parse(demo.expiresAt) <= this.clock().getTime()) blockers.push("This concept is revoked or expired. Prepare and review a new concept."); if (sha(demo.html) !== record.demo.htmlHash || demo.htmlHash !== record.demo.htmlHash) blockers.push("The concept content changed; review a new version."); }
    if (this.options.mode === "live" && this.atlas.prospects.require(record.prospectId).fixture) blockers.push("Fictional test records cannot be emailed through live transport.");
    if (record.draft && (record.draft.from !== sender.email || record.draft.to !== (contact?.email ?? ""))) blockers.push("Sender or recipient changed. Recompose and review this draft.");
    if (email.state === "error") blockers.push("The mail connection needs attention.");
    return [...new Set(blockers)];
  }
  private sender(): AcquisitionSenderInput {
    return this.store.getMemory<AcquisitionSenderInput>("acquisition.sender") ?? { name: this.options.senderName ?? this.atlas.deps.config.ownerName, organisation: this.options.organisation ?? "Wulff Studio", email: this.options.fromAddress ?? this.atlas.deps.config.businessFromAddress, contactDetails: this.options.contactDetails ?? "" };
  }
  private senderStatus(email: Awaited<ReturnType<AcquisitionService["mailStatus"]>>): AcquisitionSnapshot["sender"] {
    const sender = this.sender(); let valid = false;
    try { emailValue(sender.email, this.options.mode); valid = Boolean(sender.name.trim() && sender.organisation.trim() && sender.contactDetails.trim()); } catch { /* Incomplete identity remains a preparation-only workflow. */ }
    const authorised = Boolean(email.sender && email.sender.toLowerCase() === sender.email.toLowerCase());
    const available = email.state === "connected" || (this.options.mode === "fake" && email.state === "fake");
    return { ...sender, ready: valid && authorised && available, detail: !valid ? "Add the actual sender name, organisation, email and contact details." : !available ? "Connect an authorised mail account before sending. Private concepts and drafts still work." : !authorised ? "Sender email must match the connected mail account’s authorised address." : "Sender identity matches the connected mail account." };
  }
  private async mailStatus() {
    try {
      const status = await this.options.mailer.status();
      if (status.sender && (status.state === "connected" || (this.options.mode === "fake" && status.state === "fake"))) this.adoptVerifiedSender(status.sender);
      return status;
    }
    catch { return { state: "error" as const, provider: "Email", detail: "Mail connection could not be verified." }; }
  }
  private adoptVerifiedSender(rawEmail: string): void {
    let email: string; try { email = emailValue(rawEmail, this.options.mode); } catch { return; }
    const current = this.sender(); let currentValid = false;
    try { emailValue(current.email, this.options.mode); currentValid = true; } catch { /* Verified account can fill a blank or unusable placeholder. */ }
    const next = { ...current, email: currentValid ? current.email : email, contactDetails: current.contactDetails.trim() || email };
    if (next.email === current.email && next.contactDetails === current.contactDetails) return;
    this.store.setMemory("acquisition.sender", next);
    for (const record of this.records()) if (record.demo && record.draft && !TERMINAL.has(record.draft.status) && record.draft.status !== "submitting") this.compose(record);
  }
  private ensureUnsubscribe(record: AcquisitionRecord, email: string): void {
    const current = this.store.getDoc<PrivateLead>(PRIVATE, record.id)?.doc;
    if (current?.unsubscribeEmail === email) return;
    const raw = token(); this.store.upsertDoc(PRIVATE, record.id, { unsubscribeToken: raw, unsubscribeEmail: email });
    if (email) this.store.upsertDoc<UnsubscribeRecord>(UNSUB, sha(raw), { tokenHash: sha(raw), emailHash: sha(email.toLowerCase()), leadId: record.id });
  }
  private unsubscribeUrl(record: AcquisitionRecord): string { const current = this.store.getDoc<PrivateLead>(PRIVATE, record.id)?.doc; if (!current) throw new AcquisitionError("Prepare the email before requesting its unsubscribe link."); return this.url(`/unsubscribe/${current.unsubscribeToken}`); }
  private activate(record: AcquisitionRecord, demo: InternalDemo): void { if (!demo.publishedAt) demo.publishedAt = this.iso(); this.store.upsertDoc(DEMOS, demo.id, demo); record.demo!.publishedAt = demo.publishedAt; record.demo!.publicPath = demo.publicPath; this.save(record); }
  private assertPublishable(record: AcquisitionRecord, demo: InternalDemo): void { if (!this.origin) throw new AcquisitionError("Configure a public HTTPS Jarvis origin before publishing."); if (demo.revokedAt || Date.parse(demo.expiresAt) <= this.clock().getTime()) throw new AcquisitionError("This concept is revoked or expired."); if (sha(demo.html) !== demo.htmlHash || record.demo?.htmlHash !== demo.htmlHash) throw new AcquisitionError("Demo content changed. Review a new version."); if (this.options.mode === "live" && this.atlas.prospects.require(record.prospectId).fixture) throw new AcquisitionError("Fictional fixtures cannot be published as real company concepts."); }
  private assertHash(record: AcquisitionRecord, expected: string): void { if (!record.draft || typeof expected !== "string" || record.draft.contentHash !== expected || contentHash(this.payload(record)) !== expected) throw new AcquisitionError("This email version changed. Review the current email and demo before approving or editing."); }
  private assertEditable(record: AcquisitionRecord): void { if (record.draft?.status === "submitting" || record.draft?.status === "uncertain") throw new AcquisitionError("A submission is in progress or uncertain; check the provider before changing this record."); }
  private internal(record: AcquisitionRecord): InternalDemo { const demo = record.demo && this.store.getDoc<InternalDemo>(DEMOS, record.demo.id)?.doc; if (!demo) throw new AcquisitionError("Prepare a website concept first."); return demo; }
  private records(includeArchived = false): AcquisitionRecord[] { return this.store.listDocs<AcquisitionRecord>(RECORDS).map(row => row.doc).filter(record => includeArchived || !record.archivedAt); }
  private require(id: string, includeArchived = false): AcquisitionRecord { const record = this.store.getDoc<AcquisitionRecord>(RECORDS, id)?.doc; if (!record) throw new AcquisitionError("Acquisition record not found.", 404); if (record.archivedAt && !includeArchived) throw new AcquisitionError("This lead is archived and cannot be changed without an explicit restore."); return record; }
  private save(record: AcquisitionRecord): void { const existing = this.store.getDoc<AcquisitionRecord>(RECORDS, record.id)?.doc; if (existing?.archivedAt) { record.archivedAt = existing.archivedAt; record.archiveReason = existing.archiveReason; if (record.demo) record.demo.publicPath = null; } record.updatedAt = this.iso(); this.store.upsertDoc(RECORDS, record.id, record); }
  private iso(): string { return this.clock().toISOString(); }
  private url(path: string): string { return `${this.origin}${path}`; }
}

function sha(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function token(): string { return randomBytes(24).toString("base64url"); }
function validToken(value: string): boolean { return typeof value === "string" && /^[A-Za-z0-9_-]{32}$/.test(value); }
function day(value: Date): string { const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value); return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-"); }
function required(value: unknown, label: string, max: number): string { if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new AcquisitionError(`${label} is missing or invalid.`, 400); return value.trim(); }
function optionalText(value: unknown, label: string, max: number): string { if (value === "") return ""; return required(value, label, max); }
function requiredBody(value: unknown, max: number): string { if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new AcquisitionError("Email text is missing or invalid.", 400); return value.trim(); }
function emailValue(value: unknown, mode: "live" | "fake"): string { const email = required(value, "Email address", 254); if (!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(email)) throw new AcquisitionError("Provide one valid email address.", 400); const host = email.split("@")[1]!.toLowerCase(); if (mode === "live" && /(?:^|\.)(?:test|invalid|example|localhost|local|internal)$/.test(host)) throw new AcquisitionError("Test or private-domain email addresses cannot be used for live outreach.", 400); return email.toLowerCase(); }
function sourceUrlValue(value: unknown, mode: "live" | "fake"): string { const text = required(value, "Public source URL", 2048); try { const url = new URL(text); if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port || !url.hostname.includes(".") || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(":") || /(?:^|\.)(?:localhost|local|internal|invalid)$/.test(url.hostname) || (mode === "live" && /(?:^|\.)(?:test|example)$/.test(url.hostname))) throw new Error(); url.hash = ""; return url.toString(); } catch { throw new AcquisitionError("Use a public HTTP or HTTPS source URL without credentials or custom ports.", 400); } }
function servicesValue(value: unknown): string[] { if (!Array.isArray(value) || value.length > 8) throw new AcquisitionError("Provide at most eight source-backed services.", 400); return value.map(service => required(service, "Service", 100)); }
function validOrigin(value: string | undefined, mode: "live" | "fake"): string { if (!value) return ""; try { const url = new URL(value); const localFake = mode === "fake" && /^(?:localhost|127\.0\.0\.1)$/.test(url.hostname) && url.protocol === "http:"; const publicHost = url.hostname.includes(".") && !/^[\d.]+$/.test(url.hostname) && !url.hostname.includes(":") && !/(?:^|\.)(?:localhost|local|internal|invalid)$/.test(url.hostname) && (mode === "fake" || !/(?:^|\.)(?:test|example)$/.test(url.hostname)); if ((!localFake && (url.protocol !== "https:" || !publicHost || Boolean(url.port))) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return ""; return url.origin; } catch { return ""; } }

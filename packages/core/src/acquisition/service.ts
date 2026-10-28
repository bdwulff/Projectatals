import { createHash, randomBytes } from "node:crypto";
import type { Atlas } from "../orchestrator.js";
import type { Prospect } from "../wulff/prospects.js";
import { isCustomerStage } from "../wulff/pipeline.js";
import { contentHash, newId } from "../ids.js";
import { exportDemoReactProject, renderDemoWebsite, safeDemoWebsite, type RenderedDemoWebsite } from "./demo-renderer.js";
import { DEMO_TEMPLATES, getDemoTemplate, type DemoTemplateId } from "./templates.js";
import { businessProfileSummary, type BusinessImage, type BusinessProfile, type BusinessProfileEnricher, type BusinessProfileSummary } from "./business-profile.js";

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
  enricher?: BusinessProfileEnricher;
  /** Stable configured transport route, included in exact-version approvals. */
  mailProviderIdentity?: () => string;
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
export interface AddAcquisitionLeadInput { businessName: string; location: string; industry: string; website?: string | null; sourceUrl: string; observation: string; services?: string[]; contactEmail?: string; contactSourceUrl?: string; description?: string; address?: string; phone?: string }
export type AcquisitionDraftStatus = "draft" | "blocked" | "awaiting_approval" | "queued" | "submitting" | "accepted" | "failed" | "uncertain" | "cancelled" | "simulated";
export interface AcquisitionRecord {
  id: string; prospectId: string; businessName: string; location: string; industry: string; website: string | null; sourceUrl: string; observation: string; services: string[]; createdAt: string; updatedAt: string;
  /** Internal archive metadata is retained for audit; archived leads are excluded from normal snapshots. */
  archivedAt?: string;
  archiveReason?: string;
  businessProfile?: BusinessProfileSummary;
  contact: AcquisitionContact | null;
  demo: { id: string; templateId: DemoTemplateId; templateName: string; htmlHash: string; previewPath: string; publicPath: string | null; publishedAt?: string; expiresAt: string; designBrief?: RenderedDemoWebsite["designBrief"] } | null;
  draft: { id: string; version: number; from: string; to: string; subject: string; text: string; contentHash: string; status: AcquisitionDraftStatus; blockers: string[]; mailProviderIdentity?: string; approvalId?: string; providerRef?: string; acceptedAt?: string } | null;
}
export interface AcquisitionSnapshot {
  mode: "live" | "fake";
  templates: typeof DEMO_TEMPLATES;
  discovery: { state: "connected" | "not_connected" | "error" | "fake"; provider: string; detail: string };
  email: { state: "connected" | "not_connected" | "error" | "fake"; provider: string; detail: string };
  sender: AcquisitionSenderInput & { ready: boolean; detail: string };
  records: AcquisitionRecord[];
}
interface InternalDemo { id: string; leadId: string; html: string; csp: string; htmlHash: string; publicTokenHash: string; publicPath: string; expiresAt: string; publishedAt?: string; revokedAt?: string; sourceFiles?: Readonly<Record<string, string>> }
interface UnsubscribeRecord { tokenHash: string; emailHash: string; leadId: string }
interface PrivateLead { unsubscribeToken: string; unsubscribeEmail: string }
interface SendPayload { leadId: string; expectedHash: string; day: string }
interface SendAttempt { id: string; leadId: string; draftId: string; emailHash: string; businessId: string; day: string; reservedAt: string; state: "submitting" | "accepted" | "uncertain"; providerRef?: string }
interface Preparation { inputHash: string; demoId: string; previousDemoId: string | null; completed: boolean }
const RECORDS = "acquisition_records", DEMOS = "acquisition_demos", TOKENS = "acquisition_demo_tokens", PRIVATE = "acquisition_private", UNSUB = "acquisition_unsubscribe", SUPPRESSED = "acquisition_suppressions", ATTEMPTS = "acquisition_attempts", RESERVED = "acquisition_reservations";
const SEND_JOB = "acquisition_outreach_send";
const PROFILES = "acquisition_business_profiles";
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
        const provider = this.options.mailProviderIdentity?.() ?? "default";
        if (record.draft.mailProviderIdentity !== provider) {
          // Preserve the owner's edited message, but require review of a new delivery version.
          record.draft.mailProviderIdentity = provider;
          record.draft.version += 1;
          delete record.draft.approvalId;
          record.draft.contentHash = contentHash(this.payload(record));
          this.save(record);
        }
        record.draft.blockers = this.blockers(record, email, sender);
        record.draft.status = record.draft.blockers.length ? "blocked" : "draft";
      }
      return record;
    });
    return { mode: this.options.mode, templates: DEMO_TEMPLATES, discovery, email, sender, records };
  }

  async discover(input: { area: string; industry?: string; count: number; templateId?: string }): Promise<AcquisitionRecord[]> {
    const area = required(input.area, "Area", 160);
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > 5) throw new AcquisitionError("Discover one to five companies at a time.", 400);
    if (input.templateId !== undefined) getDemoTemplate(input.templateId as DemoTemplateId);
    const prospects = await this.atlas.researchProspects({ area, count: input.count, ...(input.industry ? { industries: [required(input.industry, "Industry", 100)] } : {}) });
    const records = prospects.slice(0, input.count).map(prospect => this.importProspect(prospect)).filter(record => !record.archivedAt);
    const prepared: AcquisitionRecord[] = [];
    for (const record of records) prepared.push(record.demo && record.draft && (!input.templateId || record.demo.templateId === input.templateId) ? record : await this.enrichAndPrepare(record.id, { templateId: input.templateId }));
    return prepared;
  }

  addLead(input: AddAcquisitionLeadInput): AcquisitionRecord {
    const businessName = required(input.businessName, "Business name", 160), location = required(input.location, "Location", 160), industry = required(input.industry, "Industry", 120);
    const sourceUrl = sourceUrlValue(input.sourceUrl, this.options.mode), observation = required(input.observation, "Source observation", 1800);
    const website = input.website ? sourceUrlValue(input.website, this.options.mode) : null;
    const services = servicesValue(input.services ?? []);
    const description = input.description === undefined ? undefined : required(input.description, "Sourced business description", 900);
    const address = input.address === undefined ? undefined : required(input.address, "Sourced business address", 320);
    const phone = input.phone === undefined ? undefined : required(input.phone, "Sourced business phone", 32);
    if (phone && (!/^\+?[\d() .-]{6,32}$/.test(phone) || phone.replace(/\D/g, "").length < 6 || phone.replace(/\D/g, "").length > 15)) throw new AcquisitionError("Provide one factual business phone number from the recorded source.", 400);
    const { prospect } = this.atlas.prospects.upsert({ businessName, location, industry, website, commercialOpportunity: "Independent website concept prepared from the recorded public source; commercial interest is unverified.", recommendedScope: "Independent website concept for owner review.", internalRecommendedPriceAud: null, evidence: [{ id: newId("evd"), reviewedAt: this.iso(), observation, sourceUrl, method: "manual", status: "unverified", uncertainty: "Source-backed research is not contact permission or proof of purchase intent." }], fixture: this.options.mode === "fake" });
    const existing = this.records(true).find(record => record.prospectId === prospect.id);
    if (existing?.archivedAt) throw new AcquisitionError("This lead is archived and cannot be imported again without an explicit restore.");
    if (existing) return existing;
    const record: AcquisitionRecord = { id: newId("acq"), prospectId: prospect.id, businessName, location, industry, website, sourceUrl, observation, services, createdAt: this.iso(), updatedAt: this.iso(), contact: null, demo: null, draft: null };
    if (input.contactEmail) record.contact = { email: emailValue(input.contactEmail, this.options.mode), sourceUrl: sourceUrlValue(input.contactSourceUrl ?? input.sourceUrl, this.options.mode), basis: "none_established", evidence: "", roleRelevant: false, noMarketingProhibition: false };
    if (description || address || phone || services.length) {
      const profile: BusinessProfile = { sourceKind: "public_research", state: this.options.mode === "fake" ? "fictional" : "partial", detail: "Research facts recorded from the cited public source. Identity and current details still need owner review.", sourceUrl, fetchedAt: this.iso(), description, address, phone, services, images: [], notices: ["No business logo or photograph is invented. Any generated concept artwork is labelled as an original illustration."] };
      this.store.upsertDoc(PROFILES, record.id, profile); record.businessProfile = businessProfileSummary(profile);
    }
    this.save(record);
    return record;
  }

  importExistingProspect(prospectId: string): AcquisitionRecord {
    const prospect = this.atlas.prospects.require(prospectId);
    if (this.options.mode === "live" && prospect.fixture) throw new AcquisitionError("Fictional prospects cannot be imported into a live batch.");
    const existing = this.records(true).find(record => record.prospectId === prospectId);
    if (existing?.archivedAt) throw new AcquisitionError("Archived prospects remain excluded from rebuilding.");
    return this.importProspect(prospect);
  }

  /** Called only after the server has verified page identity, linked asset URLs and raster bytes. */
  applyVerifiedPublicAssets(leadId: string, assets: { sourceUrl: string; fetchedAt: string; logo?: BusinessImage; images: BusinessImage[]; notices: string[] }, expectedRevision: string): AcquisitionRecord {
    const record = this.require(leadId); this.assertEditable(record);
    const profile = this.store.getDoc<BusinessProfile>(PROFILES, leadId)?.doc ?? null;
    const prospect = this.atlas.prospects.require(record.prospectId);
    if (record.website || prospect.website || prospect.contactEligibility.suppressed || prospect.qualification === "disqualified" || isCustomerStage(prospect.stage) || ["accepted", "queued", "submitting", "uncertain", "simulated", "cancelled"].includes(record.draft?.status ?? "draft")) throw new AcquisitionError("This prospect is no longer eligible for public profile artwork preparation.");
    if (contentHash({ record, profile, prospect }) !== expectedRevision) throw new AcquisitionError("The business changed while its public artwork was checked. Its current facts and draft were preserved.");
    if (sourceUrlValue(assets.sourceUrl, this.options.mode) !== sourceUrlValue(record.sourceUrl, this.options.mode) || !Array.isArray(assets.images) || assets.images.length > 3 || !Number.isFinite(Date.parse(assets.fetchedAt))) throw new AcquisitionError("Use verified artwork linked from this business's recorded source page.", 400);
    for (const image of [...(assets.logo ? [assets.logo] : []), ...assets.images]) {
      const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
      if (!match || match[1] !== image.mime || match[2]!.length > 2_800_000 || sha(Buffer.from(match[2]!, "base64")) !== image.sha256) throw new AcquisitionError("Only bounded, verified raster business artwork can be stored.", 400);
      sourceUrlValue(image.sourceUrl, this.options.mode);
    }
    const images = [...new Map([...assets.images, ...(profile?.images ?? [])].map(image => [image.sha256, image])).values()].slice(0, 3);
    const next: BusinessProfile = { ...(profile ?? { state: this.options.mode === "fake" ? "fictional" : "partial", detail: "Public business source facts require owner review.", sourceUrl: record.sourceUrl, services: record.services, images: [], notices: [] }), sourceKind: "public_research", fetchedAt: assets.fetchedAt, ...(assets.logo ? { logo: assets.logo } : {}), images, notices: [...new Set([...(profile?.notices ?? []), ...assets.notices.slice(0, 8)])] };
    this.store.upsertDoc(PROFILES, leadId, next); record.businessProfile = businessProfileSummary(next); this.save(record);
    this.atlas.audit.record({ actor: "owner", action: "read.website", business: "wulff_studio", targetType: "acquisition", targetId: leadId, outcome: this.options.mode === "fake" ? "simulated" : "completed", detail: { operation: "verified_public_artwork_saved", logoCount: assets.logo ? 1 : 0, photoCount: assets.images.length } });
    return record;
  }

  prepare(leadId: string, options: { templateId?: string; preserveDraft?: boolean; idempotencyKey?: string } = {}): AcquisitionRecord {
    const record = this.require(leadId);
    this.assertEditable(record);
    if (options.templateId !== undefined) getDemoTemplate(options.templateId as DemoTemplateId);
    const prospect = this.atlas.prospects.require(record.prospectId);
    let website: string | null = null;
    try { website = safeDemoWebsite(record.website); } catch { /* Preserve legacy/fixture sources as evidence, never as unsafe public links. */ }
    const businessProfile = this.store.getDoc<BusinessProfile>(PROFILES, leadId)?.doc;
    const input = { businessName: record.businessName, location: record.location, industry: record.industry, services: record.services, website, contactEmail: record.contact?.email, templateId: options.templateId as DemoTemplateId | undefined, fixture: Boolean(prospect.fixture), businessProfile, studio: this.company() };
    const rendered = renderDemoWebsite(input);
    const key = options.idempotencyKey;
    if (key !== undefined && (typeof key !== "string" || !/^[A-Za-z0-9:_-]{1,240}$/.test(key))) throw new AcquisitionError("Provide a bounded private preparation key.", 400);
    const preparationId = key ? sha(`${leadId}:${key}`) : null;
    const inputHash = contentHash({ input, preserveDraft: Boolean(options.preserveDraft), rendererHash: sha(rendered.html) });
    const saved = preparationId ? this.store.getDoc<Preparation>("acquisition_preparations", preparationId)?.doc : null;
    if (saved) {
      if (saved.inputHash !== inputHash || (record.demo?.id !== saved.demoId && (saved.completed || (record.demo?.id ?? null) !== saved.previousDemoId))) throw new AcquisitionError("The business or concept changed after this rebuild was requested. Review the current version before rebuilding again.");
      if (record.demo?.id === saved.demoId) { this.store.upsertDoc("acquisition_preparations", preparationId!, { ...saved, completed: true }); return record; }
    }
    const id = saved?.demoId ?? newId("demo"), previousDemoId = record.demo?.id ?? null;
    if (preparationId && !saved) this.store.upsertDoc<Preparation>("acquisition_preparations", preparationId, { inputHash, demoId: id, previousDemoId, completed: false });
    const previousUrl = record.demo ? this.url(this.internal(record).publicPath) : null;
    const priorDraft = record.draft ? structuredClone(record.draft) : null;
    const existingDemo = saved ? this.store.getDoc<InternalDemo>(DEMOS, id)?.doc : null;
    const rawToken = token(), expiresAt = existingDemo?.expiresAt ?? new Date(this.clock().getTime() + 14 * 86_400_000).toISOString();
    const internal: InternalDemo = existingDemo ?? { id, leadId, html: rendered.html, csp: rendered.contentSecurityPolicy, htmlHash: sha(rendered.html), publicTokenHash: sha(rawToken), publicPath: `/demos/${rawToken}`, expiresAt, ...(["clarity", "immersive", "simple"].includes(rendered.templateId) ? { sourceFiles: exportDemoReactProject({ ...input, templateId: rendered.templateId }) } : {}) };
    if (sha(internal.html) !== sha(rendered.html)) throw new AcquisitionError("The saved private rebuild differs from the requested design.");
    this.store.upsertDoc(DEMOS, id, internal);
    this.store.upsertDoc(TOKENS, internal.publicTokenHash, { demoId: id });
    record.demo = { id, templateId: rendered.templateId, templateName: rendered.templateName, htmlHash: internal.htmlHash, previewPath: `/api/acquisition/demos/${id}/preview`, publicPath: null, expiresAt, ...(rendered.designBrief ? { designBrief: rendered.designBrief } : {}) };
    if (options.preserveDraft && priorDraft && previousUrl) {
      record.draft = { ...priorDraft, version: priorDraft.version + 1, text: priorDraft.text.split(previousUrl).join(rendered.templateId === "simple" ? "A private revised website concept is ready; reply if you would like the preview." : this.url(internal.publicPath)), status: "draft", blockers: [], mailProviderIdentity: this.options.mailProviderIdentity?.() ?? "default" };
      delete record.draft.approvalId; delete record.draft.providerRef; delete record.draft.acceptedAt;
      record.draft.contentHash = contentHash(this.payload(record)); this.save(record);
    } else this.compose(record);
    if (preparationId) this.store.upsertDoc<Preparation>("acquisition_preparations", preparationId, { inputHash, demoId: id, previousDemoId, completed: true });
    this.atlas.audit.record({ actor: "agent:design", action: "acquisition.demo.prepared", business: "wulff_studio", targetType: "acquisition", targetId: record.id, outcome: "completed", detail: { demoId: id, htmlHash: internal.htmlHash, templateId: rendered.templateId } });
    return record;
  }

  /** Refreshing source artwork always produces a new private concept and exact email version. */
  async enrichAndPrepare(leadId: string, options: { templateId?: string; refresh?: boolean } = {}): Promise<AcquisitionRecord> {
    const initial = this.require(leadId); this.assertEditable(initial);
    const templateId = options.templateId ?? initial.demo?.templateId;
    if (options.templateId !== undefined) getDemoTemplate(options.templateId as DemoTemplateId);
    const cached = this.store.getDoc<BusinessProfile>(PROFILES, leadId)?.doc;
    const fresh = cached && cached.sourceKind !== "public_research" && Date.parse(cached.fetchedAt) > this.clock().getTime() - 7 * 86_400_000;
    if ((!fresh || options.refresh) && this.options.enricher) {
      const revision = contentHash(initial);
      let profile: BusinessProfile;
      if (this.options.mode === "fake" || this.atlas.prospects.require(initial.prospectId).fixture) {
        profile = { state: "fictional", detail: "Fictional test record; no real business website was fetched.", sourceUrl: initial.website ?? initial.sourceUrl, fetchedAt: this.iso(), services: [], images: [], notices: ["Fictional test data. Original concept illustrations are used."] };
      } else {
        try { profile = await this.options.enricher.enrich({ businessName: initial.businessName, website: initial.website, location: initial.location }); }
        catch { profile = { state: "unavailable", detail: "Business website enrichment failed. Existing business details remain available and no substitute branding was invented.", sourceUrl: initial.website ?? initial.sourceUrl, fetchedAt: this.iso(), services: [], images: [], notices: [] }; }
      }
      const current = this.require(leadId); this.assertEditable(current);
      if (contentHash(current) !== revision) throw new AcquisitionError("This lead changed while its website was being checked. Review the current record and refresh again.");
      this.store.upsertDoc(PROFILES, leadId, profile);
      current.businessProfile = businessProfileSummary(profile);
      if (!current.contact && profile.contactEmail && profile.contactSourceUrl) {
        try {
          current.contact = { email: emailValue(profile.contactEmail, this.options.mode), sourceUrl: sourceUrlValue(profile.contactSourceUrl, this.options.mode), basis: "none_established", evidence: "Public contact address found on the business website. Consent and relevance have not been reviewed.", roleRelevant: false, noMarketingProhibition: false };
        } catch { /* A source candidate is not a verified recipient or permission to contact. */ }
      }
      this.save(current);
      this.atlas.audit.record({ actor: "agent:research", action: "acquisition.business_profile.checked", business: "wulff_studio", targetType: "acquisition", targetId: leadId, outcome: profile.state === "unavailable" ? "failed" : profile.state === "fictional" ? "simulated" : "completed", detail: { state: profile.state, sourceUrl: profile.sourceUrl, logoHash: profile.logo?.sha256, imageHashes: profile.images.map(image => image.sha256), addressFound: Boolean(profile.address), phoneFound: Boolean(profile.phone) } });
    }
    return this.prepare(leadId, { templateId });
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

  saveSender(input: AcquisitionSenderInput, ownerName: string, options: { preserveDrafts?: boolean } = {}): AcquisitionSenderInput {
    required(ownerName, "Owner name", 120);
    if (options.preserveDrafts !== undefined && typeof options.preserveDrafts !== "boolean") throw new AcquisitionError("Use an explicit preserve-drafts setting.", 400);
    if (options.preserveDrafts && this.records().some(record => record.draft?.status === "submitting")) throw new AcquisitionError("An email submission is active. Update the sender after it finishes.");
    const previous = this.sender();
    const sender = { name: required(input.name, "Sender name", 120), organisation: required(input.organisation, "Organisation", 160), email: emailValue(input.email, this.options.mode), contactDetails: requiredBody(input.contactDetails, 500) };
    this.store.setMemory("acquisition.sender", sender);
    for (const record of this.records()) if (record.demo && record.draft && !TERMINAL.has(record.draft.status) && record.draft.status !== "submitting") {
      if (options.preserveDrafts) {
        if (record.draft.status === "cancelled") continue;
        this.refreshDraftSignature(record, previous, this.sender());
      } else this.compose(record);
    }
    this.atlas.audit.record({ actor: "owner", action: "acquisition.sender.saved", business: "wulff_studio", outcome: "completed", detail: { email: sender.email } });
    return sender;
  }

  /** Owner-supplied business identity. It never changes the email account or domain DNS. */
  configureCompany(input: { name: string; website: string }): { name: string; website: string } {
    const name = required(input.name, "Company name", 160);
    let website: string | null;
    try { website = safeDemoWebsite(input.website); } catch { throw new AcquisitionError("Use a public HTTPS company website without credentials.", 400); }
    if (!website) throw new AcquisitionError("Provide the company website.", 400);
    if (this.records().some(record => record.draft?.status === "submitting")) throw new AcquisitionError("An email submission is active. Update the company identity after it finishes.");
    const company = { name, website };
    if (contentHash(this.company()) === contentHash(company)) return company;
    const previous = this.sender();
    this.store.setMemory("acquisition.company", company);
    const next = this.sender();
    for (const record of this.records()) {
      if (!record.draft || TERMINAL.has(record.draft.status) || record.draft.status === "cancelled") continue;
      if (previous.organisation) record.draft.text = record.draft.text.split(previous.organisation).join(next.organisation);
      if (previous.contactDetails) record.draft.text = record.draft.text.replace(previous.contactDetails, next.contactDetails);
      else record.draft.text += `\n${company.website}`;
      record.draft.version += 1;
      record.draft.status = "draft";
      delete record.draft.approvalId;
      record.draft.contentHash = contentHash(this.payload(record));
      this.save(record);
    }
    this.atlas.audit.record({ actor: "owner", action: "execute.record_update", business: "wulff_studio", outcome: "completed", detail: { operation: "company_identity_saved", name, website } });
    return company;
  }

  company(): { name: string; website?: string } {
    return this.store.getMemory<{ name: string; website: string }>("acquisition.company") ?? { name: this.options.organisation ?? "Wulff Studio" };
  }

  saveDraft(leadId: string, input: { subject: string; text: string; expectedHash: string }): AcquisitionRecord {
    const record = this.require(leadId); this.assertEditable(record); this.assertHash(record, input.expectedHash);
    const draft = record.draft!, internal = this.internal(record), sender = this.sender();
    const subject = required(input.subject, "Email subject", 180), text = requiredBody(input.text, 9000);
    const unsubscribeUrl = this.unsubscribeUrl(record), demoUrl = this.url(internal.publicPath);
    const requiresDemoLink = record.demo?.templateId !== "simple" || Boolean(internal.publishedAt);
    if (record.demo?.templateId === "simple" && !internal.publishedAt && text.includes(demoUrl)) throw new AcquisitionError("Publish this concept before putting its public link in an email.", 400);
    if (![...(requiresDemoLink ? [demoUrl] : []), unsubscribeUrl, sender.name, sender.organisation, sender.contactDetails].every(value => value && text.includes(value))) throw new AcquisitionError("Keep the exact demo link, unsubscribe link and sender identity/contact details in the email.", 400);
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
      if (record.demo?.templateId === "simple" && record.draft && !TERMINAL.has(record.draft.status) && !["submitting", "cancelled"].includes(record.draft.status) && !record.draft.text.includes(this.url(demo.publicPath))) {
        record.draft.text += `\n\nWebsite concept preview: ${this.url(demo.publicPath)}`;
        this.invalidateDraft(record);
      }
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
  sourceProject(leadId: string): { name: string; files: Readonly<Record<string, string>> } {
    const record = this.require(leadId);
    if (!record.demo || !["clarity", "immersive", "simple"].includes(record.demo.templateId)) throw new AcquisitionError("Build a Simple, Clarity or Immersive concept first to download its matching React project.");
    const demo = this.internal(record);
    if (!demo.sourceFiles || sha(demo.html) !== record.demo.htmlHash) throw new AcquisitionError("Rebuild this concept to create its matching source download.");
    return { name: record.businessName, files: demo.sourceFiles };
  }
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
    const text = record.demo?.templateId === "simple" ? this.simpleIntroduction(record, sender, demo) : [`Hi ${record.businessName} team,`, "", `I’m ${sender.name || "Brandon"} from ${sender.organisation || "Wulff Studio"}. I came across your business while researching ${record.location}.`, `I put together an independent website concept showing a possible direction for your online presence:`, "", this.url(demo.publicPath), "", "It’s an unsolicited design concept, not your official website. If the direction interests you, you can reply and we can discuss what would be useful for your business. There’s no commitment.", "", sender.name, sender.organisation, sender.contactDetails, "", `Prefer no further contact? Unsubscribe here: ${this.unsubscribeUrl(record)}`].join("\n");
    record.draft = { id: prior?.id ?? newId("draft"), version: (prior?.version ?? 0) + 1, from: sender.email, to, subject, text, contentHash: "", status: "draft", blockers: [], mailProviderIdentity: this.options.mailProviderIdentity?.() ?? "default" };
    record.draft.contentHash = contentHash(this.payload(record)); this.save(record);
  }
  private simpleIntroduction(record: AcquisitionRecord, sender: AcquisitionSenderInput, demo: InternalDemo): string {
    const preview = demo.publishedAt ? `You can view the independent concept here: ${this.url(demo.publicPath)}` : "I’ve prepared a private website concept for your business. Would you like me to send you the preview?";
    return [`Hi ${record.businessName} team,`, "", `I’m ${sender.name || "Brandon"} from ${sender.organisation || "Wulff Studio"}. I came across your business in ${record.location}.`, "", preview, "", "It’s an unsolicited design idea, not your official website, and there’s no commitment.", "", sender.name, sender.organisation, sender.contactDetails, "", `Prefer no further contact? Unsubscribe here: ${this.unsubscribeUrl(record)}`].join("\n");
  }
  private invalidateDraft(record: AcquisitionRecord): void {
    const draft = record.draft!;
    draft.version += 1; draft.status = "draft"; draft.blockers = [];
    delete draft.approvalId; delete draft.providerRef; delete draft.acceptedAt;
    draft.contentHash = contentHash(this.payload(record)); this.save(record);
  }
  private refreshDraftSignature(record: AcquisitionRecord, previous: AcquisitionSenderInput, next: AcquisitionSenderInput): void {
    const draft = record.draft!, oldSignature = [previous.name, previous.organisation, previous.contactDetails].join("\n"), signature = [next.name, next.organisation, next.contactDetails].join("\n");
    if (draft.text.includes(oldSignature)) draft.text = draft.text.replace(oldSignature, signature);
    else {
      const footer = `Prefer no further contact? Unsubscribe here: ${this.unsubscribeUrl(record)}`;
      draft.text = draft.text.includes(footer) ? draft.text.replace(footer, `${signature}\n\n${footer}`) : `${draft.text}\n\n${signature}`;
    }
    const previousIntroduction = `I’m ${previous.name} from ${previous.organisation}.`;
    draft.text = draft.text.replace(previousIntroduction, `I’m ${next.name} from ${next.organisation}.`);
    draft.from = next.email; this.invalidateDraft(record);
  }
  private payload(record: AcquisitionRecord) {
    const draft = record.draft; if (!draft) throw new AcquisitionError("Prepare a demo and email first.");
    const demo = this.internal(record);
    return { leadId: record.id, draftId: draft.id, version: draft.version, from: draft.from, to: draft.to, subject: draft.subject, text: draft.text, mailProviderIdentity: this.options.mailProviderIdentity?.() ?? "default", demoId: demo.id, demoHtmlHash: demo.htmlHash, publicUrl: this.url(demo.publicPath), expiresAt: demo.expiresAt, sender: this.sender(), contactEligibility: record.contact, unsubscribeUrl: this.unsubscribeUrl(record), oneInitialMessageOnly: true };
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
    const sender = this.store.getMemory<AcquisitionSenderInput>("acquisition.sender") ?? { name: this.options.senderName ?? this.atlas.deps.config.ownerName, organisation: this.options.organisation ?? "Wulff Studio", email: this.options.fromAddress ?? this.atlas.deps.config.businessFromAddress, contactDetails: this.options.contactDetails ?? "" };
    const company = this.store.getMemory<{ name: string; website: string }>("acquisition.company");
    return company ? { ...sender, organisation: company.name, contactDetails: sender.contactDetails.includes(company.website) ? sender.contactDetails : [sender.contactDetails, company.website].filter(Boolean).join("\n") } : sender;
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

function sha(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
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

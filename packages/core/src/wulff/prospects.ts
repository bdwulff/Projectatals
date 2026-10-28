import type { Store } from "../store.js";
import type { AuditLog } from "../audit.js";
import { newId, nowIso } from "../ids.js";
import { canTransition, type Stage, StageTransitionError } from "./pipeline.js";
import type { QuoteInput } from "./quotes.js";

export type EvidenceStatus = "confirmed" | "hypothesis" | "unverified";

export interface Evidence {
  id: string;
  observation: string;
  /** confirmed = reproduced with a browser/HTTP check; hypothesis = visual/inferred; unverified = search-only. */
  status: EvidenceStatus;
  sourceUrl: string;
  reviewedAt: string;
  method: "http_check" | "browser_check" | "visual_review" | "search_result" | "manual";
  uncertainty?: string;
}

export interface Prospect {
  id: string;
  businessName: string;
  location: string;
  website: string | null;
  industry: string;
  stage: Stage;
  evidence: Evidence[];
  commercialOpportunity: string;
  recommendedScope: string;
  /** Internal only; never shown to a customer. */
  internalRecommendedPriceAud: number | null;
  qualification: "unqualified" | "qualified" | "disqualified";
  contactEligibility: {
    lawfulBasis: "none_established" | "existing_relationship" | "inferred_consent_business" | "express_consent";
    suppressed: boolean;
    suppressionReason?: string;
    checkedAt?: string;
  };
  outreach: { at: string; channel: "email"; subject: string; providerRef?: string; approvalId: string }[];
  createdAt: string;
  updatedAt: string;
  /** Fictional/test data flag; production reporting must exclude these. */
  fixture?: boolean;
  /** Scope the research/audit step proposes; the Commercial agent turns it into a quote. */
  suggestedQuote?: { deliverables: string[]; input: QuoteInput };
}

export class ProspectService {
  private readonly collection = "prospects";

  constructor(private readonly store: Store, private readonly audit: AuditLog) {}

  private normaliseKey(input: Pick<Prospect, "businessName" | "location" | "website">): string {
    const normal = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
    const identity = `${normal(input.businessName)}|${normal(input.location).replace(/\b(?:victoria|vic|australia)\b/g, "").trim().replace(/\s+/g, " ")}`;
    if (!input.website) return `business:${identity}`;
    try {
      const url = new URL(input.website), host = url.hostname.toLowerCase().replace(/^www\./, "");
      const shared = /(?:^|\.)(?:facebook\.com|fb\.com|instagram\.com|linkedin\.com|tiktok\.com|youtube\.com|findglocal\.com|truelocal\.com\.au|yellowpages\.com\.au|localsearch\.com\.au|hotfrog\.com(?:\.au)?|yelp\.com(?:\.au)?|wordofmouth\.com\.au|aussieweb\.com\.au|businesslistings\.net\.au|fresha\.com|bookwell\.com\.au|google\.com(?:\.au)?|maps\.app\.goo\.gl)$/.test(host);
      if (!shared) return `website:${host}`;
      // Social networks and directories host many businesses, including category/root pages.
      // Name and locality remain stable across tracking URLs, mobile hosts and profile-page changes.
      return `business:${identity}`;
    } catch { return `business:${identity}`; }
  }

  /** Company domains merge by host; shared profiles and absent websites use the normalised business name and locality. */
  upsert(input: Omit<Prospect, "id" | "createdAt" | "updatedAt" | "stage" | "outreach" | "evidence" | "qualification" | "contactEligibility"> & Partial<Pick<Prospect, "stage" | "evidence" | "qualification" | "contactEligibility" | "fixture" | "suggestedQuote">>): { prospect: Prospect; created: boolean } {
    const key = this.normaliseKey(input);
    const existing = this.list().find((p) => this.normaliseKey(p) === key);
    if (existing) {
      const seen = new Set(existing.evidence.map((e) => `${e.observation}|${e.sourceUrl}`));
      for (const e of input.evidence ?? []) if (!seen.has(`${e.observation}|${e.sourceUrl}`)) existing.evidence.push(e);
      existing.commercialOpportunity = input.commercialOpportunity || existing.commercialOpportunity;
      existing.recommendedScope = input.recommendedScope || existing.recommendedScope;
      existing.internalRecommendedPriceAud = input.internalRecommendedPriceAud ?? existing.internalRecommendedPriceAud;
      existing.suggestedQuote = input.suggestedQuote ?? existing.suggestedQuote;
      existing.updatedAt = nowIso();
      this.store.upsertDoc(this.collection, existing.id, existing);
      this.audit.record({ actor: "agent:research", action: "prospect.merged", business: "wulff_studio", targetType: "prospect", targetId: existing.id, outcome: "completed", detail: { key } });
      return { prospect: existing, created: false };
    }
    const now = nowIso();
    const prospect: Prospect = {
      id: newId("prs"),
      businessName: input.businessName,
      location: input.location,
      website: input.website,
      industry: input.industry,
      stage: input.stage ?? "research",
      evidence: input.evidence ?? [],
      commercialOpportunity: input.commercialOpportunity,
      recommendedScope: input.recommendedScope,
      internalRecommendedPriceAud: input.internalRecommendedPriceAud,
      qualification: input.qualification ?? "unqualified",
      contactEligibility: input.contactEligibility ?? { lawfulBasis: "none_established", suppressed: false },
      outreach: [],
      createdAt: now,
      updatedAt: now,
      fixture: input.fixture,
      suggestedQuote: input.suggestedQuote,
    };
    this.store.upsertDoc(this.collection, prospect.id, prospect);
    this.audit.record({ actor: "agent:research", action: "prospect.created", business: "wulff_studio", targetType: "prospect", targetId: prospect.id, outcome: "completed", detail: { businessName: prospect.businessName, evidence: prospect.evidence.length } });
    return { prospect, created: true };
  }

  addEvidence(id: string, evidence: Omit<Evidence, "id" | "reviewedAt">): Prospect {
    const p = this.require(id);
    p.evidence.push({ id: newId("evd"), reviewedAt: nowIso(), ...evidence });
    p.updatedAt = nowIso();
    this.store.upsertDoc(this.collection, p.id, p);
    return p;
  }

  /** Qualified only when at least one piece of evidence is confirmed or two are hypotheses with a stated uncertainty. */
  qualify(id: string): Prospect {
    const p = this.require(id);
    const confirmed = p.evidence.filter((e) => e.status === "confirmed").length;
    const hypotheses = p.evidence.filter((e) => e.status === "hypothesis" && e.uncertainty).length;
    p.qualification = confirmed >= 1 || hypotheses >= 2 ? "qualified" : "unqualified";
    if (p.qualification === "qualified" && p.stage === "research") p.stage = "qualified";
    p.updatedAt = nowIso();
    this.store.upsertDoc(this.collection, p.id, p);
    this.audit.record({ actor: "agent:research", action: "prospect.qualified", business: "wulff_studio", targetType: "prospect", targetId: p.id, outcome: "completed", detail: { qualification: p.qualification, confirmed, hypotheses } });
    return p;
  }

  setStage(id: string, to: Stage, reason: string): Prospect {
    const p = this.require(id);
    if (!canTransition(p.stage, to)) throw new StageTransitionError(p.stage, to);
    const from = p.stage;
    p.stage = to;
    p.updatedAt = nowIso();
    this.store.upsertDoc(this.collection, p.id, p);
    this.audit.record({ actor: "atlas", action: "prospect.stage", business: "wulff_studio", targetType: "prospect", targetId: p.id, outcome: "completed", detail: { from, to, reason } });
    return p;
  }

  suppress(id: string, reason: string): Prospect {
    const p = this.require(id);
    p.contactEligibility = { ...p.contactEligibility, suppressed: true, suppressionReason: reason, checkedAt: nowIso() };
    p.updatedAt = nowIso();
    this.store.upsertDoc(this.collection, p.id, p);
    this.audit.record({ actor: "atlas", action: "prospect.suppressed", business: "wulff_studio", targetType: "prospect", targetId: p.id, outcome: "completed", detail: { reason } });
    return p;
  }

  recordOutreach(id: string, entry: Prospect["outreach"][number]): Prospect {
    const p = this.require(id);
    p.outreach.push(entry);
    p.updatedAt = nowIso();
    this.store.upsertDoc(this.collection, p.id, p);
    return p;
  }

  /** Strongest lead: qualified, not suppressed, most confirmed evidence, then highest internal price. */
  bestLead(): Prospect | null {
    const score = (p: Prospect) => p.evidence.filter((e) => e.status === "confirmed").length * 10 + (p.internalRecommendedPriceAud ?? 0) / 1000;
    return this.list().filter((p) => p.qualification === "qualified" && !p.contactEligibility.suppressed).sort((a, b) => score(b) - score(a))[0] ?? null;
  }

  get(id: string): Prospect | null {
    return this.store.getDoc<Prospect>(this.collection, id)?.doc ?? null;
  }

  require(id: string): Prospect {
    const p = this.get(id);
    if (!p) throw new Error(`Prospect ${id} not found`);
    return p;
  }

  list(): Prospect[] {
    return this.store.listDocs<Prospect>(this.collection).map((d) => d.doc);
  }

  findByName(fragment: string): Prospect | null {
    const f = fragment.toLowerCase();
    return this.list().find((p) => p.businessName.toLowerCase().includes(f)) ?? null;
  }
}

import type { Store } from "../store.js";
import type { AuditLog } from "../audit.js";
import type { ApprovalCard } from "../approvals.js";
import { newId, nowIso } from "../ids.js";

export type PackageKey = "launch" | "local" | "grow";

export interface Package {
  key: PackageKey;
  name: string;
  priceAud: number;
  maxPages: number;
  revisionRounds: number;
  scope: string;
}

/** Section 9 starting prices. These are internal frameworks, not validated market prices. */
export const PACKAGES: Record<PackageKey, Package> = {
  launch: { key: "launch", name: "Launch", priceAud: 1490, maxPages: 1, revisionRounds: 1, scope: "One responsive page, up to six sections, one revision round" },
  local: { key: "local", name: "Local", priceAud: 2490, maxPages: 5, revisionRounds: 2, scope: "Up to five pages, two revision rounds" },
  grow: { key: "grow", name: "Grow", priceAud: 3490, maxPages: 8, revisionRounds: 2, scope: "Up to eight pages, supported existing booking link or embed, two revision rounds" },
};

export interface QuoteInput {
  pages: number;
  designComplexity: "standard" | "elevated" | "bespoke";
  contentPreparation: "client_supplied" | "light_editing" | "full_copywriting";
  integrations: { name: string; kind: "booking_embed" | "booking_api" | "ecommerce" | "crm" | "forms" | "other"; externalCostAud?: number; providerConfirmed: boolean }[];
  technicalRisk: "low" | "medium" | "high";
  supportMonths?: number;
}

export interface QuoteBreakdownLine {
  item: string;
  amountAud: number;
  reason: string;
}

export interface QuoteRecommendation {
  packageKey: PackageKey;
  basePriceAud: number;
  lines: QuoteBreakdownLine[];
  totalExGstAud: number;
  gstAud: number;
  totalIncGstAud: number;
  /** Whether GST applies depends on registration status, which is not yet confirmed. */
  gstStatus: "not_registered_unconfirmed" | "registered";
  externalCostsAud: number;
  estimatedEffortHours: number;
  estimatedMarginAud: number;
  explanation: string;
  dependencies: string[];
  exclusions: string[];
}

const HOURLY_COST_BASIS_AUD = 60; // internal effort cost basis for margin estimate (tooling + owner time), not a customer rate

export function recommendQuote(input: QuoteInput, opts: { gstRegistered?: boolean } = {}): QuoteRecommendation {
  const packageKey: PackageKey = input.pages <= 1 ? "launch" : input.pages <= 5 ? "local" : "grow";
  const pkg = PACKAGES[packageKey];
  const lines: QuoteBreakdownLine[] = [];
  let hours = packageKey === "launch" ? 10 : packageKey === "local" ? 22 : 34;

  if (input.pages > pkg.maxPages) {
    const extra = input.pages - pkg.maxPages;
    lines.push({ item: `${extra} additional page${extra > 1 ? "s" : ""}`, amountAud: extra * 250, reason: `Beyond the ${pkg.name} package limit of ${pkg.maxPages} pages` });
    hours += extra * 2;
  }
  if (input.designComplexity === "elevated") { lines.push({ item: "Elevated design direction", amountAud: 400, reason: "Custom typography, motion and editorial layout beyond the standard system" }); hours += 5; }
  if (input.designComplexity === "bespoke") { lines.push({ item: "Bespoke design", amountAud: 900, reason: "Fully original concept, custom components and animation" }); hours += 12; }
  if (input.contentPreparation === "light_editing") { lines.push({ item: "Content editing", amountAud: 200, reason: "Restructure and polish client-supplied copy" }); hours += 3; }
  if (input.contentPreparation === "full_copywriting") { lines.push({ item: "Copywriting", amountAud: 600, reason: "Write all page copy from a discovery call" }); hours += 8; }
  let externalCosts = 0;
  const dependencies: string[] = [];
  for (const i of input.integrations) {
    const price = i.kind === "booking_embed" ? (packageKey === "grow" ? 0 : 300) : i.kind === "booking_api" ? 700 : i.kind === "ecommerce" ? 1200 : i.kind === "crm" ? 450 : i.kind === "forms" ? 0 : 350;
    if (price > 0) lines.push({ item: `${i.name} integration`, amountAud: price, reason: i.kind === "booking_embed" ? "Embed of an existing booking provider (included in Grow)" : `${i.kind.replace("_", " ")} integration and testing` });
    hours += i.kind === "ecommerce" ? 14 : i.kind === "booking_api" ? 8 : i.kind === "booking_embed" ? 2 : 4;
    externalCosts += i.externalCostAud ?? 0;
    if (!i.providerConfirmed) dependencies.push(`Confirm ${i.name} provider and access before final pricing`);
  }
  if (input.technicalRisk === "medium") { lines.push({ item: "Technical contingency", amountAud: 250, reason: "Medium technical risk (migration or third-party dependency)" }); hours += 3; }
  if (input.technicalRisk === "high") { lines.push({ item: "Technical contingency", amountAud: 600, reason: "High technical risk; scope may need re-quoting after discovery" }); hours += 8; }
  if (input.supportMonths) { lines.push({ item: `${input.supportMonths} months support`, amountAud: input.supportMonths * 90, reason: "Monitoring, minor updates and form checks" }); }

  const subtotal = pkg.priceAud + lines.reduce((s, l) => s + l.amountAud, 0);
  const totalExGst = Math.round(subtotal / 10) * 10;
  const gstRegistered = opts.gstRegistered ?? false;
  const gst = gstRegistered ? Math.round(totalExGst * 0.1) : 0;
  const margin = totalExGst - externalCosts - hours * HOURLY_COST_BASIS_AUD;
  const explanation = [
    `${pkg.name} package (A$${pkg.priceAud}) fits ${input.pages} page${input.pages === 1 ? "" : "s"}.`,
    ...lines.map((l) => `${l.item}: +A$${l.amountAud} (${l.reason}).`),
    `Total A$${totalExGst}${gstRegistered ? ` plus A$${gst} GST` : " (GST not applied: registration status unconfirmed)"}.`,
    `Estimated effort ${hours}h, external costs A$${externalCosts}, estimated margin A$${margin}.`,
  ].join(" ");
  return {
    packageKey,
    basePriceAud: pkg.priceAud,
    lines,
    totalExGstAud: totalExGst,
    gstAud: gst,
    totalIncGstAud: totalExGst + gst,
    gstStatus: gstRegistered ? "registered" : "not_registered_unconfirmed",
    externalCostsAud: externalCosts,
    estimatedEffortHours: hours,
    estimatedMarginAud: margin,
    explanation,
    dependencies,
    exclusions: ["Hosting and domain fees", "Stock imagery licences", "Ongoing content updates beyond included revisions", "E-commerce, custom backends and inventory systems unless listed above"],
  };
}

export interface Quote {
  id: string;
  prospectId: string;
  customerName: string;
  version: number;
  deliverables: string[];
  input: QuoteInput;
  recommendation: QuoteRecommendation;
  /** The exact price the owner approves. Defaults to recommendation but owner may override. */
  priceExGstAud: number;
  depositPercent: number;
  timelineWeeks: number;
  status: "draft" | "approval_pending" | "approved" | "sent" | "accepted" | "rejected" | "superseded";
  approvalId?: string;
  sentAt?: string;
  sentProviderRef?: string;
  createdAt: string;
  updatedAt: string;
  changeReason?: string;
}

/** The exact payload bound to an approval. Any change here invalidates prior approval. */
export function quoteApprovalPayload(q: Quote) {
  return {
    quoteId: q.id,
    version: q.version,
    customerName: q.customerName,
    deliverables: q.deliverables,
    priceExGstAud: q.priceExGstAud,
    gstAud: q.recommendation.gstAud,
    depositPercent: q.depositPercent,
    timelineWeeks: q.timelineWeeks,
    exclusions: q.recommendation.exclusions,
  };
}

export function quoteApprovalCard(q: Quote): ApprovalCard {
  const r = q.recommendation;
  return {
    lines: [
      { label: "Customer", value: q.customerName },
      { label: "Deliverables", value: q.deliverables.join("; ") },
      { label: "Price", value: `A$${q.priceExGstAud}${r.gstAud ? ` + A$${r.gstAud} GST` : " (no GST: unconfirmed registration)"}` },
      { label: "External costs", value: `A$${r.externalCostsAud}` },
      { label: "Revisions", value: `${PACKAGES[r.packageKey].revisionRounds} rounds` },
      { label: "Exclusions", value: r.exclusions.join("; ") },
      { label: "Timeline", value: `${q.timelineWeeks} weeks${r.dependencies.length ? `; depends on: ${r.dependencies.join("; ")}` : ""}` },
      { label: "Deposit", value: `${q.depositPercent}% on acceptance, balance before go-live` },
      { label: "Est. margin", value: `A$${r.estimatedMarginAud} (${r.estimatedEffortHours}h)` },
    ],
    actions: ["approve", "revise", "reject"],
    risk: r.dependencies.length ? "Price subject to confirming listed dependencies" : undefined,
  };
}

export class QuoteService {
  private readonly collection = "quotes";
  constructor(private readonly store: Store, private readonly audit: AuditLog) {}

  createDraft(input: { prospectId: string; customerName: string; deliverables: string[]; quoteInput: QuoteInput; priceOverrideAud?: number; depositPercent?: number; timelineWeeks?: number; gstRegistered?: boolean }): Quote {
    const prior = this.list().filter((q) => q.prospectId === input.prospectId);
    const rec = recommendQuote(input.quoteInput, { gstRegistered: input.gstRegistered });
    const now = nowIso();
    const q: Quote = {
      id: newId("qte"),
      prospectId: input.prospectId,
      customerName: input.customerName,
      version: prior.length + 1,
      deliverables: input.deliverables,
      input: input.quoteInput,
      recommendation: rec,
      priceExGstAud: input.priceOverrideAud ?? rec.totalExGstAud,
      depositPercent: input.depositPercent ?? 40,
      timelineWeeks: input.timelineWeeks ?? (rec.packageKey === "launch" ? 2 : rec.packageKey === "local" ? 3 : 4),
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };
    for (const p of prior) if (p.status !== "accepted" && p.status !== "rejected" && p.status !== "superseded") { p.status = "superseded"; this.store.upsertDoc(this.collection, p.id, p); }
    this.store.upsertDoc(this.collection, q.id, q);
    this.audit.record({ actor: "agent:commercial", action: "quote.drafted", business: "wulff_studio", targetType: "quote", targetId: q.id, outcome: "completed", detail: { version: q.version, price: q.priceExGstAud, package: rec.packageKey } });
    return q;
  }

  revise(quoteId: string, changes: { quoteInput?: Partial<QuoteInput>; deliverables?: string[]; priceOverrideAud?: number; reason: string; gstRegistered?: boolean }): Quote {
    const prev = this.require(quoteId);
    const nextInput: QuoteInput = { ...prev.input, ...changes.quoteInput, integrations: changes.quoteInput?.integrations ?? prev.input.integrations };
    const next = this.createDraft({ prospectId: prev.prospectId, customerName: prev.customerName, deliverables: changes.deliverables ?? prev.deliverables, quoteInput: nextInput, priceOverrideAud: changes.priceOverrideAud, depositPercent: prev.depositPercent, timelineWeeks: prev.timelineWeeks, gstRegistered: changes.gstRegistered });
    next.changeReason = changes.reason;
    this.save(next);
    return next;
  }

  save(q: Quote): Quote {
    q.updatedAt = nowIso();
    this.store.upsertDoc(this.collection, q.id, q);
    return q;
  }

  get(id: string): Quote | null {
    return this.store.getDoc<Quote>(this.collection, id)?.doc ?? null;
  }
  require(id: string): Quote {
    const q = this.get(id);
    if (!q) throw new Error(`Quote ${id} not found`);
    return q;
  }
  list(): Quote[] {
    return this.store.listDocs<Quote>(this.collection).map((d) => d.doc);
  }
  latestForProspect(prospectId: string): Quote | null {
    return this.list().filter((q) => q.prospectId === prospectId).sort((a, b) => b.version - a.version)[0] ?? null;
  }
}

import type { Store } from "./store.js";
import { AuditLog, type Business } from "./audit.js";
import { ApprovalService, ApprovalError, type ApprovalRequest } from "./approvals.js";
import { NotificationService, type Notifier, type Notification } from "./notifications.js";
import { JobQueue } from "./jobs.js";
import { ProspectService, type Prospect, type Evidence } from "./wulff/prospects.js";
import { QuoteService, quoteApprovalPayload, quoteApprovalCard, recommendQuote, type Quote, type QuoteInput } from "./wulff/quotes.js";
import { summariseOrders, melbourneDayRange, spokenOrderSummary, type OrderSummary, type BoxSafeOrder } from "./boxsafe/orders.js";
import { reconcile, type ReconciliationResult } from "./boxsafe/reconcile.js";
import type { BoxSafeGateway, ConnectionStatus, Mailer, Mailbox, StripeGateway, Telephony, WebsiteChecker, SpeechSynth } from "./adapters/types.js";
import { composeBriefing, type Briefing } from "./briefing.js";
import { needsOwnerApproval, isHumanOnly, type ActionKind, PermissionDeniedError } from "./permissions.js";
import { ResearchUnavailableError, type ResearchLookupInput, type ResearchLookupResult } from "./adapters/research.js";
import { newId, nowIso } from "./ids.js";

export interface ProspectCandidate {
  businessName: string;
  location: string;
  website: string | null;
  industry: string;
  observations: { observation: string; sourceUrl: string; method: Evidence["method"]; status: Evidence["status"]; uncertainty?: string; /** URL to HTTP-check to try to confirm */ checkUrl?: string }[];
  commercialOpportunity: string;
  recommendedScope: string;
  internalRecommendedPriceAud: number | null;
  suggestedQuote?: Prospect["suggestedQuote"];
  contactEmail?: string;
  fixture?: boolean;
}

/** Pluggable source of candidates: a fixture list now, a Research Agent (search + browser) later. */
export interface ResearchSource {
  find(input: { area: string; count: number; industries?: string[] }): Promise<ProspectCandidate[]>;
}

export interface Project {
  id: string;
  business: Business;
  prospectId: string;
  quoteId: string;
  name: string;
  stage: "accepted" | "deposit_confirmed" | "in_development" | "quality_review" | "client_acceptance" | "live" | "maintenance";
  tasks: { id: string; title: string; status: "todo" | "doing" | "done" | "blocked"; owner: "atlas" | "owner" | "client" }[];
  blockers: string[];
  timeline: { at: string; note: string }[];
  nextAction: string;
  createdAt: string;
  updatedAt: string;
}

export interface AtlasConfig {
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string | null;
  businessFromAddress: string;
  budgetLimitAud: number;
  gstRegistered: boolean;
  ownerCallsEnabled?: boolean;
}

export interface AtlasDeps {
  store: Store;
  mailer: Mailer;
  mailbox?: Mailbox;
  telephony: Telephony;
  boxsafe: BoxSafeGateway;
  stripe: StripeGateway;
  websiteChecker: WebsiteChecker;
  speech?: SpeechSynth;
  pushNotifier?: Notifier;
  research: ResearchSource;
  lookup?: { lookup(input: ResearchLookupInput): Promise<ResearchLookupResult[]>; status(): Promise<ConnectionStatus> };
  clock?: () => Date;
  config: AtlasConfig;
}

export type Intent =
  | { kind: "briefing" }
  | { kind: "boxsafe.orders"; range: "today" | "week" | "month" }
  | { kind: "boxsafe.revenue"; range: "today" | "week" | "month" }
  | { kind: "boxsafe.dispatch" }
  | { kind: "boxsafe.reconcile"; range: "today" | "week" | "month" }
  | { kind: "wulff.find_prospects"; area: string; count: number }
  | { kind: "wulff.best_lead" }
  | { kind: "wulff.prepare_quote"; target: string | null }
  | { kind: "wulff.what_would_you_charge"; target: string | null }
  | { kind: "wulff.approve_quote"; priceAud: number | null }
  | { kind: "wulff.reject_quote" }
  | { kind: "wulff.check_website"; target: string | null }
  | { kind: "wulff.explain_delay"; target: string | null }
  | { kind: "research.lookup"; query: string }
  | { kind: "owner.test_call" }
  | { kind: "status" }
  | { kind: "unknown"; text: string };

export interface IntentParser {
  parse(text: string): Promise<Intent>;
}

/** Deterministic parser. A Claude-backed parser can replace it behind the same interface. */
export class RuleIntentParser implements IntentParser {
  async parse(raw: string): Promise<Intent> {
    const cleaned = raw.trim().replace(/^(?:(?:hey|ok|okay)\s+)?(?:atlas|jarvis)\b[,.]?\s*/i, "");
    const t = cleaned.toLowerCase();
    const range = (/\bweek\b/.test(t) ? "week" : /\bmonth\b/.test(t) ? "month" : "today") as "today" | "week" | "month";
    if (/(morning|briefing|what'?s happening|what is happening|across my businesses|run wulff)/.test(t) && !/boxsafe order/.test(t)) return { kind: "briefing" };
    if (/status|connected|online/.test(t) && (/atlas|jarvis|system|connection/.test(t) || /^(?:status|are you (?:online|connected)|what'?s your status)\??$/.test(t))) return { kind: "status" };
    if (/(merch|merchandise).*(post|ship|dispatch)|need.*(posting|dispatch|shipping)/.test(t)) return { kind: "boxsafe.dispatch" };
    if (/(stripe|payments).*(against|reconcile|check|match)|reconcile/.test(t)) return { kind: "boxsafe.reconcile", range };
    if (/how much.*(boxsafe|received|made|money)|boxsafe.*(revenue|received|made)/.test(t)) return { kind: "boxsafe.revenue", range };
    if (/boxsafe.*(order|report)|orders.*boxsafe/.test(t)) return { kind: "boxsafe.orders", range };
    if (/^(call me|test (my |the )?(phone|call))\b/.test(t)) return { kind: "owner.test_call" };
    if (/^(look up|search for|research)\s+/.test(t)) return { kind: "research.lookup", query: cleaned.replace(/^(?:look up|search for|research)\s+/i, "").trim() };
    if (/find .*(business|lead|prospect|client)/.test(t)) {
      const count = Number(/(\d+|five|five|three|ten)/.exec(t)?.[1]?.replace("five", "5").replace("three", "3").replace("ten", "10") ?? 5) || 5;
      const area = /(?:around|in|near) ([a-z ]+?)(?: that| who| with|$)/.exec(t)?.[1]?.trim() ?? "Officer, Berwick, Pakenham, Cranbourne, Dandenong";
      return { kind: "wulff.find_prospects", area, count };
    }
    if (/best lead|strongest (lead|opportunity)/.test(t)) return { kind: "wulff.best_lead" };
    if (/\bapproved?\b/.test(t) && !/\b(don't|do not|not|never)\s+approve/.test(t)) {
      const m = /\$\s?([\d,]+)/.exec(t);
      return { kind: "wulff.approve_quote", priceAud: m ? Number(m[1]!.replace(/,/g, "")) : null };
    }
    if (/\breject(ed)?\b/.test(t)) return { kind: "wulff.reject_quote" };
    if (/what would you charge|what should we charge|price for/.test(t)) return { kind: "wulff.what_would_you_charge", target: targetFrom(t) };
    if (/(prepare|create|build|make).*(quote|concept|proposal)/.test(t)) return { kind: "wulff.prepare_quote", target: targetFrom(t) };
    if (/website.*(working|functioning|up|ok)|check.*website/.test(t)) return { kind: "wulff.check_website", target: targetFrom(t) };
    if (/why.*(delay|late|behind)/.test(t)) return { kind: "wulff.explain_delay", target: targetFrom(t) };
    return { kind: "unknown", text: raw };
  }
}

function targetFrom(t: string): string | null {
  const m = /(?:for|of|on) (?:the |that |this )?([a-z0-9' &-]+?)(?:\?|$|\.| website| at | to )/.exec(t);
  const v = m?.[1]?.trim() ?? null;
  if (!v || ["that", "it", "them", "this", "the gym", "gym", "client", "the client"].includes(v)) return null;
  return v;
}

export interface CommandResult {
  reply: string;
  intent: Intent;
  data?: unknown;
  approvalId?: string;
  outcome: "completed" | "attempted" | "simulated" | "awaiting_approval" | "denied" | "unknown";
}

export class Atlas {
  readonly audit: AuditLog;
  readonly approvals: ApprovalService;
  readonly notifications: NotificationService;
  readonly jobs: JobQueue;
  readonly prospects: ProspectService;
  readonly quotes: QuoteService;
  readonly intents: IntentParser;
  readonly clock: () => Date;
  private readonly projectsCollection = "projects";

  constructor(readonly deps: AtlasDeps, intents: IntentParser = new RuleIntentParser()) {
    this.clock = deps.clock ?? (() => new Date());
    this.audit = new AuditLog(deps.store);
    this.approvals = new ApprovalService(deps.store, this.audit);
    this.notifications = new NotificationService(deps.store);
    if (deps.pushNotifier) this.notifications.use(deps.pushNotifier);
    this.jobs = new JobQueue(deps.store, this.audit);
    this.prospects = new ProspectService(deps.store, this.audit);
    this.quotes = new QuoteService(deps.store, this.audit);
    this.intents = intents;
    this.registerJobs();
  }

  // ───────────────────────── permissions ─────────────────────────
  private assertExecutable(action: ActionKind, approvedSubject?: string, payload?: unknown): ApprovalRequest | null {
    if (isHumanOnly(action)) throw new PermissionDeniedError(action, "Level 5 actions are human-controlled and never automated");
    if (needsOwnerApproval(action)) {
      if (!approvedSubject) throw new PermissionDeniedError(action, "Level 4 action requires an approved subject");
      return this.approvals.consume(approvedSubject, payload);
    }
    return null;
  }

  // ───────────────────────── connections ─────────────────────────
  async connections(): Promise<ConnectionStatus[]> {
    const adapters = [this.deps.boxsafe, this.deps.stripe, this.deps.mailer, this.deps.telephony, this.deps.websiteChecker, this.deps.mailbox, this.deps.speech, this.deps.lookup].filter(Boolean) as { status(): Promise<ConnectionStatus> }[];
    if (this.deps.pushNotifier && "status" in this.deps.pushNotifier && typeof this.deps.pushNotifier.status === "function") adapters.push(this.deps.pushNotifier as typeof adapters[number]);
    return Promise.all(adapters.map((a) => a.status()));
  }

  // ───────────────────────── Wulff Studio: research ─────────────────────────
  async researchProspects(input: { area: string; count: number; industries?: string[] }): Promise<Prospect[]> {
    const candidates = await this.deps.research.find({ area: input.area, count: input.count, industries: input.industries });
    const out: Prospect[] = [];
    for (const c of candidates) {
      const evidence: Evidence[] = [];
      for (const o of c.observations) {
        let status = o.status;
        let uncertainty = o.uncertainty;
        let method = o.method;
        if (o.checkUrl) {
          const r = await this.deps.websiteChecker.check(o.checkUrl);
          if (!r.reachable || (r.status && r.status >= 400)) { status = "confirmed"; method = "http_check"; uncertainty = undefined; }
          else { status = "hypothesis"; uncertainty = `HTTP check returned ${r.status}; issue not reproduced automatically`; }
        }
        evidence.push({ id: newId("evd"), observation: o.observation, status, sourceUrl: o.sourceUrl, reviewedAt: nowIso(), method, uncertainty });
      }
      const { prospect } = this.prospects.upsert({ businessName: c.businessName, location: c.location, website: c.website, industry: c.industry, evidence, commercialOpportunity: c.commercialOpportunity, recommendedScope: c.recommendedScope, internalRecommendedPriceAud: c.internalRecommendedPriceAud, suggestedQuote: c.suggestedQuote, fixture: c.fixture, contactEligibility: { lawfulBasis: "none_established", suppressed: false } });
      if (c.contactEmail) this.deps.store.setMemory(`prospect.contact.${prospect.id}`, { email: c.contactEmail });
      out.push(this.prospects.qualify(prospect.id));
    }
    const qualified = out.filter((p) => p.qualification === "qualified");
    await this.notifications.emit({ eventKey: `research:${input.area}:${this.clock().toISOString().slice(0, 10)}`, priority: "routine", business: "wulff_studio", title: `Research complete: ${qualified.length} of ${out.length} candidates qualified`, body: qualified.map((p) => p.businessName).join(", ") });
    return out;
  }

  // ───────────────────────── Wulff Studio: quotes ─────────────────────────
  prepareQuote(prospectId: string, override?: { deliverables?: string[]; input?: QuoteInput; priceOverrideAud?: number }): { quote: Quote; approval: ApprovalRequest } {
    const p = this.prospects.require(prospectId);
    const deliverables = override?.deliverables ?? p.suggestedQuote?.deliverables;
    const input = override?.input ?? p.suggestedQuote?.input;
    if (!deliverables || !input) throw new Error(`No scope available for ${p.businessName}; run discovery first`);
    const quote = this.quotes.createDraft({ prospectId, customerName: p.businessName, deliverables, quoteInput: input, priceOverrideAud: override?.priceOverrideAud, gstRegistered: this.deps.config.gstRegistered });
    return this.requestQuoteApproval(quote);
  }

  private requestQuoteApproval(quote: Quote): { quote: Quote; approval: ApprovalRequest } {
    const approval = this.approvals.request({
      action: "approve.quote_send",
      business: "wulff_studio",
      subject: `quote:${quote.prospectId}`,
      title: `Quote for ${quote.customerName}: A$${quote.priceExGstAud}`,
      summary: quote.recommendation.explanation,
      card: quoteApprovalCard(quote),
      payload: quoteApprovalPayload(quote),
    });
    quote.status = "approval_pending";
    quote.approvalId = approval.id;
    this.quotes.save(quote);
    const p = this.prospects.get(quote.prospectId);
    if (p && p.stage !== "approval_pending") {
      if (p.stage !== "draft_quote") this.safeStage(p.id, "draft_quote", "quote prepared");
      this.safeStage(p.id, "approval_pending", "owner approval requested");
    }
    this.deps.store.setMemory("context.lastProspectId", quote.prospectId);
    void this.notifications.emit({ eventKey: `approval:${approval.id}`, priority: "action_needed", business: "wulff_studio", title: approval.title, body: `v${quote.version}. ${quote.recommendation.explanation}`, link: { type: "approval", id: approval.id } });
    return { quote, approval };
  }

  private safeStage(prospectId: string, to: Prospect["stage"], reason: string): boolean {
    try { this.prospects.setStage(prospectId, to, reason); return true; } catch { return false; }
  }

  /** Owner decision. A different price than the pending version is a revision, not an approval. */
  decideQuote(decision: "approve" | "reject" | "revise", by: string, opts: { approvalId?: string; priceAud?: number | null; note?: string } = {}): { approval: ApprovalRequest; quote: Quote; revised?: { quote: Quote; approval: ApprovalRequest } } {
    const approval = opts.approvalId ? this.approvals.get(opts.approvalId) : this.approvals.pending().filter((a) => a.action === "approve.quote_send").at(-1) ?? null;
    if (!approval) throw new ApprovalError("No pending quote approval", "NOT_FOUND");
    const payload = approval.payload as ReturnType<typeof quoteApprovalPayload>;
    const quote = this.quotes.require(payload.quoteId);
    if (decision === "approve" && opts.priceAud != null && opts.priceAud !== quote.priceExGstAud) {
      const decided = this.approvals.decide(approval.id, "revise", by, `Owner specified A$${opts.priceAud} instead of A$${quote.priceExGstAud}`);
      const revisedQuote = this.quotes.revise(quote.id, { priceOverrideAud: opts.priceAud, reason: `Owner set price to A$${opts.priceAud}`, gstRegistered: this.deps.config.gstRegistered });
      const revised = this.requestQuoteApproval(revisedQuote);
      // Owner stated the exact price, so approve the exact revised version immediately.
      const approvedRevised = this.approvals.decide(revised.approval.id, "approve", by, opts.note);
      revised.quote.status = "approved";
      this.quotes.save(revised.quote);
      return { approval: decided, quote, revised: { quote: revised.quote, approval: approvedRevised } };
    }
    const decided = this.approvals.decide(approval.id, decision, by, opts.note);
    quote.status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "draft";
    this.quotes.save(quote);
    if (decision === "approve") this.jobs.enqueue("send_quote", { quoteId: quote.id, version: quote.version }, { idempotencyKey: `send_quote:${quote.id}:v${quote.version}` });
    return { approval: decided, quote };
  }

  /** Sends the exact approved version through the mailer. Idempotent via job key. */
  async sendQuote(quoteId: string): Promise<{ quote: Quote; providerRef: string; outcome: "completed" }> {
    const quote = this.quotes.require(quoteId);
    const contact = this.deps.store.getMemory<{ email: string }>(`prospect.contact.${quote.prospectId}`);
    if (!contact?.email) throw new Error(`No contact address on file for ${quote.customerName}`);
    const prospect = this.prospects.require(quote.prospectId);
    const mailerStatus = await this.deps.mailer.status();
    if (prospect.contactEligibility.suppressed) throw new PermissionDeniedError("approve.quote_send", `${prospect.businessName} is on the suppression list (${prospect.contactEligibility.suppressionReason ?? "no reason recorded"})`);
    if (mailerStatus.mode === "live" && prospect.contactEligibility.lawfulBasis === "none_established") throw new PermissionDeniedError("approve.quote_send", `No lawful basis recorded for contacting ${prospect.businessName}; unsolicited commercial email is blocked until eligibility is established (Spam Act)`);
    const payload = quoteApprovalPayload(quote);
    const approval = this.assertExecutable("approve.quote_send", `quote:${quote.prospectId}`, payload);
    const text = renderQuoteEmail(quote, this.deps.config);
    const res = await this.deps.mailer.send({ to: contact.email, from: this.deps.config.businessFromAddress, subject: `Website proposal for ${quote.customerName} (v${quote.version})`, text, approvalId: approval?.id });
    quote.status = "sent";
    quote.sentAt = res.acceptedAt;
    quote.sentProviderRef = res.providerRef;
    this.quotes.save(quote);
    this.prospects.recordOutreach(quote.prospectId, { at: res.acceptedAt, channel: "email", subject: `Website proposal (v${quote.version})`, providerRef: res.providerRef, approvalId: approval?.id ?? "" });
    this.safeStage(quote.prospectId, "quote_sent", "approved quote sent");
    this.audit.record({ actor: "atlas", action: "quote.sent", business: "wulff_studio", targetType: "quote", targetId: quote.id, outcome: "completed", detail: { to: contact.email, providerRef: res.providerRef, version: quote.version, approvalId: approval?.id } });
    return { quote, providerRef: res.providerRef, outcome: "completed" };
  }

  /**
   * Customer reply is untrusted input. It can only ever lead to a new draft
   * and a new approval request; it can never approve, spend or change scope by itself.
   */
  handleCustomerReply(quoteId: string, replyText: string): { changed: boolean; revised?: { quote: Quote; approval: ApprovalRequest }; note: string } {
    const quote = this.quotes.require(quoteId);
    const lower = replyText.toLowerCase();
    this.audit.record({ actor: "agent:communications", action: "customer.reply.received", business: "wulff_studio", targetType: "quote", targetId: quote.id, outcome: "completed", detail: { chars: replyText.length } });
    const wantsBooking = /booking|book online|online booking|appointment/.test(lower) && !quote.input.integrations.some((i) => i.kind.startsWith("booking"));
    const wantsShop = /online shop|online store|sell (gloves|merch|products|gear)|e-?commerce|checkout/.test(lower) && !quote.input.integrations.some((i) => i.kind === "ecommerce");
    const extraPagesMatch = /add (?:an?|one|two|three|\d+) (?:more |extra |new |additional )?pages?/.exec(lower);
    const extraPages = extraPagesMatch ? (Number(/\d+/.exec(extraPagesMatch[0])?.[0]) || (/(two)/.test(extraPagesMatch[0]) ? 2 : /(three)/.test(extraPagesMatch[0]) ? 3 : 1)) : 0;
    if (!wantsBooking && !wantsShop && !extraPages) return { changed: false, note: "Reply recorded. No scope change detected; no new approval needed." };
    const integrations = [...quote.input.integrations];
    const deliverables = [...quote.deliverables];
    const reasons: string[] = [];
    if (wantsBooking) { integrations.push({ name: "Online booking", kind: "booking_api", providerConfirmed: false }); deliverables.push("Online booking integration (provider to be confirmed)"); reasons.push("online booking integration"); }
    if (wantsShop) { integrations.push({ name: "Online shop", kind: "ecommerce", providerConfirmed: false }); deliverables.push("Online shop with product catalogue and checkout (platform to be confirmed)"); reasons.push("an online shop"); }
    if (extraPages) { for (let i = 1; i <= extraPages; i++) deliverables.push(`Additional page ${i} (content to be confirmed)`); reasons.push(`${extraPages} additional page${extraPages > 1 ? "s" : ""}`); }
    const revisedQuote = this.quotes.revise(quote.id, {
      quoteInput: { integrations, pages: quote.input.pages + extraPages },
      deliverables,
      reason: `Customer requested ${reasons.join(", ")}`,
      gstRegistered: this.deps.config.gstRegistered,
    });
    const revised = this.requestQuoteApproval(revisedQuote);
    const deps = revisedQuote.recommendation.dependencies;
    return { changed: true, revised, note: `They've asked for ${reasons.join(" and ")}. That changes the scope. I recommend revising the price to A$${revisedQuote.priceExGstAud}${deps.length ? `, subject to ${deps.map((d) => d.replace(/^Confirm /, "confirming ")).join(" and ")}` : ""}. Do you approve the revised quote?` };
  }

  // ───────────────────────── Projects ─────────────────────────
  acceptQuote(quoteId: string): Project {
    const quote = this.quotes.require(quoteId);
    if (quote.status !== "sent") throw new Error("Only a sent quote can be accepted");
    quote.status = "accepted";
    this.quotes.save(quote);
    this.safeStage(quote.prospectId, "accepted", "customer accepted quote");
    const now = nowIso();
    const project: Project = {
      id: newId("prj"), business: "wulff_studio", prospectId: quote.prospectId, quoteId: quote.id, name: `${quote.customerName} website`, stage: "accepted",
      tasks: [
        { id: newId("tsk"), title: `Issue deposit invoice (${quote.depositPercent}%)`, status: "todo", owner: "atlas" },
        { id: newId("tsk"), title: "Collect brand assets and content", status: "todo", owner: "client" },
        { id: newId("tsk"), title: "Design concept", status: "todo", owner: "atlas" },
        { id: newId("tsk"), title: "Build and QA", status: "todo", owner: "atlas" },
        { id: newId("tsk"), title: "Client acceptance", status: "todo", owner: "owner" },
      ],
      blockers: ["Deposit not yet confirmed"], timeline: [{ at: now, note: "Quote accepted" }], nextAction: "Issue deposit invoice", createdAt: now, updatedAt: now,
    };
    this.deps.store.upsertDoc(this.projectsCollection, project.id, project);
    this.audit.record({ actor: "atlas", action: "project.created", business: "wulff_studio", targetType: "project", targetId: project.id, outcome: "completed" });
    return project;
  }

  projects(): Project[] { return this.deps.store.listDocs<Project>(this.projectsCollection).map((d) => d.doc); }

  // ───────────────────────── BoxSafe ─────────────────────────
  async boxsafeSummary(range: "today" | "week" | "month"): Promise<{ summary: OrderSummary; orders: BoxSafeOrder[]; mode: "live" | "fake" }> {
    const r = melbourneDayRange(this.clock(), range);
    const status = await this.deps.boxsafe.status();
    const orders = await this.deps.boxsafe.listOrders({ from: new Date(r.from.getTime() - 30 * 86_400_000), to: r.to });
    const summary = summariseOrders(orders, r);
    for (const a of summary.attention) {
      await this.notifications.emit({ eventKey: `boxsafe:attention:${a.orderId}:${a.reason}`, priority: "action_needed", business: "boxsafe", title: `BoxSafe order ${a.orderId} needs review`, body: a.reason, link: { type: "order", id: a.orderId } });
    }
    return { summary, orders, mode: status.mode };
  }

  async reconcileBoxSafe(range: "today" | "week" | "month"): Promise<ReconciliationResult & { mode: "live" | "fake" }> {
    const r = melbourneDayRange(this.clock(), range);
    const from = new Date(r.from.getTime() - 7 * 86_400_000);
    const [boxStatus, stripeStatus] = await Promise.all([this.deps.boxsafe.status(), this.deps.stripe.status()]);
    if (boxStatus.mode !== stripeStatus.mode || !["connected", "fake"].includes(boxStatus.state) || !["connected", "fake"].includes(stripeStatus.state)) throw new Error("Reconciliation unavailable: BoxSafe and Stripe must both be connected in the same mode. No fictional fallback.");
    const status = boxStatus;
    const [orders, payments] = await Promise.all([this.deps.boxsafe.listOrders({ from, to: r.to }), this.deps.stripe.listPayments({ from, to: r.to })]);
    const result = reconcile(orders, payments);
    for (const p of result.pendingOrdersWithSucceededPayment) await this.notifications.emit({ eventKey: `boxsafe:reconcile:pending-paid:${p.orderId}`, priority: "action_needed", business: "boxsafe", title: `Order ${p.orderId} paid in Stripe but still pending in BoxSafe`, body: "The Stripe webhook may have been missed. Do not invoke repair functions. An authenticated, reviewed correction path is required before any production repair.", link: { type: "order", id: p.orderId } });
    for (const p of result.paymentsWithoutOrder) await this.notifications.emit({ eventKey: `boxsafe:reconcile:orphan-payment:${p.paymentIntentId}`, priority: "action_needed", business: "boxsafe", title: `Stripe payment ${p.paymentIntentId} (A$${p.amountAud}) has no BoxSafe order`, body: "Possible orphaned checkout. Needs manual review." });
    this.audit.record({ actor: "agent:finance", action: "boxsafe.reconciled", business: "boxsafe", outcome: "completed", detail: { range, matched: result.matched.length, issues: result.ordersWithoutPayment.length + result.paymentsWithoutOrder.length + result.amountMismatches.length + result.pendingOrdersWithSucceededPayment.length, mode: status.mode } });
    return { ...result, mode: status.mode };
  }

  async boxsafeDispatchList(): Promise<{ orders: BoxSafeOrder[]; packingSummary: string[]; mode: "live" | "fake" }> {
    const orders = await this.deps.boxsafe.listOrdersNeedingDispatch();
    const packingSummary = orders.map((o) => `${o.id}: ${o.customerName}: ${o.items.filter((i) => i.requiresShipping).map((i) => `${i.quantity} x ${i.productName}${i.variantLabel ? ` (${i.variantLabel})` : ""}`).join(", ")} [${o.fulfillmentStatus}]`);
    return { orders, packingSummary, mode: (await this.deps.boxsafe.status()).mode };
  }

  // ───────────────────────── Briefing ─────────────────────────
  async briefing(): Promise<Briefing> {
    const [connections, bs] = await Promise.all([this.connections(), this.boxsafeSummary("today").catch(() => null)]);
    const spent = this.deps.store.getMemory<number>("budget.spentAud") ?? 0;
    return composeBriefing({ now: this.clock(), connections, approvals: this.approvals.list(), alerts: this.notifications.list({ unacknowledgedOnly: true }), prospects: this.prospects.list(), quotes: this.quotes.list(), boxsafe: bs?.summary ?? null, boxsafeMode: bs ? bs.mode : "unavailable", budget: { limitAud: this.deps.config.budgetLimitAud, spentAud: spent } });
  }

  // ───────────────────────── Escalation ─────────────────────────
  /** Phone escalation only for critical events, and only reported with the provider's own record. */
  async escalateByPhone(n: Notification): Promise<{ attempted: boolean; status: string; providerRef?: string }> {
    if (n.priority !== "critical") return { attempted: false, status: "not critical" };
    if (!this.deps.config.ownerPhone) return { attempted: false, status: "owner phone not configured" };
    const st = await this.deps.telephony.status();
    if (st.state === "not_connected" || st.state === "error") return { attempted: false, status: `telephony ${st.state}: ${st.detail}` };
    const res = await this.deps.telephony.call({ to: this.deps.config.ownerPhone, reason: n.eventKey, script: `${n.title}. ${n.body}` });
    this.audit.record({ actor: "agent:notification", action: "owner.call", business: n.business === "atlas" ? "wulff_studio" : n.business, targetType: "notification", targetId: n.id, outcome: res.status === "failed" ? "failed" : st.mode === "fake" ? "simulated" : "attempted", detail: { providerRef: res.providerRef, status: res.status, mode: st.mode } });
    if (res.status === "failed") return { attempted: true, status: "failed" };
    const final = await this.deps.telephony.callStatus(res.providerRef);
    const nn = this.notifications.byEventKey(n.eventKey);
    if (nn && final.status === "completed") { nn.deliveries.push({ channel: "call", at: nowIso(), providerRef: res.providerRef }); this.deps.store.upsertDoc("notifications", nn.id, nn); }
    return { attempted: true, status: final.status, providerRef: res.providerRef };
  }

  // ───────────────────────── Scheduled run ─────────────────────────
  /** The recurring "run Wulff Studio and BoxSafe" tick. Safe to run repeatedly: everything is keyed. */
  async runScheduledChecks(): Promise<{ ran: string[]; notifications: number; failed?: string[] }> {
    const before = this.notifications.list().length;
    const ran: string[] = [];
    const failed: string[] = [];
    const task = async (name: string, fn: () => Promise<unknown>) => {
      try { await fn(); ran.push(name); }
      catch {
        failed.push(name);
        this.audit.record({ actor: "system", action: `scheduled.${name}`, business: "atlas", outcome: "failed", detail: { reason: "Connection or operation unavailable; provider details withheld" } });
        await this.notifications.emit({ eventKey: `connection:unavailable:${name}`, priority: "action_needed", business: "atlas", title: `${name} check unavailable`, body: "Check connection status. No substitute fictional results were used." });
      }
    };
    await task("boxsafe.summary", () => this.boxsafeSummary("today"));
    await task("boxsafe.reconcile", () => this.reconcileBoxSafe("today"));
    await task("boxsafe.dispatch", async () => {
      const dispatch = await this.boxsafeDispatchList();
      if (dispatch.orders.length) await this.notifications.emit({ eventKey: `boxsafe:dispatch:${dispatch.orders.map((o) => o.id).sort().join(",")}`, priority: "routine", business: "boxsafe", title: `${dispatch.orders.length} merchandise orders awaiting dispatch`, body: dispatch.packingSummary.join("\n") });
    });
    const stale = this.approvals.pending().filter((a) => this.clock().getTime() - new Date(a.requestedAt).getTime() > 2 * 86_400_000);
    for (const a of stale) await this.notifications.emit({ eventKey: `approval:stale:${a.id}`, priority: "action_needed", business: a.business, title: `Still waiting on: ${a.title}`, body: "Requested more than two days ago.", link: { type: "approval", id: a.id } });
    if (this.deps.mailbox) await task("inbox", async () => {
      const unread = await this.deps.mailbox!.listUnread();
      for (const m of unread) {
        await this.notifications.emit({ eventKey: `inbox:${m.id}`, priority: /urgent|down|broken|not working/i.test(m.subject + m.text) ? "action_needed" : "routine", business: "wulff_studio", title: `Enquiry from ${m.from}: ${m.subject}`, body: m.text.slice(0, 280) });
        await this.deps.mailbox!.markHandled(m.id);
      }
    });
    if (this.deps.config.ownerCallsEnabled) {
      for (const n of this.notifications.list({ unacknowledgedOnly: true }).filter(n => n.priority === "critical")) {
        this.jobs.enqueue("owner_call", { notificationId: n.id }, { idempotencyKey: `owner_call:${n.eventKey}`, maxAttempts: 1 });
      }
    }
    await task("jobs", () => this.jobs.runOnce());
    return { ran, notifications: this.notifications.list().length - before, failed };
  }

  private registerJobs(): void {
    this.jobs.register<{ notificationId: string }, unknown>("owner_call", async (p) => {
      const notification = this.notifications.list().find(n => n.id === p.notificationId);
      if (!notification || notification.acknowledgedAt || !this.deps.config.ownerCallsEnabled) return { attempted: false, status: "disabled or resolved" };
      return this.escalateByPhone(notification);
    });
    this.jobs.register<{ reason: string }, unknown>("owner_test_call", async (p) => {
      if (!this.deps.config.ownerPhone) throw new Error("Owner phone missing");
      return this.deps.telephony.call({ to: this.deps.config.ownerPhone, script: "Hello Brandon. This is your Atlas owner notification test. Please check your Atlas dashboard for details.", reason: p.reason });
    });
    this.jobs.register<{ quoteId: string; version: number }, { providerRef: string }>("send_quote", async (p) => {
      const r = await this.sendQuote(p.quoteId);
      return { providerRef: r.providerRef };
    });
  }

  // ───────────────────────── Command interface ─────────────────────────
  async handleCommand(text: string): Promise<CommandResult> {
    const intent = await this.intents.parse(text);
    this.audit.record({ actor: "owner", action: "command", business: "atlas", outcome: "completed", detail: { text, intent: intent.kind } });
    const lastProspectId = this.deps.store.getMemory<string>("context.lastProspectId");
    const resolveProspect = (target: string | null): Prospect | null => (target ? this.prospects.findByName(target) : null) ?? (lastProspectId ? this.prospects.get(lastProspectId) : null) ?? this.prospects.bestLead();
    try {
      switch (intent.kind) {
        case "research.lookup": {
          if (!this.deps.lookup) return { reply: "Live web lookup is not connected. No results were invented.", intent, outcome: "denied" };
          const results = await this.deps.lookup.lookup({ query: intent.query, count: 5 });
          return { reply: results.length ? results.map((r, n) => `${n + 1}. ${r.title}: ${r.description} Source: ${r.url}`).join("\n") + "\nSearch excerpts are unverified source material." : "No search results found.", intent, data: results, outcome: "completed" };
        }
        case "owner.test_call": {
          const status = await this.deps.telephony.status();
          if (status.mode !== "live" || status.state !== "connected" || !this.deps.config.ownerPhone) return { reply: "Owner calls are not connected. No call was placed.", intent, outcome: "denied" };
          const reason = `owner-requested-test:${melbourneDayRange(this.clock(), "today").from.toISOString()}`;
          const { job } = this.jobs.enqueue("owner_test_call", { reason }, { idempotencyKey: reason, maxAttempts: 1 });
          await this.jobs.runOnce();
          const updated = this.deps.store.getJobByKey(job.idempotencyKey);
          const result = (updated?.result ?? { status: "failed", detail: "Call was not confirmed. Check the job record." }) as { providerRef?: string; status: string; detail?: string };
          return { reply: result.providerRef && result.status !== "failed" ? `Call submitted to Twilio (${result.providerRef}). Answer and delivery are not yet confirmed.` : `Call not submitted: ${result.detail ?? "provider refusal"}`, intent, data: result, outcome: result.providerRef && result.status !== "failed" ? "attempted" : "denied" };
        }
        case "briefing": { const b = await this.briefing(); return { reply: b.spoken, intent, data: b, outcome: "completed" }; }
        case "status": { const c = await this.connections(); return { reply: `Atlas is online. ${c.filter((x) => x.state === "connected").length} of ${c.length} connections live: ${c.map((x) => `${x.name} ${x.state}`).join("; ")}.`, intent, data: c, outcome: "completed" }; }
        case "boxsafe.orders": { const r = await this.boxsafeSummary(intent.range); return { reply: spokenOrderSummary(r.summary) + (r.mode === "fake" ? " (fictional data)" : ""), intent, data: r, outcome: r.mode === "fake" ? "simulated" : "completed" }; }
        case "boxsafe.revenue": { const r = await this.boxsafeSummary(intent.range); return { reply: `Verified BoxSafe payments ${r.summary.range.label}: A$${r.summary.verifiedRevenueAud.toFixed(2)} from ${r.summary.paidOrders} paid orders, before Stripe fees${r.summary.refundsAud ? `, after A$${r.summary.refundsAud.toFixed(2)} refunds` : ""}. ${r.summary.pendingOrders} pending orders are excluded.${r.mode === "fake" ? " (fictional data)" : ""}`, intent, data: r.summary, outcome: r.mode === "fake" ? "simulated" : "completed" }; }
        case "boxsafe.dispatch": { const r = await this.boxsafeDispatchList(); return { reply: r.orders.length ? `${r.orders.length} orders need posting: ${r.packingSummary.join(". ")}` : "No merchandise orders are waiting for dispatch.", intent, data: r, outcome: r.mode === "fake" ? "simulated" : "completed" }; }
        case "boxsafe.reconcile": { const r = await this.reconcileBoxSafe(intent.range); return { reply: r.summary + (r.mode === "fake" ? " (fictional data)" : ""), intent, data: r, outcome: r.mode === "fake" ? "simulated" : "completed" }; }
        case "wulff.find_prospects": {
          const ps = await this.researchProspects({ area: intent.area, count: intent.count });
          const q = ps.filter((p) => p.qualification === "qualified");
          const confirmed = q.filter((p) => p.evidence.some((e) => e.status === "confirmed"));
          const best = this.prospects.bestLead();
          if (best) this.deps.store.setMemory("context.lastProspectId", best.id);
          return { reply: `I've identified ${ps.length} candidates. ${confirmed.length} have confirmed website issues worth acting on. ${best ? `The strongest opportunity is ${best.businessName}; I can prepare a concept and quote when you're ready.` : ""}`, intent, data: ps, outcome: "completed" };
        }
        case "wulff.best_lead": { const b = this.prospects.bestLead(); if (!b) return { reply: "No qualified leads yet. Say 'find five businesses around Berwick' to start research.", intent, outcome: "completed" }; this.deps.store.setMemory("context.lastProspectId", b.id); return { reply: `${b.businessName} in ${b.location}: ${b.commercialOpportunity} Evidence: ${b.evidence.map((e) => `${e.observation} (${e.status})`).join("; ")}. Suggested scope: ${b.recommendedScope}.`, intent, data: b, outcome: "completed" }; }
        case "wulff.what_would_you_charge": { const p = resolveProspect(intent.target); if (!p?.suggestedQuote) return { reply: "I need a scope first. Which business, and what pages and integrations?", intent, outcome: "completed" }; const rec = recommendQuote(p.suggestedQuote.input, { gstRegistered: this.deps.config.gstRegistered }); this.deps.store.setMemory("context.lastProspectId", p.id); return { reply: `For ${p.businessName} I'd recommend A$${rec.totalExGstAud}. ${rec.explanation}`, intent, data: rec, outcome: "completed" }; }
        case "wulff.prepare_quote": { const p = resolveProspect(intent.target); if (!p) return { reply: "Which business? I couldn't match that name.", intent, outcome: "completed" }; const { quote, approval } = this.prepareQuote(p.id); return { reply: `I've prepared a ${quote.deliverables.length}-item proposal for ${p.businessName}. Based on the required work, I recommend quoting A$${quote.priceExGstAud}. Would you like to approve that?`, intent, data: { quote, approval }, approvalId: approval.id, outcome: "awaiting_approval" }; }
        case "wulff.approve_quote": {
          const pendingQuotes = this.approvals.pending().filter((a) => a.action === "approve.quote_send");
          if (pendingQuotes.length === 0) return { reply: "There is no quote waiting for approval.", intent, outcome: "completed" };
          if (pendingQuotes.length > 1) return { reply: `There are ${pendingQuotes.length} quotes waiting: ${pendingQuotes.map((a) => a.title).join("; ")}. Which one are you approving?`, intent, data: pendingQuotes, outcome: "awaiting_approval" };
          const r = this.decideQuote("approve", this.deps.config.ownerName, { priceAud: intent.priceAud });
          if (r.revised) { this.jobs.enqueue("send_quote", { quoteId: r.revised.quote.id, version: r.revised.quote.version }, { idempotencyKey: `send_quote:${r.revised.quote.id}:v${r.revised.quote.version}` }); await this.jobs.runOnce(); const sent = this.quotes.require(r.revised.quote.id); return { reply: `Approved at A$${r.revised.quote.priceExGstAud} (revised from A$${r.quote.priceExGstAud}). ${sent.status === "sent" ? "Sent through the connected business account and I'm monitoring for a reply." : "Queued to send; waiting on the mailer."}`, intent, data: r, outcome: sent.status === "sent" ? "completed" : "attempted" }; }
          await this.jobs.runOnce();
          const sent = this.quotes.require(r.quote.id);
          return { reply: sent.status === "sent" ? `Approved. The A$${sent.priceExGstAud} proposal for ${sent.customerName} has been sent (ref ${sent.sentProviderRef}) and I'm monitoring for a response.` : `Approved. Sending is queued; it will go on the next job run.`, intent, data: r, outcome: sent.status === "sent" ? "completed" : "attempted" };
        }
        case "wulff.reject_quote": { const pq = this.approvals.pending().filter((a) => a.action === "approve.quote_send"); if (pq.length !== 1) return { reply: pq.length === 0 ? "There is no quote waiting for a decision." : `There are ${pq.length} quotes waiting; which one are you rejecting?`, intent, outcome: pq.length ? "awaiting_approval" : "completed" }; const r = this.decideQuote("reject", this.deps.config.ownerName); return { reply: `Rejected the A$${r.quote.priceExGstAud} quote for ${r.quote.customerName}. Nothing was sent.`, intent, data: r, outcome: "completed" }; }
        case "wulff.check_website": { const p = resolveProspect(intent.target); if (!p?.website) return { reply: "Which website should I check?", intent, outcome: "completed" }; const r = await this.deps.websiteChecker.check(p.website); return { reply: r.reachable ? `${p.businessName}'s site responded with HTTP ${r.status}${r.title ? ` (title: ${r.title})` : ""}. No outage detected.` : `${p.businessName}'s site is not responding: ${r.error ?? `HTTP ${r.status}`}.`, intent, data: r, outcome: "completed" }; }
        case "wulff.explain_delay": { const prj = this.projects().find((x) => !intent.target || x.name.toLowerCase().includes(intent.target)); if (!prj) return { reply: "There are no active projects yet.", intent, outcome: "completed" }; return { reply: `${prj.name} is at ${prj.stage.replace("_", " ")}. ${prj.blockers.length ? `Blockers: ${prj.blockers.join("; ")}.` : "No blockers."} Next action: ${prj.nextAction}.`, intent, data: prj, outcome: "completed" }; }
        default:
          return { reply: "I didn't catch that. Try: 'give me my morning briefing', 'what orders have come through BoxSafe', 'find five businesses around Berwick', 'prepare a quote for that gym', or 'approve the quote at $2,490'.", intent, outcome: "unknown" };
      }
    } catch (err) {
      if (err instanceof PermissionDeniedError || err instanceof ApprovalError) {
        this.audit.record({ actor: "atlas", action: "command.denied", business: "atlas", outcome: "denied", detail: { text, error: err.message } });
        return { reply: `I can't do that without the right approval: ${err.message}`, intent, outcome: "denied" };
      }
      this.audit.record({ actor: "atlas", action: "command.unavailable", business: "atlas", outcome: "failed", detail: { intent: intent.kind, reason: "Required connection or operation unavailable; provider details withheld" } });
      return { reply: err instanceof ResearchUnavailableError ? err.message : "I could not complete that operation because a required connection or service is unavailable. Check Connections and the job history. No substitute fictional result was produced.", intent, outcome: "denied" };
    }
  }
}

function renderQuoteEmail(q: Quote, cfg: AtlasConfig): string {
  const r = q.recommendation;
  return [
    `Hi ${q.customerName} team,`,
    ``,
    `Thanks for your interest in a new website. Here is the proposal (version ${q.version}).`,
    ``,
    `Deliverables:`,
    ...q.deliverables.map((d) => `  - ${d}`),
    ``,
    `Price: A$${q.priceExGstAud}${r.gstAud ? ` + A$${r.gstAud} GST` : ""}`,
    `Deposit: ${q.depositPercent}% on acceptance, balance before go-live`,
    `Timeline: about ${q.timelineWeeks} weeks from receiving your content`,
    `Not included: ${r.exclusions.join("; ")}`,
    r.dependencies.length ? `Subject to: ${r.dependencies.join("; ")}` : ``,
    ``,
    `Reply to this email to accept or ask questions.`,
    ``,
    `${cfg.ownerName}`,
    `Wulff Studio`,
    ``,
    `You are receiving this because you enquired or we identified a specific improvement to your site. Reply STOP to receive no further messages.`,
  ].filter((l) => l !== null).join("\n");
}

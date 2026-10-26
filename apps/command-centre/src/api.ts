// Typed client for the Atlas API. Every figure on screen comes from here.

export type ConnectionState = "connected" | "fake" | "not_connected" | "error";
export interface ConnectionStatus {
  name: string;
  state: ConnectionState;
  detail: string;
  checkedAt: string;
  mode: "live" | "fake";
}
export interface Status {
  atlas: { online: boolean; version: string; time: string; mode: "fake" | "live" | "mixed"; timezone: string };
  connections: ConnectionStatus[];
  background?: {
    state: "running" | "completed" | "partial" | "skipped";
    startedAt: string;
    finishedAt?: string;
    checks: BackgroundTaskState;
    research: BackgroundTaskState;
  } | null;
}

export interface BackgroundTaskState {
  state: "completed" | "partial" | "failed" | "skipped" | "blocked" | "already_ran" | "queued" | "running";
  detail: string;
  candidateCount?: number;
}

export interface OwnerSession {
  authenticated: boolean;
  configured: boolean;
  developmentBypass?: boolean;
  expiresAt?: string;
}

export const SESSION_EXPIRED_EVENT = "atlas:session-expired";

export interface Briefing {
  generatedAt: string;
  greeting: string;
  spoken: string;
  sections: { heading: string; lines: string[] }[];
  structure: { happened: string[]; completed: string[]; recommend: string[]; needsApproval: string[]; next: string[] };
  dataNotice: string;
}

export type Priority = "critical" | "action_needed" | "routine";
export type Business = "wulff_studio" | "boxsafe" | "atlas";
export interface Notification {
  id: string;
  eventKey: string;
  priority: Priority;
  business: Business;
  title: string;
  body: string;
  createdAt: string;
  deliveries: { channel: string; at: string; providerRef?: string }[];
  acknowledgedAt?: string;
  link?: { type: string; id: string };
}

export interface ApprovalCard {
  lines: { label: string; value: string }[];
  actions: ("approve" | "revise" | "reject")[];
  risk?: string;
}
export interface ApprovalRequest {
  id: string;
  action: string;
  business: Business;
  subject: string;
  version: number;
  contentHash: string;
  title: string;
  summary: string;
  card: ApprovalCard;
  payload: unknown;
  status: string;
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
}

export type EvidenceStatus = "confirmed" | "hypothesis" | "unverified";
export interface Evidence {
  observation: string;
  status: EvidenceStatus;
  sourceUrl: string;
  method: string;
  uncertainty?: string;
}
export interface Prospect {
  id: string;
  businessName: string;
  location: string;
  website: string | null;
  industry: string;
  stage: string;
  evidence: Evidence[];
  commercialOpportunity: string;
  recommendedScope: string;
  internalRecommendedPriceAud: number | null;
  qualification: string;
  contactEligibility: { lawfulBasis: string; suppressed: boolean };
  outreach: unknown[];
  fixture?: boolean;
}

export interface Quote {
  id: string;
  prospectId: string;
  customerName: string;
  version: number;
  deliverables: string[];
  priceExGstAud: number;
  status: string;
  recommendation: {
    explanation: string;
    totalExGstAud: number;
    gstAud: number;
    estimatedMarginAud: number;
    estimatedEffortHours: number;
    dependencies: string[];
    exclusions: string[];
  };
  sentAt?: string;
  sentProviderRef?: string;
  changeReason?: string;
}

export interface Project {
  id: string;
  name: string;
  stage: string;
  tasks: { title: string; status: string; owner: string }[];
  blockers: string[];
  nextAction: string;
  timeline: { at: string; note: string }[];
}

export interface OrderItem {
  productName: string;
  category: string;
  quantity: number;
  variantLabel: string | null;
  requiresShipping: boolean;
  leagueCode?: string | null;
}
export interface Order {
  id: string;
  createdAt: string;
  status: string;
  paidAt: string | null;
  fulfillmentStatus: string;
  trackingNumber: string | null;
  carrier: string | null;
  customerName: string;
  total: number;
  items: OrderItem[];
}
export interface ByCategory {
  registration: number;
  course: number;
  merchandise: number;
  ticket: number;
  ppv: number;
  other: number;
}
export interface OrderSummary {
  range: { label: string; from?: string; to?: string };
  paidOrders: number;
  byCategory: ByCategory;
  verifiedRevenueAud: number;
  refundsAud: number;
  pendingOrders: number;
  failedOrders: number;
  needsDispatch: Order[];
  attention: { orderId: string; reason: string }[];
  byLeague: Record<string, number>;
}
export type Range = "today" | "week" | "month";
export interface BoxSafeOrders {
  summary: OrderSummary;
  orders: Order[];
  mode: "live" | "fake";
  spoken: string;
}
export interface Dispatch {
  orders: Order[];
  packingSummary: string[];
}
export interface Reconciliation {
  matched: { orderId: string; paymentIntentId: string }[];
  ordersWithoutPayment: { orderId: string; reason: string }[];
  paymentsWithoutOrder: { paymentIntentId: string; amountAud: number }[];
  amountMismatches: { orderId: string; paymentIntentId: string; orderTotal: number; paymentAmount: number }[];
  pendingOrdersWithSucceededPayment: { orderId: string; paymentIntentId: string }[];
  summary: string;
  mode: "live" | "fake";
}
export interface FinanceRange {
  paidOrders: number;
  verifiedRevenueAud: number;
  refundsAud: number;
  pendingOrders: number;
  byCategory: ByCategory;
  needsDispatch: Order[];
  attention: { orderId: string; reason: string }[];
}
export interface Finance {
  boxsafe: { mode: "live" | "fake"; today: FinanceRange; week: FinanceRange; month: FinanceRange };
  wulffStudio: { verifiedCollectedAud: number; quotesSentAud: number; quotesPendingApprovalAud: number; note: string };
  budget: { limitAud: number; spentAud: number; remainingAud: number };
}
export interface Job {
  id: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  updatedAt: string;
}
export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  business: string;
  outcome: string;
  targetType?: string;
  targetId?: string;
}
export interface CommandResult {
  reply: string;
  intent: { kind: string };
  outcome: string;
  approvalId?: string;
  data?: unknown;
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/") && typeof window !== "undefined") {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    const msg =
      body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return body as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });

export const api = {
  session: () => get<OwnerSession>("/auth/session"),
  login: (accessKey: string) => post<OwnerSession>("/auth/login", { accessKey }),
  logout: () => post<{ authenticated: false }>("/auth/logout", {}),
  status: () => get<Status>("/status"),
  briefing: () => get<Briefing>("/briefing"),
  alerts: (all = false) => get<Notification[]>(`/alerts${all ? "?all=1" : ""}`),
  ackAlert: (id: string) => post<unknown>(`/alerts/${encodeURIComponent(id)}/ack`),
  approvals: (all = false) => get<ApprovalRequest[]>(`/approvals${all ? "?status=all" : ""}`),
  decide: (id: string, body: { decision: "approve" | "reject" | "revise"; note?: string; priceAud?: number | null }) =>
    post<{ ok: boolean; result?: unknown; quote?: Quote }>(`/approvals/${encodeURIComponent(id)}/decide`, body),
  prospects: () => get<Prospect[]>("/prospects"),
  quotes: () => get<Quote[]>("/quotes"),
  projects: () => get<Project[]>("/projects"),
  boxsafeOrders: (range: Range) => get<BoxSafeOrders>(`/boxsafe/orders?range=${range}`),
  boxsafeDispatch: () => get<Dispatch>("/boxsafe/dispatch"),
  boxsafeReconcile: (range: Range) => get<Reconciliation>(`/boxsafe/reconcile?range=${range}`),
  finance: () => get<Finance>("/finance"),
  jobs: () => get<Job[]>("/jobs"),
  audit: (limit = 50) => get<AuditEntry[]>(`/audit?limit=${limit}`),
  command: (text: string) => post<CommandResult>("/command", { text }),
  runChecks: () => post<{ ran: string[]; notifications: number }>("/run-checks"),
  seed: () => post<unknown>("/dev/seed"),
};

export const aud = (n: number | null | undefined, opts: { cents?: boolean } = {}) => {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  }).format(n);
};

export const melbourneTime = (d: Date | string = new Date()) =>
  new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(typeof d === "string" ? new Date(d) : d);

export const melbourneDate = (d: Date | string = new Date()) =>
  new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(typeof d === "string" ? new Date(d) : d);

export const relTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

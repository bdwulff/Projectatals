import type { Store } from "./store.js";
import type { AuditLog } from "./audit.js";
import type { Business } from "./audit.js";
import type { ActionKind } from "./permissions.js";
import { contentHash, newId, nowIso } from "./ids.js";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "revise_requested" | "superseded" | "consumed";

/**
 * An approval is bound to an exact content hash of the payload. If the payload
 * changes in any way (price, scope, recipient), a new approval is required and
 * the old one is marked superseded. This implements section 9 "Each revision
 * requires a new approval" and section 3 "must not treat earlier approval as
 * authorisation for a changed quote".
 */
export interface ApprovalRequest<T = unknown> {
  id: string;
  action: ActionKind;
  business: Business;
  /** Stable subject key, e.g. quote:<quoteId>. All versions share the subject. */
  subject: string;
  version: number;
  contentHash: string;
  title: string;
  summary: string;
  /** Exact decision card contents shown to the owner. */
  card: ApprovalCard;
  payload: T;
  status: ApprovalStatus;
  requestedBy: string;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
  consumedAt?: string;
}

export interface ApprovalCard {
  /** Short lines rendered on the mobile card, in display order. */
  lines: { label: string; value: string }[];
  actions: ("approve" | "revise" | "reject")[];
  risk?: string;
}

export class ApprovalError extends Error {
  constructor(message: string, public readonly code: "NOT_FOUND" | "NOT_PENDING" | "NOT_APPROVED" | "HASH_MISMATCH" | "ALREADY_CONSUMED") {
    super(message);
    this.name = "ApprovalError";
  }
}

const COLLECTION = "approvals";

export class ApprovalService {
  constructor(private readonly store: Store, private readonly audit: AuditLog) {}

  request<T>(input: {
    action: ActionKind;
    business: Business;
    subject: string;
    title: string;
    summary: string;
    card: ApprovalCard;
    payload: T;
    requestedBy?: string;
  }): ApprovalRequest<T> {
    const hash = contentHash(input.payload);
    const priorVersions = this.bySubject(input.subject);
    // Idempotent: identical pending request for same subject+hash is returned, not duplicated.
    const identical = priorVersions.find((a) => a.contentHash === hash && (a.status === "pending" || a.status === "approved"));
    if (identical) return identical as ApprovalRequest<T>;

    for (const prior of priorVersions) {
      if (prior.status === "pending" || prior.status === "approved" || prior.status === "revise_requested") {
        prior.status = "superseded";
        this.store.upsertDoc(COLLECTION, prior.id, prior);
        this.audit.record({ actor: "atlas", action: "approval.superseded", business: input.business, targetType: "approval", targetId: prior.id, outcome: "completed", detail: { subject: input.subject, reason: "new version requested" } });
      }
    }
    const version = priorVersions.length + 1;
    const req: ApprovalRequest<T> = {
      id: newId("apr"),
      action: input.action,
      business: input.business,
      subject: input.subject,
      version,
      contentHash: hash,
      title: input.title,
      summary: input.summary,
      card: input.card,
      payload: input.payload,
      status: "pending",
      requestedBy: input.requestedBy ?? "atlas",
      requestedAt: nowIso(),
    };
    this.store.upsertDoc(COLLECTION, req.id, req);
    this.audit.record({ actor: "atlas", action: "approval.requested", business: input.business, targetType: "approval", targetId: req.id, outcome: "awaiting_approval", detail: { subject: req.subject, version, contentHash: hash, title: req.title } });
    return req;
  }

  decide(id: string, decision: "approve" | "reject" | "revise", by: string, note?: string): ApprovalRequest {
    const req = this.get(id);
    if (!req) throw new ApprovalError(`Approval ${id} not found`, "NOT_FOUND");
    if (req.status !== "pending") throw new ApprovalError(`Approval ${id} is ${req.status}, not pending`, "NOT_PENDING");
    req.status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "revise_requested";
    req.decidedBy = by;
    req.decidedAt = nowIso();
    req.decisionNote = note;
    this.store.upsertDoc(COLLECTION, req.id, req);
    this.audit.record({ actor: "owner", action: `approval.${req.status}`, business: req.business, targetType: "approval", targetId: req.id, outcome: "completed", detail: { subject: req.subject, version: req.version, contentHash: req.contentHash, by, note } });
    return req;
  }

  /**
   * Verify that the exact payload about to be executed matches an approved,
   * unconsumed approval. Consumes it so the same approval cannot authorise two sends.
   */
  consume(subject: string, payload: unknown): ApprovalRequest {
    const hash = contentHash(payload);
    const candidates = this.bySubject(subject);
    const approved = candidates.find((a) => a.status === "approved");
    if (!approved) {
      const consumed = candidates.find((a) => a.status === "consumed" && a.contentHash === hash);
      if (consumed) throw new ApprovalError(`Approval for ${subject} was already used`, "ALREADY_CONSUMED");
      throw new ApprovalError(`No approved version for ${subject}`, "NOT_APPROVED");
    }
    if (approved.contentHash !== hash) {
      throw new ApprovalError(`Payload for ${subject} differs from the approved version ${approved.version}; a new approval is required`, "HASH_MISMATCH");
    }
    approved.status = "consumed";
    approved.consumedAt = nowIso();
    this.store.upsertDoc(COLLECTION, approved.id, approved);
    this.audit.record({ actor: "atlas", action: "approval.consumed", business: approved.business, targetType: "approval", targetId: approved.id, outcome: "completed", detail: { subject, version: approved.version } });
    return approved;
  }

  get(id: string): ApprovalRequest | null {
    return this.store.getDoc<ApprovalRequest>(COLLECTION, id)?.doc ?? null;
  }

  bySubject(subject: string): ApprovalRequest[] {
    return this.list().filter((a) => a.subject === subject).sort((a, b) => a.version - b.version);
  }

  list(status?: ApprovalStatus): ApprovalRequest[] {
    const all = this.store.listDocs<ApprovalRequest>(COLLECTION).map((d) => d.doc);
    return status ? all.filter((a) => a.status === status) : all;
  }

  pending(): ApprovalRequest[] {
    return this.list("pending").sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  }
}

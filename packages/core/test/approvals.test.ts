import { describe, it, expect } from "vitest";
import { SqliteStore, AuditLog, ApprovalService, ApprovalError } from "../src/index.js";

function setup() {
  const store = new SqliteStore(":memory:");
  const audit = new AuditLog(store);
  return { store, audit, approvals: new ApprovalService(store, audit) };
}
const card = { lines: [], actions: ["approve", "revise", "reject"] as ("approve" | "revise" | "reject")[] };

describe("ApprovalService", () => {
  it("binds approval to the exact payload hash and consumes it once", () => {
    const { approvals } = setup();
    const a = approvals.request({ action: "approve.quote_send", business: "wulff_studio", subject: "quote:p1", title: "Q", summary: "", card, payload: { price: 2490 } });
    expect(a.status).toBe("pending");
    approvals.decide(a.id, "approve", "Brandon");
    expect(() => approvals.consume("quote:p1", { price: 2499 })).toThrowError(/differs from the approved version/);
    const used = approvals.consume("quote:p1", { price: 2490 });
    expect(used.status).toBe("consumed");
    expect(() => approvals.consume("quote:p1", { price: 2490 })).toThrowError(ApprovalError);
  });

  it("supersedes earlier versions when a new version of the same subject is requested", () => {
    const { approvals } = setup();
    const v1 = approvals.request({ action: "approve.quote_send", business: "wulff_studio", subject: "quote:p1", title: "Q", summary: "", card, payload: { price: 2490 } });
    approvals.decide(v1.id, "approve", "Brandon");
    const v2 = approvals.request({ action: "approve.quote_send", business: "wulff_studio", subject: "quote:p1", title: "Q", summary: "", card, payload: { price: 3190 } });
    expect(v2.version).toBe(2);
    expect(approvals.get(v1.id)?.status).toBe("superseded");
    expect(() => approvals.consume("quote:p1", { price: 2490 })).toThrowError(/No approved version/);
  });

  it("is idempotent for an identical pending request", () => {
    const { approvals } = setup();
    const a = approvals.request({ action: "approve.spend", business: "wulff_studio", subject: "spend:domain", title: "Buy domain", summary: "", card, payload: { aud: 25 } });
    const b = approvals.request({ action: "approve.spend", business: "wulff_studio", subject: "spend:domain", title: "Buy domain", summary: "", card, payload: { aud: 25 } });
    expect(b.id).toBe(a.id);
    expect(approvals.pending()).toHaveLength(1);
  });

  it("refuses to decide a non-pending approval", () => {
    const { approvals } = setup();
    const a = approvals.request({ action: "approve.spend", business: "boxsafe", subject: "s", title: "t", summary: "", card, payload: 1 });
    approvals.decide(a.id, "reject", "Brandon");
    expect(() => approvals.decide(a.id, "approve", "Brandon")).toThrowError(/not pending/);
  });
});

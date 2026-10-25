import { describe, it, expect } from "vitest";
import { recommendQuote, summariseOrders, reconcile, melbourneDayRange, canTransition, isCustomerStage } from "../src/index.js";
import { fictionalBoxSafeOrders, fictionalStripePayments } from "../src/adapters/fake/index.js";

describe("recommendQuote", () => {
  it("picks the Local package for five pages and explains the number", () => {
    const r = recommendQuote({ pages: 5, designComplexity: "standard", contentPreparation: "client_supplied", integrations: [], technicalRisk: "low" });
    expect(r.packageKey).toBe("local");
    expect(r.totalExGstAud).toBe(2490);
    expect(r.gstAud).toBe(0);
    expect(r.gstStatus).toBe("not_registered_unconfirmed");
    expect(r.explanation).toContain("Local package");
  });
  it("adds a booking API integration and records the unconfirmed provider as a dependency", () => {
    const r = recommendQuote({ pages: 5, designComplexity: "standard", contentPreparation: "client_supplied", integrations: [{ name: "Online booking", kind: "booking_api", providerConfirmed: false }], technicalRisk: "low" });
    expect(r.totalExGstAud).toBe(3190);
    expect(r.dependencies[0]).toMatch(/Confirm Online booking provider/);
  });
  it("applies GST only when registered", () => {
    const r = recommendQuote({ pages: 1, designComplexity: "standard", contentPreparation: "client_supplied", integrations: [], technicalRisk: "low" }, { gstRegistered: true });
    expect(r.gstAud).toBe(149);
    expect(r.totalIncGstAud).toBe(1639);
  });
});

describe("pipeline", () => {
  it("only counts customers from accepted onwards and blocks skipping stages", () => {
    expect(isCustomerStage("quote_sent")).toBe(false);
    expect(isCustomerStage("accepted")).toBe(true);
    expect(canTransition("research", "quote_sent")).toBe(false);
    expect(canTransition("approval_pending", "quote_sent")).toBe(true);
  });
});

describe("BoxSafe order rules", () => {
  const now = new Date();
  const orders = fictionalBoxSafeOrders(now);
  it("counts only paid orders as verified revenue and excludes pending, refunded and failed", () => {
    const s = summariseOrders(orders, { from: new Date(now.getTime() - 86_400_000), to: new Date(now.getTime() + 1000), label: "last 24h" });
    // paid in last 24h: 001 (95), 002 (77.5), 003 (142.5), 004 (149), 008 (95)
    expect(s.paidOrders).toBe(5);
    expect(s.verifiedRevenueAud).toBe(559);
    expect(s.pendingOrders).toBe(1);
    expect(s.byCategory.registration).toBe(2);
    expect(s.byCategory.merchandise).toBe(2);
    expect(s.byCategory.course).toBe(1);
    expect(s.byLeague.VABL).toBe(190);
    expect(s.needsDispatch.map((o) => o.id).sort()).toEqual(["ord_fx_002", "ord_fx_003"]);
    expect(s.attention.some((a) => a.orderId === "ord_fx_008" && /no Stripe reference/.test(a.reason))).toBe(true);
    expect(s.attention.some((a) => a.orderId === "ord_fx_007" && /without a tracking number/.test(a.reason))).toBe(true);
  });
  it("melbourneDayRange returns a 24h window for today", () => {
    const r = melbourneDayRange(now, "today");
    expect(r.to.getTime() - r.from.getTime()).toBe(86_400_000);
    expect(now.getTime()).toBeGreaterThanOrEqual(r.from.getTime());
    expect(now.getTime()).toBeLessThan(r.to.getTime());
  });
  it("reconciles orders against Stripe and surfaces each class of discrepancy", () => {
    const r = reconcile(orders, fictionalStripePayments(now));
    expect(r.matched.length).toBe(6); // 001,002,003,004,006 (refunded, amounts agree),007
    expect(r.ordersWithoutPayment.map((x) => x.orderId)).toEqual(["ord_fx_008"]);
    expect(r.pendingOrdersWithSucceededPayment.map((x) => x.orderId)).toEqual(["ord_fx_005"]);
    expect(r.paymentsWithoutOrder.map((x) => x.paymentIntentId)).toEqual(["pi_fx_999"]);
    expect(r.amountMismatches).toHaveLength(0);
    expect(r.summary).toMatch(/3 issues/);
  });
});

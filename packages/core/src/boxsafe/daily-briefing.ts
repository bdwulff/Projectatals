import type { BoxSafeGateway, StripeGateway } from "../adapters/types.js";
import { melbourneDayRange, summariseOrders, type BoxSafeOrder, type OrderSummary } from "./orders.js";
import { reconcile } from "./reconcile.js";

/** The operational projection deliberately excludes all customer and identity fields. */
export function projectBriefingOrder(o: BoxSafeOrder) {
  return {
    orderId: o.id, createdAt: o.createdAt, paidAt: o.paidAt, status: o.status,
    fulfilmentStatus: o.fulfillmentStatus, totalAud: o.total, refundedAud: o.refundedAmount ?? 0,
    items: o.items.map((i) => ({ category: i.category, quantity: i.quantity, requiresShipping: i.requiresShipping })),
  };
}

function projectSummary(s: OrderSummary) {
  return {
    range: s.range, paidOrders: s.paidOrders, byCategory: s.byCategory,
    recordedNetPaidAud: s.verifiedRevenueAud, recordedRefundsAud: s.refundsAud,
    pendingOrders: s.pendingOrders, failedOrders: s.failedOrders,
    awaitingDispatch: s.needsDispatch.length, attention: s.attention,
  };
}

/** Complete read-only briefing. Mixed sources and failed reads never produce a financial result. */
export async function buildDailyBoxSafeBriefing(input: {
  boxsafe: BoxSafeGateway;
  stripe: StripeGateway;
  now: Date;
  mode: "fake" | "live";
  range?: "today" | "week" | "month";
}) {
  const { boxsafe, stripe, now, mode } = input;
  const connections = await Promise.all([boxsafe.status(), stripe.status()]);
  const expected = mode === "fake" ? "fake" : "connected";
  if (connections.some((c) => c.mode !== mode || c.state !== expected)) {
    throw new Error("BoxSafe briefing unavailable: both read connections must be available in the requested mode. No financial result was produced.");
  }
  const range = melbourneDayRange(now, input.range ?? "today");
  const [orders, payments, dispatch] = await Promise.all([
    boxsafe.listOrders(range), stripe.listPayments(range), boxsafe.listOrdersNeedingDispatch(),
  ]);
  const summary = summariseOrders(orders, range);
  summary.needsDispatch = dispatch;
  const reconciliation = reconcile(orders, payments);
  const stripeRecordedNetAud = Math.round(payments.filter(p => p.status === "succeeded" || p.status === "refunded").reduce((sum, p) => sum + p.amountAud - (p.refundedAud ?? 0), 0) * 100) / 100;
  const dataNotice = mode === "fake"
    ? "FICTIONAL TEST DATA. No live BoxSafe or Stripe account was queried."
    : "Live read-only data. Connection status verifies read access, not complete platform health.";
  return {
    business: "boxsafe" as const, mode, fixture: mode === "fake", generatedAt: now.toISOString(),
    timezone: "Australia/Melbourne" as const, currency: "AUD" as const, dataNotice,
    summary: { ...projectSummary(summary), stripeRecordedNetAud }, reconciliation,
    dispatch: { awaitingDispatch: dispatch.length, orders: dispatch.slice(0, 25).map(projectBriefingOrder), truncated: dispatch.length > 25 },
    spoken: [dataNotice, `BoxSafe records ${summary.paidOrders} paid orders ${range.label}, net A$${summary.verifiedRevenueAud.toFixed(2)} after recorded refunds and before Stripe fees.`,
      `${dispatch.length} merchandise orders await dispatch. ${summary.pendingOrders} pending orders are excluded from income.`, reconciliation.summary,
      `Stripe payment records created in the queried window total A$${stripeRecordedNetAud.toFixed(2)} after recorded refunds, before fees.`,
      "Registrations, licences and full platform health are not connected. No changes were made."].join(" "),
    speech: { audioProduced: false as const, delivery: "Text ready for browser speech synthesis or iOS Speak Text; no voice service was called." },
    coverage: "Reconciliation compares the gateway's order/payment window. Payment creation and settlement dates can differ; missing matches require review, never automatic repairs. Stripe fees and bank payouts are not reconciled. BoxSafe has no refund-amount column in the inspected schema; database net totals alone cannot verify partial Stripe refunds.",
  };
}

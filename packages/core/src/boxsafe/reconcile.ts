import type { BoxSafeOrder } from "./orders.js";

export interface StripePayment {
  paymentIntentId: string;
  checkoutSessionId?: string | null;
  amountAud: number;
  status: "succeeded" | "processing" | "requires_payment_method" | "canceled" | "refunded";
  createdAt: string;
  refundedAud?: number;
  metadata?: Record<string, string>;
}

export interface ReconciliationResult {
  matched: { orderId: string; paymentIntentId: string }[];
  ordersWithoutPayment: { orderId: string; reason: string }[];
  paymentsWithoutOrder: { paymentIntentId: string; amountAud: number }[];
  amountMismatches: { orderId: string; paymentIntentId: string; orderTotal: number; paymentAmount: number }[];
  pendingOrdersWithSucceededPayment: { orderId: string; paymentIntentId: string }[];
  summary: string;
}

/** Deterministic reconciliation of BoxSafe orders against Stripe payments. Read-only. */
export function reconcile(orders: BoxSafeOrder[], payments: StripePayment[]): ReconciliationResult {
  const byIntent = new Map(payments.map((p) => [p.paymentIntentId, p]));
  const bySession = new Map(payments.filter((p) => p.checkoutSessionId).map((p) => [p.checkoutSessionId as string, p]));
  const usedIntents = new Set<string>();
  const res: ReconciliationResult = { matched: [], ordersWithoutPayment: [], paymentsWithoutOrder: [], amountMismatches: [], pendingOrdersWithSucceededPayment: [], summary: "" };

  for (const o of orders) {
    if (o.status === "cancelled" || o.status === "failed") continue;
    const p = (o.stripePaymentIntentId && byIntent.get(o.stripePaymentIntentId)) || (o.stripeCheckoutSessionId && bySession.get(o.stripeCheckoutSessionId)) || null;
    if (!p) {
      if (o.status === "paid") res.ordersWithoutPayment.push({ orderId: o.id, reason: "Order is paid but no Stripe payment found" });
      continue;
    }
    usedIntents.add(p.paymentIntentId);
    if (o.status === "pending" && p.status === "succeeded") res.pendingOrdersWithSucceededPayment.push({ orderId: o.id, paymentIntentId: p.paymentIntentId });
    if (Math.abs(p.amountAud - o.total) > 0.005) res.amountMismatches.push({ orderId: o.id, paymentIntentId: p.paymentIntentId, orderTotal: o.total, paymentAmount: p.amountAud });
    else if (o.status === "paid" || o.status === "partially_refunded" || o.status === "refunded") res.matched.push({ orderId: o.id, paymentIntentId: p.paymentIntentId });
  }
  for (const p of payments) {
    if (p.status === "succeeded" && !usedIntents.has(p.paymentIntentId)) res.paymentsWithoutOrder.push({ paymentIntentId: p.paymentIntentId, amountAud: p.amountAud });
  }
  const issues = res.ordersWithoutPayment.length + res.paymentsWithoutOrder.length + res.amountMismatches.length + res.pendingOrdersWithSucceededPayment.length;
  res.summary = issues === 0
    ? `All ${res.matched.length} paid orders reconcile with Stripe.`
    : `${res.matched.length} orders reconcile. ${issues} issue${issues === 1 ? "" : "s"}: ${res.ordersWithoutPayment.length} paid without Stripe payment, ${res.paymentsWithoutOrder.length} Stripe payments with no order, ${res.amountMismatches.length} amount mismatches, ${res.pendingOrdersWithSucceededPayment.length} pending orders with a successful payment (webhook may have been missed).`;
  return res;
}

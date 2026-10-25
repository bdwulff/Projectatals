/**
 * BoxSafe order model. Field names mirror the real `public.orders` /
 * `order_items` / `products` tables in bdwulff/boxsafe (Supabase) so a live
 * adapter is a straight projection.
 */
export type OrderCategory = "registration" | "course" | "merchandise" | "ticket" | "ppv" | "other";

export interface BoxSafeOrderItem {
  productId: string | null;
  productName: string;
  category: OrderCategory;
  quantity: number;
  variantLabel: string | null;
  unitPrice: number;
  totalPrice: number;
  requiresShipping: boolean;
  leagueCode?: string | null; // e.g. VABL, WKA, ANABA
}

export interface BoxSafeOrder {
  id: string;
  createdAt: string;
  /** `orders.status`: pending | paid | refunded | cancelled | failed */
  status: "pending" | "paid" | "refunded" | "partially_refunded" | "cancelled" | "failed";
  paidAt: string | null;
  /** `orders.fulfillment_status` */
  fulfillmentStatus: "unfulfilled" | "picked" | "packed" | "shipped" | "delivered" | "not_required";
  shippedAt: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  customerName: string;
  customerEmail: string;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  stripePaymentIntentId: string | null;
  stripeCheckoutSessionId: string | null;
  items: BoxSafeOrderItem[];
  refundedAmount?: number;
}

export interface OrderSummary {
  range: { from: string; to: string; label: string };
  paidOrders: number;
  byCategory: Record<OrderCategory, number>;
  /** Verified collected payments: paid orders with paid_at in range, net of recorded refunds. Excludes pending/failed. */
  verifiedRevenueAud: number;
  refundsAud: number;
  pendingOrders: number;
  failedOrders: number;
  needsDispatch: BoxSafeOrder[];
  attention: { orderId: string; reason: string }[];
  byLeague: Record<string, number>;
}

export function inRange(iso: string | null, from: Date, to: Date): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t < to.getTime();
}

export function melbourneDayRange(now: Date, label: "today" | "week" | "month"): { from: Date; to: Date; label: string } {
  // Melbourne local date boundaries. Intl gives the offset for the instant without a tz library.
  const fmt = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const localMidnightUtcGuess = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const localNowUtcGuess = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  const offsetMs = localNowUtcGuess - now.getTime();
  const startOfToday = new Date(localMidnightUtcGuess - offsetMs);
  const dayMs = 86_400_000;
  if (label === "today") return { from: startOfToday, to: new Date(startOfToday.getTime() + dayMs), label: "today" };
  if (label === "week") {
    const dow = (new Date(localMidnightUtcGuess).getUTCDay() + 6) % 7; // Monday = 0
    const from = new Date(startOfToday.getTime() - dow * dayMs);
    return { from, to: new Date(startOfToday.getTime() + dayMs), label: "this week" };
  }
  const from = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, 1) - offsetMs);
  return { from, to: new Date(startOfToday.getTime() + dayMs), label: "this month" };
}

export function summariseOrders(orders: BoxSafeOrder[], range: { from: Date; to: Date; label: string }): OrderSummary {
  const byCategory: Record<OrderCategory, number> = { registration: 0, course: 0, merchandise: 0, ticket: 0, ppv: 0, other: 0 };
  const byLeague: Record<string, number> = {};
  let verified = 0;
  let refunds = 0;
  let paidOrders = 0;
  let pending = 0;
  let failed = 0;
  const attention: OrderSummary["attention"] = [];
  const seenIntent = new Map<string, string>();

  for (const o of orders) {
    const paidInRange = (o.status === "paid" || o.status === "partially_refunded") && inRange(o.paidAt, range.from, range.to);
    if (paidInRange) {
      paidOrders += 1;
      verified += o.total - (o.refundedAmount ?? 0);
      refunds += o.refundedAmount ?? 0;
      const cats = new Set(o.items.map((i) => i.category));
      for (const c of cats) byCategory[c] += 1;
      for (const i of o.items) if (i.leagueCode) byLeague[i.leagueCode] = (byLeague[i.leagueCode] ?? 0) + i.totalPrice;
    }
    if (o.status === "refunded" && inRange(o.paidAt, range.from, range.to)) refunds += o.total;
    if (o.status === "pending" && inRange(o.createdAt, range.from, range.to)) pending += 1;
    if (o.status === "failed" && inRange(o.createdAt, range.from, range.to)) failed += 1;
    if (o.status === "paid" && !o.stripePaymentIntentId && !o.stripeCheckoutSessionId) attention.push({ orderId: o.id, reason: "Marked paid but has no Stripe reference" });
    if (o.stripePaymentIntentId) {
      const prior = seenIntent.get(o.stripePaymentIntentId);
      if (prior) attention.push({ orderId: o.id, reason: `Shares Stripe payment intent with order ${prior} (possible duplicate)` });
      else seenIntent.set(o.stripePaymentIntentId, o.id);
    }
    if (o.fulfillmentStatus === "shipped" && !o.trackingNumber) attention.push({ orderId: o.id, reason: "Marked shipped without a tracking number" });
  }
  const needsDispatch = orders.filter((o) => o.status === "paid" && o.items.some((i) => i.requiresShipping) && ["unfulfilled", "picked", "packed"].includes(o.fulfillmentStatus));
  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
    paidOrders,
    byCategory,
    verifiedRevenueAud: round2(verified),
    refundsAud: round2(refunds),
    pendingOrders: pending,
    failedOrders: failed,
    needsDispatch,
    attention,
    byLeague,
  };
}

export function spokenOrderSummary(s: OrderSummary): string {
  const cats = Object.entries(s.byCategory).filter(([, n]) => n > 0).map(([c, n]) => `${n} ${c === "merchandise" ? "merchandise purchase" : c}${n === 1 ? "" : "s"}`);
  const parts = [`BoxSafe received ${s.paidOrders} paid order${s.paidOrders === 1 ? "" : "s"} ${s.range.label}${cats.length ? `, including ${cats.join(", ")}` : ""}.`];
  if (s.needsDispatch.length) parts.push(`${s.needsDispatch.length} merchandise order${s.needsDispatch.length === 1 ? "" : "s"} still need${s.needsDispatch.length === 1 ? "s" : ""} dispatch.`);
  parts.push(`Total verified payments were A$${s.verifiedRevenueAud.toFixed(2)}${s.refundsAud ? ` after A$${s.refundsAud.toFixed(2)} in refunds` : ""}, before Stripe fees.`);
  if (s.pendingOrders) parts.push(`${s.pendingOrders} order${s.pendingOrders === 1 ? " is" : "s are"} still pending payment and not counted.`);
  if (s.attention.length) parts.push(`${s.attention.length} order${s.attention.length === 1 ? "" : "s"} need${s.attention.length === 1 ? "s" : ""} your attention.`);
  return parts.join(" ");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

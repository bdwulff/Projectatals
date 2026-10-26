/**
 * Live adapters. Each one is gated on environment configuration and reports
 * `not_connected` honestly when credentials are absent. They are deliberately
 * thin (fetch-based) so the first real connection needs no SDK install.
 *
 * None of these have been exercised against production yet; see
 * docs/CAPABILITIES-REGISTER.md.
 */
import type { BoxSafeGateway, ConnectionStatus, Mailer, OutboundEmail, StripeGateway, Telephony, WebsiteChecker } from "../types.js";
import type { BoxSafeOrder, BoxSafeOrderItem, OrderCategory } from "../../boxsafe/orders.js";
import type { StripePayment } from "../../boxsafe/reconcile.js";
import { nowIso } from "../../ids.js";

function status(name: string, state: ConnectionStatus["state"], detail: string): ConnectionStatus {
  return { name, state, detail, checkedAt: nowIso(), mode: "live" };
}

export class NotConnectedError extends Error {
  constructor(adapter: string, hint: string) {
    super(`${adapter} is not connected: ${hint}`);
    this.name = "NotConnectedError";
  }
}

/** SELECT-only access; the host must independently verify the database role's scope. */
export class SupabaseBoxSafeGateway implements BoxSafeGateway {
  constructor(private readonly env: { url?: string; key?: string } = { url: process.env.BOXSAFE_SUPABASE_URL, key: process.env.BOXSAFE_SUPABASE_READ_KEY }) {}
  private configured() {
    try { const u = new URL(this.env.url ?? ""); return Boolean(this.env.key && u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash && u.pathname === "/" && u.hostname.endsWith(".supabase.co")); }
    catch { return false; }
  }
  private headers() { return { apikey: this.env.key as string, Authorization: `Bearer ${this.env.key}`, Accept: "application/json" }; }
  async status() {
    if (!this.configured()) return status("BoxSafe (Supabase)", "not_connected", "A reviewed SELECT-only key and HTTPS Supabase project URL are required.");
    try {
      const r = await fetch(`${this.env.url}/rest/v1/orders?select=id&limit=1`, { headers: this.headers(), redirect: "error", signal: AbortSignal.timeout(10_000) });
      return r.ok ? status("BoxSafe (Supabase)", "connected", "Order read access verified; this does not verify all platform health.") : status("BoxSafe (Supabase)", "error", `Order read returned HTTP ${r.status}.`);
    } catch { return status("BoxSafe (Supabase)", "error", "Order read verification failed; provider details withheld."); }
  }
  private async read(filters: Record<string, string>): Promise<BoxSafeOrder[]> {
    if (!this.configured()) throw new NotConnectedError("BoxSafe", "missing or invalid reviewed read connection");
    const select = "id,created_at,status,paid_at,fulfillment_status,shipped_at,tracking_number,carrier,guest_name,guest_email,subtotal,shipping,tax,total,stripe_payment_intent_id,stripe_checkout_session_id,user_id,order_items(product_id,quantity,variant_label,unit_price,total_price,products(name,category,requires_shipping,league_id))";
    const orders: BoxSafeOrder[] = [];
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ select, ...filters, order: "created_at.desc,id.desc", limit: "250", offset: String(page * 250) });
      const r = await fetch(`${this.env.url}/rest/v1/orders?${query}`, { headers: this.headers(), redirect: "error", signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`BoxSafe order read failed: HTTP ${r.status}`);
      const rows: unknown = await r.json();
      if (!Array.isArray(rows)) throw new Error("BoxSafe order response was invalid");
      orders.push(...rows.map(projectOrder));
      if (rows.length < 250) return orders;
    }
    throw new Error("BoxSafe order safety limit reached; no partial financial report was produced");
  }
  async listOrders({ from, to }: { from: Date; to: Date }): Promise<BoxSafeOrder[]> {
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) throw new Error("Invalid order range");
    return this.read({ or: `(and(created_at.gte.${from.toISOString()},created_at.lt.${to.toISOString()}),and(paid_at.gte.${from.toISOString()},paid_at.lt.${to.toISOString()}))` });
  }
  async listOrdersNeedingDispatch(): Promise<BoxSafeOrder[]> {
    return (await this.read({ status: "in.(paid,completed,processing,shipped,delivered)", paid_at: "not.is.null", fulfillment_status: "in.(unfulfilled,picked,packed)" })).filter(o => o.items.some(i => i.requiresShipping));
  }
  async recordTracking(): Promise<{ ok: boolean; detail: string }> {
    return { ok: false, detail: "Live writes are disabled. A reviewed authenticated operation and exact owner approval are required." };
  }
}

function mapCategory(raw: string | null | undefined): OrderCategory {
  const c = (raw ?? "").toLowerCase();
  if (c.includes("regist") || c.includes("licen")) return "registration";
  if (c.includes("course")) return "course";
  if (c.includes("ticket")) return "ticket";
  if (c.includes("ppv") || c.includes("stream")) return "ppv";
  if (c.includes("merch") || c.includes("uniform") || c.includes("apparel") || c.includes("gear") || c.includes("shop")) return "merchandise";
  return "other";
}

export function projectOrder(row: Record<string, any>): BoxSafeOrder {
  const items: BoxSafeOrderItem[] = (row.order_items ?? []).map((i: Record<string, any>) => ({
    productId: i.product_id ?? null,
    productName: i.products?.name ?? "Unknown product",
    category: mapCategory(i.products?.category),
    quantity: Number(i.quantity ?? 0),
    variantLabel: i.variant_label ?? null,
    unitPrice: Number(i.unit_price ?? 0),
    totalPrice: Number(i.total_price ?? 0),
    requiresShipping: Boolean(i.products?.requires_shipping),
    leagueCode: i.products?.league_id ?? null,
  }));
  const rawStatus = String(row.status ?? "pending");
  const st = row.paid_at && ["completed", "processing", "shipped", "delivered"].includes(rawStatus) ? "paid" : rawStatus;
  return {
    id: row.id,
    createdAt: row.created_at,
    status: (["pending", "paid", "refunded", "partially_refunded", "cancelled", "failed"].includes(st) ? st : "pending") as BoxSafeOrder["status"],
    paidAt: row.paid_at ?? null,
    fulfillmentStatus: (row.fulfillment_status ?? "unfulfilled") as BoxSafeOrder["fulfillmentStatus"],
    shippedAt: row.shipped_at ?? null,
    trackingNumber: row.tracking_number ?? null,
    carrier: row.carrier ?? null,
    customerName: row.guest_name ?? (row.user_id ? `member:${row.user_id}` : "unknown"),
    customerEmail: row.guest_email ?? "",
    subtotal: Number(row.subtotal ?? 0),
    shipping: Number(row.shipping ?? 0),
    tax: Number(row.tax ?? 0),
    total: Number(row.total ?? 0),
    stripePaymentIntentId: row.stripe_payment_intent_id ?? null,
    stripeCheckoutSessionId: row.stripe_checkout_session_id ?? null,
    items,
  };
}

export class StripeRestGateway implements StripeGateway {
  constructor(private readonly key: string | undefined = process.env.STRIPE_RESTRICTED_KEY) {}
  private async get(params: URLSearchParams) {
    if (!this.key) throw new NotConnectedError("Stripe", "missing restricted read key");
    const r = await fetch(`https://api.stripe.com/v1/payment_intents?${params}`, { headers: { Authorization: `Bearer ${this.key}` }, redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`Stripe payment read failed: HTTP ${r.status}`);
    const body = await r.json() as { data?: Record<string, any>[]; has_more?: boolean };
    if (!Array.isArray(body.data)) throw new Error("Stripe payment response was invalid");
    return body as { data: Record<string, any>[]; has_more?: boolean };
  }
  async status() {
    if (!this.key) return status("Stripe", "not_connected", "A restricted read key for the intended BoxSafe Stripe account is required.");
    try { await this.get(new URLSearchParams({ limit: "1" })); return status("Stripe", "connected", "PaymentIntent read access verified; account ownership, currency, refunds, fees and bank payouts need separate checks."); }
    catch { return status("Stripe", "error", "PaymentIntent read verification failed; provider details withheld."); }
  }
  async listPayments({ from, to }: { from: Date; to: Date }): Promise<StripePayment[]> {
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) throw new Error("Invalid payment range");
    const params = new URLSearchParams({ limit: "100", "created[gte]": String(Math.floor(from.getTime() / 1000)), "created[lt]": String(Math.floor(to.getTime() / 1000)), "expand[]": "data.latest_charge" });
    const payments: StripePayment[] = [];
    for (let page = 0; page < 50; page++) {
      const body = await this.get(params);
      for (const p of body.data) {
        if (p.currency !== "aud") throw new Error("Non-AUD Stripe payment encountered; no AUD financial report was produced");
        const charge = typeof p.latest_charge === "object" && p.latest_charge !== null ? p.latest_charge : null;
        payments.push({ paymentIntentId: p.id, checkoutSessionId: p.metadata?.checkout_session_id ?? null,
          amountAud: Number(p.amount_received ?? p.amount ?? 0) / 100,
          refundedAud: Number(charge?.amount_refunded ?? 0) / 100,
          status: charge?.refunded ? "refunded" : p.status === "succeeded" ? "succeeded" : p.status === "processing" ? "processing" : p.status === "canceled" ? "canceled" : "requires_payment_method",
          createdAt: new Date(p.created * 1000).toISOString(), metadata: p.metadata ?? {} });
      }
      if (!body.has_more) return payments;
      if (!body.data.length || !body.data.at(-1)?.id) throw new Error("Stripe pagination was invalid; no partial report was produced");
      params.set("starting_after", body.data.at(-1)!.id);
    }
    throw new Error("Stripe payment safety limit reached; no partial financial report was produced");
  }
}

export class ResendMailer implements Mailer {
  constructor(private readonly key: string | undefined = process.env.RESEND_API_KEY, private readonly allowedFrom: string[] = (process.env.ATLAS_ALLOWED_FROM ?? "").split(",").filter(Boolean)) {}
  async status() {
    if (!this.key) return status("Mailer (Resend)", "not_connected", "Set RESEND_API_KEY and ATLAS_ALLOWED_FROM once hello@wulffstudio.com.au is verified.");
    return status("Mailer (Resend)", "connected", `Key present; verified sender domains: ${this.allowedFrom.join(", ") || "none"}`);
  }
  async send(email: OutboundEmail) {
    if (!this.key) throw new NotConnectedError("Mailer", "missing RESEND_API_KEY");
    if (!this.allowedFrom.includes(email.from)) throw new Error(`Sender ${email.from} is not in ATLAS_ALLOWED_FROM`);
    if (!email.approvalId) throw new Error("Customer-facing email requires an approvalId");
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: email.from, to: [email.to], subject: email.subject, text: email.text, html: email.html, headers: email.headers }) });
    if (!r.ok) throw new Error(`Resend rejected the message: HTTP ${r.status}`);
    const body = (await r.json()) as { id: string };
    return { providerRef: body.id, acceptedAt: nowIso() };
  }
}

/** Deprecated name retained as a safe alias; all callers use the guarded implementation. */
export { VerifiedTwilioTelephony as TwilioTelephony } from "./notifications.js";

export { HttpWebsiteChecker } from "./website-checker.js";

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] as string);
}

export { VerifiedTwilioTelephony, NtfyOwnerNotifier } from "./notifications.js";
export type { OwnerTwilioConfig, NtfyOwnerConfig } from "./notifications.js";

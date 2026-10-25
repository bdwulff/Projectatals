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

/** Read-only BoxSafe access via Supabase PostgREST with a service-role or scoped key supplied by env. */
export class SupabaseBoxSafeGateway implements BoxSafeGateway {
  constructor(private readonly env: { url?: string; key?: string } = { url: process.env.BOXSAFE_SUPABASE_URL, key: process.env.BOXSAFE_SUPABASE_READ_KEY }) {}

  private configured() { return Boolean(this.env.url && this.env.key); }

  async status() {
    if (!this.configured()) return status("BoxSafe (Supabase)", "not_connected", "Set BOXSAFE_SUPABASE_URL and BOXSAFE_SUPABASE_READ_KEY (read-only key recommended).");
    try {
      const r = await fetch(`${this.env.url}/rest/v1/orders?select=id&limit=1`, { headers: this.headers() });
      return r.ok ? status("BoxSafe (Supabase)", "connected", `Read access verified (${r.status}).`) : status("BoxSafe (Supabase)", "error", `HTTP ${r.status} from PostgREST`);
    } catch (e) {
      return status("BoxSafe (Supabase)", "error", e instanceof Error ? e.message : String(e));
    }
  }

  private headers() { return { apikey: this.env.key as string, Authorization: `Bearer ${this.env.key}`, Accept: "application/json" }; }

  async listOrders({ from, to }: { from: Date; to: Date }): Promise<BoxSafeOrder[]> {
    if (!this.configured()) throw new NotConnectedError("BoxSafe", "missing Supabase env");
    const select = "id,created_at,status,paid_at,fulfillment_status,shipped_at,tracking_number,carrier,guest_name,guest_email,subtotal,shipping,tax,total,stripe_payment_intent_id,stripe_checkout_session_id,user_id,order_items(product_id,quantity,variant_label,unit_price,total_price,products(name,category,requires_shipping,league_id))";
    const url = `${this.env.url}/rest/v1/orders?select=${encodeURIComponent(select)}&created_at=gte.${from.toISOString()}&created_at=lt.${to.toISOString()}&order=created_at.desc&limit=500`;
    const r = await fetch(url, { headers: this.headers() });
    if (!r.ok) throw new Error(`BoxSafe orders query failed: HTTP ${r.status}`);
    const rows = (await r.json()) as Record<string, any>[];
    return rows.map(projectOrder);
  }

  async listOrdersNeedingDispatch(): Promise<BoxSafeOrder[]> {
    const from = new Date(Date.now() - 90 * 86_400_000);
    const all = await this.listOrders({ from, to: new Date(Date.now() + 86_400_000) });
    return all.filter((o) => o.status === "paid" && o.items.some((i) => i.requiresShipping) && ["unfulfilled", "picked", "packed"].includes(o.fulfillmentStatus));
  }

  async recordTracking(): Promise<{ ok: boolean; detail: string }> {
    return { ok: false, detail: "Write access is not enabled on the live BoxSafe adapter. Tracking entry requires an explicitly granted write credential and owner approval." };
  }
}

function mapCategory(raw: string | null | undefined): OrderCategory {
  const c = (raw ?? "").toLowerCase();
  if (c.includes("regist") || c.includes("licen")) return "registration";
  if (c.includes("course")) return "course";
  if (c.includes("ticket")) return "ticket";
  if (c.includes("ppv") || c.includes("stream")) return "ppv";
  if (c.includes("merch") || c.includes("apparel") || c.includes("gear") || c.includes("shop")) return "merchandise";
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
  const st = String(row.status ?? "pending");
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
  async status() {
    if (!this.key) return status("Stripe", "not_connected", "Set STRIPE_RESTRICTED_KEY (restricted key with read-only PaymentIntents/Checkout access).");
    try {
      const r = await fetch("https://api.stripe.com/v1/balance", { headers: { Authorization: `Bearer ${this.key}` } });
      return r.ok ? status("Stripe", "connected", "Read access verified.") : status("Stripe", "error", `HTTP ${r.status}`);
    } catch (e) {
      return status("Stripe", "error", e instanceof Error ? e.message : String(e));
    }
  }
  async listPayments({ from, to }: { from: Date; to: Date }): Promise<StripePayment[]> {
    if (!this.key) throw new NotConnectedError("Stripe", "missing STRIPE_RESTRICTED_KEY");
    const params = new URLSearchParams({ limit: "100", "created[gte]": String(Math.floor(from.getTime() / 1000)), "created[lt]": String(Math.floor(to.getTime() / 1000)) });
    const r = await fetch(`https://api.stripe.com/v1/payment_intents?${params}`, { headers: { Authorization: `Bearer ${this.key}` } });
    if (!r.ok) throw new Error(`Stripe query failed: HTTP ${r.status}`);
    const body = (await r.json()) as { data: Record<string, any>[] };
    return body.data.map((p) => ({
      paymentIntentId: p.id,
      checkoutSessionId: p.metadata?.checkout_session_id ?? null,
      amountAud: (p.amount_received ?? p.amount ?? 0) / 100,
      status: p.status === "succeeded" ? "succeeded" : p.status === "processing" ? "processing" : p.status === "canceled" ? "canceled" : "requires_payment_method",
      createdAt: new Date(p.created * 1000).toISOString(),
      metadata: p.metadata ?? {},
    }));
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

export class TwilioTelephony implements Telephony {
  constructor(private readonly env = { sid: process.env.TWILIO_ACCOUNT_SID, token: process.env.TWILIO_AUTH_TOKEN, from: process.env.TWILIO_FROM_NUMBER, ownerNumber: process.env.ATLAS_OWNER_PHONE }) {}
  private configured() { return Boolean(this.env.sid && this.env.token && this.env.from); }
  async status() {
    return this.configured() ? status("Telephony (Twilio)", "connected", "Credentials present; outbound calling restricted to ATLAS_OWNER_PHONE.") : status("Telephony (Twilio)", "not_connected", "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, ATLAS_OWNER_PHONE.");
  }
  async call(input: { to: string; script: string; reason: string }) {
    if (!this.configured()) throw new NotConnectedError("Telephony", "missing Twilio env");
    if (input.to !== this.env.ownerNumber) throw new Error("Outbound calls are restricted to the owner's number");
    const twiml = `<Response><Say voice="Polly.Olivia-Neural" language="en-AU">${escapeXml(input.script)}</Say></Response>`;
    const body = new URLSearchParams({ To: input.to, From: this.env.from as string, Twiml: twiml });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.env.sid}/Calls.json`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${this.env.sid}:${this.env.token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body });
    if (!r.ok) return { providerRef: "", status: "failed" as const, detail: `Twilio HTTP ${r.status}` };
    const j = (await r.json()) as { sid: string; status: string };
    return { providerRef: j.sid, status: "queued" as const };
  }
  async callStatus(providerRef: string) {
    if (!this.configured()) throw new NotConnectedError("Telephony", "missing Twilio env");
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.env.sid}/Calls/${providerRef}.json`, { headers: { Authorization: `Basic ${Buffer.from(`${this.env.sid}:${this.env.token}`).toString("base64")}` } });
    if (!r.ok) return { status: "failed" as const };
    const j = (await r.json()) as { status: string; duration: string | null };
    const map: Record<string, "queued" | "ringing" | "answered" | "completed" | "no_answer" | "failed"> = { queued: "queued", ringing: "ringing", "in-progress": "answered", completed: "completed", busy: "no_answer", "no-answer": "no_answer", failed: "failed", canceled: "failed" };
    return { status: map[j.status] ?? "failed", durationSeconds: j.duration ? Number(j.duration) : undefined };
  }
}

export class HttpWebsiteChecker implements WebsiteChecker {
  async status() { return status("Website checker", "connected", "Direct HTTP checks (subject to network policy)."); }
  async check(url: string) {
    const checkedAt = nowIso();
    try {
      const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "AtlasWebsiteAudit/0.1 (+wulffstudio)" } });
      const html = await r.text();
      const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
      return { reachable: r.ok, status: r.status, redirectedTo: r.url !== url ? r.url : undefined, title, checkedAt };
    } catch (e) {
      return { reachable: false, error: e instanceof Error ? e.message : String(e), checkedAt };
    }
  }
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] as string);
}

import type { BoxSafeGateway, ConnectionStatus, Mailbox, Mailer, OutboundEmail, InboundEmail, StripeGateway, Telephony, WebsiteChecker, SpeechSynth } from "../types.js";
import type { Notifier, Notification } from "../../notifications.js";
import type { BoxSafeOrder } from "../../boxsafe/orders.js";
import { inRange } from "../../boxsafe/orders.js";
import type { StripePayment } from "../../boxsafe/reconcile.js";
import { newId, nowIso } from "../../ids.js";

function fakeStatus(name: string, detail: string): ConnectionStatus {
  return { name, state: "fake", detail, checkedAt: nowIso(), mode: "fake" };
}

export class FakeMailer implements Mailer {
  readonly sent: (OutboundEmail & { providerRef: string; acceptedAt: string })[] = [];
  async status() { return fakeStatus("Mailer", "In-memory fake. No email leaves this process."); }
  async send(email: OutboundEmail) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.to)) throw new Error(`Invalid recipient address: ${email.to}`);
    const rec = { ...email, providerRef: newId("fakemail"), acceptedAt: nowIso() };
    this.sent.push(rec);
    return { providerRef: rec.providerRef, acceptedAt: rec.acceptedAt };
  }
}

export class FakeMailbox implements Mailbox {
  private inbox: InboundEmail[] = [];
  async status() { return fakeStatus("Mailbox", "In-memory fake inbox."); }
  receive(email: Omit<InboundEmail, "id" | "receivedAt">): InboundEmail {
    const e = { id: newId("inmail"), receivedAt: nowIso(), ...email };
    this.inbox.push(e);
    return e;
  }
  async listUnread() { return [...this.inbox]; }
  async markHandled(id: string) { this.inbox = this.inbox.filter((e) => e.id !== id); }
}

export class FakeTelephony implements Telephony {
  readonly calls: { providerRef: string; to: string; reason: string; script: string; status: "answered" | "no_answer" | "failed"; at: string }[] = [];
  constructor(private readonly outcome: "answered" | "no_answer" | "failed" = "answered") {}
  async status() { return fakeStatus("Telephony", "Fake telephony. No calls are placed. Twilio not configured."); }
  async call(input: { to: string; script: string; reason: string }) {
    const rec = { providerRef: newId("fakecall"), to: input.to, reason: input.reason, script: input.script, status: this.outcome, at: nowIso() };
    this.calls.push(rec);
    return { providerRef: rec.providerRef, status: this.outcome === "failed" ? "failed" as const : "queued" as const, detail: "fake" };
  }
  async callStatus(providerRef: string) {
    const c = this.calls.find((x) => x.providerRef === providerRef);
    if (!c) return { status: "failed" as const };
    return c.status === "answered" ? { status: "completed" as const, durationSeconds: 42 } : { status: c.status };
  }
}

export class FakePushNotifier implements Notifier {
  readonly channel = "push" as const;
  readonly delivered: Notification[] = [];
  async deliver(n: Notification) { this.delivered.push(n); return { delivered: true, providerRef: newId("fakepush") }; }
}

export class FakeWebsiteChecker implements WebsiteChecker {
  constructor(private readonly table: Record<string, { reachable: boolean; status?: number; title?: string; redirectedTo?: string; error?: string }> = {}) {}
  async status() { return fakeStatus("Website checker", "Fake HTTP checker with a fixture table. No network access."); }
  async check(url: string) {
    const r = this.table[url] ?? { reachable: false, error: "No fixture for URL" };
    return { ...r, checkedAt: nowIso() };
  }
}

export class FakeSpeech implements SpeechSynth {
  readonly spoken: string[] = [];
  async status() { return fakeStatus("Speech", "Fake text-to-speech; text is recorded, no audio produced."); }
  async speak(text: string) { this.spoken.push(text); return { audioRef: null, detail: "fake: no audio generated" }; }
}

/** Fictional BoxSafe data. Every name here is invented for testing. */
export function fictionalBoxSafeOrders(now = new Date()): BoxSafeOrder[] {
  const h = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
  const d = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
  return [
    { id: "ord_fx_001", createdAt: h(3), status: "paid", paidAt: h(3), fulfillmentStatus: "not_required", shippedAt: null, trackingNumber: null, carrier: null, customerName: "Test Fighter One", customerEmail: "fighter1@example.test", subtotal: 95, shipping: 0, tax: 0, total: 95, stripePaymentIntentId: "pi_fx_001", stripeCheckoutSessionId: "cs_fx_001", items: [{ productId: "prd_vabl_fighter", productName: "VABL Fighter Registration 2026", category: "registration", quantity: 1, variantLabel: null, unitPrice: 95, totalPrice: 95, requiresShipping: false, leagueCode: "VABL" }] },
    { id: "ord_fx_002", createdAt: h(5), status: "paid", paidAt: h(5), fulfillmentStatus: "unfulfilled", shippedAt: null, trackingNumber: null, carrier: null, customerName: "Test Member Two", customerEmail: "member2@example.test", subtotal: 65, shipping: 12.5, tax: 0, total: 77.5, stripePaymentIntentId: "pi_fx_002", stripeCheckoutSessionId: "cs_fx_002", items: [{ productId: "prd_tee", productName: "BoxSafe Tee", category: "merchandise", quantity: 1, variantLabel: "Black / L", unitPrice: 65, totalPrice: 65, requiresShipping: true }] },
    { id: "ord_fx_003", createdAt: h(8), status: "paid", paidAt: h(8), fulfillmentStatus: "packed", shippedAt: null, trackingNumber: null, carrier: null, customerName: "Test Member Three", customerEmail: "member3@example.test", subtotal: 130, shipping: 12.5, tax: 0, total: 142.5, stripePaymentIntentId: "pi_fx_003", stripeCheckoutSessionId: "cs_fx_003", items: [{ productId: "prd_hoodie", productName: "BoxSafe Hoodie", category: "merchandise", quantity: 2, variantLabel: "Grey / M", unitPrice: 65, totalPrice: 130, requiresShipping: true }] },
    { id: "ord_fx_004", createdAt: h(10), status: "paid", paidAt: h(10), fulfillmentStatus: "not_required", shippedAt: null, trackingNumber: null, carrier: null, customerName: "Test Official Four", customerEmail: "official4@example.test", subtotal: 149, shipping: 0, tax: 0, total: 149, stripePaymentIntentId: "pi_fx_004", stripeCheckoutSessionId: "cs_fx_004", items: [{ productId: "prd_wka_officials_course", productName: "WKA Officials Course", category: "course", quantity: 1, variantLabel: null, unitPrice: 149, totalPrice: 149, requiresShipping: false, leagueCode: "WKA" }] },
    { id: "ord_fx_005", createdAt: h(12), status: "pending", paidAt: null, fulfillmentStatus: "unfulfilled", shippedAt: null, trackingNumber: null, carrier: null, customerName: "Test Member Five", customerEmail: "member5@example.test", subtotal: 95, shipping: 0, tax: 0, total: 95, stripePaymentIntentId: null, stripeCheckoutSessionId: "cs_fx_005", items: [{ productId: "prd_anaba_rego", productName: "ANABA Registration", category: "registration", quantity: 1, variantLabel: null, unitPrice: 95, totalPrice: 95, requiresShipping: false, leagueCode: "ANABA" }] },
    { id: "ord_fx_006", createdAt: d(2), status: "refunded", paidAt: d(2), fulfillmentStatus: "not_required", shippedAt: null, trackingNumber: null, carrier: null, customerName: "Test Member Six", customerEmail: "member6@example.test", subtotal: 45, shipping: 0, tax: 0, total: 45, stripePaymentIntentId: "pi_fx_006", stripeCheckoutSessionId: "cs_fx_006", refundedAmount: 45, items: [{ productId: "prd_ticket", productName: "Fight Night Ticket", category: "ticket", quantity: 1, variantLabel: null, unitPrice: 45, totalPrice: 45, requiresShipping: false }] },
    { id: "ord_fx_007", createdAt: d(3), status: "paid", paidAt: d(3), fulfillmentStatus: "shipped", shippedAt: d(2), trackingNumber: null, carrier: "auspost", customerName: "Test Member Seven", customerEmail: "member7@example.test", subtotal: 65, shipping: 12.5, tax: 0, total: 77.5, stripePaymentIntentId: "pi_fx_007", stripeCheckoutSessionId: "cs_fx_007", items: [{ productId: "prd_tee", productName: "BoxSafe Tee", category: "merchandise", quantity: 1, variantLabel: "Black / S", unitPrice: 65, totalPrice: 65, requiresShipping: true }] },
    { id: "ord_fx_008", createdAt: h(1), status: "paid", paidAt: h(1), fulfillmentStatus: "not_required", shippedAt: null, trackingNumber: null, carrier: null, customerName: "Test Fighter Eight", customerEmail: "fighter8@example.test", subtotal: 95, shipping: 0, tax: 0, total: 95, stripePaymentIntentId: null, stripeCheckoutSessionId: null, items: [{ productId: "prd_vabl_fighter", productName: "VABL Fighter Registration 2026", category: "registration", quantity: 1, variantLabel: null, unitPrice: 95, totalPrice: 95, requiresShipping: false, leagueCode: "VABL" }] },
  ];
}

export function fictionalStripePayments(now = new Date()): StripePayment[] {
  const h = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
  const d = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
  return [
    { paymentIntentId: "pi_fx_001", checkoutSessionId: "cs_fx_001", amountAud: 95, status: "succeeded", createdAt: h(3) },
    { paymentIntentId: "pi_fx_002", checkoutSessionId: "cs_fx_002", amountAud: 77.5, status: "succeeded", createdAt: h(5) },
    { paymentIntentId: "pi_fx_003", checkoutSessionId: "cs_fx_003", amountAud: 142.5, status: "succeeded", createdAt: h(8) },
    { paymentIntentId: "pi_fx_004", checkoutSessionId: "cs_fx_004", amountAud: 149, status: "succeeded", createdAt: h(10) },
    { paymentIntentId: "pi_fx_005", checkoutSessionId: "cs_fx_005", amountAud: 95, status: "succeeded", createdAt: h(11) },
    { paymentIntentId: "pi_fx_006", checkoutSessionId: "cs_fx_006", amountAud: 45, status: "refunded", createdAt: d(2), refundedAud: 45 },
    { paymentIntentId: "pi_fx_007", checkoutSessionId: "cs_fx_007", amountAud: 77.5, status: "succeeded", createdAt: d(3) },
    { paymentIntentId: "pi_fx_999", checkoutSessionId: "cs_fx_999", amountAud: 65, status: "succeeded", createdAt: h(6) },
  ];
}

export class FakeBoxSafeGateway implements BoxSafeGateway {
  orders: BoxSafeOrder[];
  readonly trackingWrites: { orderId: string; carrier: string; trackingNumber: string; actor: string; at: string }[] = [];
  constructor(orders?: BoxSafeOrder[]) { this.orders = orders ?? fictionalBoxSafeOrders(); }
  async status() { return fakeStatus("BoxSafe (Supabase)", "Fictional fixture data. Live project wzlntgwsoczgufbavngp not connected."); }
  async listOrders({ from, to }: { from: Date; to: Date }) { return this.orders.filter((o) => inRange(o.paidAt ?? o.createdAt, from, to)); }
  async listOrdersNeedingDispatch() { return this.orders.filter((o) => o.status === "paid" && o.items.some((i) => i.requiresShipping) && ["unfulfilled", "picked", "packed"].includes(o.fulfillmentStatus)); }
  async recordTracking(input: { orderId: string; carrier: string; trackingNumber: string; actor: string }) {
    const o = this.orders.find((x) => x.id === input.orderId);
    if (!o) return { ok: false, detail: "order not found" };
    if (!/^[A-Z0-9]{10,}$/i.test(input.trackingNumber)) return { ok: false, detail: "tracking number does not look valid" };
    o.carrier = input.carrier; o.trackingNumber = input.trackingNumber; o.fulfillmentStatus = "shipped"; o.shippedAt = nowIso();
    this.trackingWrites.push({ ...input, at: nowIso() });
    return { ok: true, detail: "fake: updated in memory" };
  }
}

export class FakeStripeGateway implements StripeGateway {
  constructor(private readonly payments: StripePayment[] = fictionalStripePayments()) {}
  async status() { return fakeStatus("Stripe", "Fictional payments. Live Stripe not connected."); }
  async listPayments({ from, to }: { from: Date; to: Date }) { return this.payments.filter((p) => inRange(p.createdAt, from, to)); }
}

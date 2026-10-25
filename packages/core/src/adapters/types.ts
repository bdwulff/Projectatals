/**
 * Every external system is reached through an adapter interface with a
 * `status()` that reports the real connection state. Fake implementations
 * exist for every adapter so the whole workflow can run on fictional data.
 * Nothing in Atlas may report an adapter as connected unless status() says so.
 */
import type { BoxSafeOrder } from "../boxsafe/orders.js";
import type { StripePayment } from "../boxsafe/reconcile.js";

export type ConnectionState = "connected" | "fake" | "not_connected" | "error";

export interface ConnectionStatus {
  name: string;
  state: ConnectionState;
  detail: string;
  checkedAt: string;
  /** Mode the adapter is operating in. `fake` adapters never touch live systems. */
  mode: "live" | "fake";
}

export interface Adapter {
  status(): Promise<ConnectionStatus>;
}

export interface OutboundEmail {
  to: string;
  from: string;
  subject: string;
  text: string;
  html?: string;
  /** Required for every customer-facing message; recorded in the audit trail. */
  approvalId?: string;
  headers?: Record<string, string>;
}

export interface Mailer extends Adapter {
  send(email: OutboundEmail): Promise<{ providerRef: string; acceptedAt: string }>;
}

export interface InboundEmail {
  id: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  receivedAt: string;
  threadId?: string;
}

export interface Mailbox extends Adapter {
  listUnread(since?: string): Promise<InboundEmail[]>;
  markHandled(id: string): Promise<void>;
}

export interface Telephony extends Adapter {
  /** Places an outbound call. Resolves only with the provider's own record; never fabricates. */
  call(input: { to: string; script: string; reason: string }): Promise<{ providerRef: string; status: "queued" | "ringing" | "answered" | "failed"; detail?: string }>;
  callStatus(providerRef: string): Promise<{ status: "queued" | "ringing" | "answered" | "completed" | "no_answer" | "failed"; durationSeconds?: number }>;
}

export interface BoxSafeGateway extends Adapter {
  /** Read-only by default (section 21.H). */
  listOrders(input: { from: Date; to: Date }): Promise<BoxSafeOrder[]>;
  listOrdersNeedingDispatch(): Promise<BoxSafeOrder[]>;
  /** Level 3 write, requires verified tracking details. */
  recordTracking(input: { orderId: string; carrier: string; trackingNumber: string; actor: string }): Promise<{ ok: boolean; detail: string }>;
}

export interface StripeGateway extends Adapter {
  listPayments(input: { from: Date; to: Date }): Promise<StripePayment[]>;
}

export interface WebsiteChecker extends Adapter {
  /** Real HTTP check of a URL. Used to turn a hypothesis into confirmed evidence or to clear it. */
  check(url: string): Promise<{ reachable: boolean; status?: number; redirectedTo?: string; title?: string; error?: string; checkedAt: string }>;
}

export interface SpeechSynth extends Adapter {
  speak(text: string): Promise<{ audioRef: string | null; detail: string }>;
}

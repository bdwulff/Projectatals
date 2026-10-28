import { createHash } from "node:crypto";
import type { ConnectionStatus, Telephony } from "../types.js";
import type { Notification, Notifier } from "../../notifications.js";
import type { Store, StoredJob } from "../../store.js";
import { newId } from "../../ids.js";

const E164 = /^\+[1-9][0-9]{7,14}$/;
const ACCOUNT_SID = /^AC[0-9a-f]{32}$/i;
const CALL_SID = /^CA[0-9a-f]{32}$/i;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const dayKey = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const checked = (name: string, state: ConnectionStatus["state"], detail: string): ConnectionStatus => ({ name, state, detail, checkedAt: new Date().toISOString(), mode: "live" });

function journalJob(key: string, type: string, now: Date, status: StoredJob["status"] = "running"): StoredJob {
  return { id: newId("transport"), type, idempotencyKey: key, payload: {}, status, attempts: 1, maxAttempts: 1,
    runAfter: now.toISOString(), lastError: null, result: null, createdAt: now.toISOString(), updatedAt: now.toISOString() };
}

/**
 * Unique job keys reserve an attempt before network I/O. Unknown outcomes are never
 * retried automatically, so a timeout/restart cannot create a duplicate paid call.
 * Quota slots are unique in SQLite as well, including across process restarts.
 */
function reserve(store: Store, channel: string, destination: string, eventKey: string, maxPerDay: number, now: Date): { job: StoredJob; fresh: boolean; quota: boolean } {
  const key = `transport:${channel}:${digest(destination)}:${digest(eventKey)}`;
  const existing = store.getJobByKey(key);
  if (existing) return { job: existing, fresh: false, quota: existing.lastError !== "Daily owner transport quota reached." };
  const job = journalJob(key, `owner_${channel}_attempt`, now);
  try { store.insertJob(job); }
  catch {
    const duplicate = store.getJobByKey(key);
    if (duplicate) return { job: duplicate, fresh: false, quota: duplicate.lastError !== "Daily owner transport quota reached." };
    throw new Error("Owner transport journal could not reserve the attempt.");
  }
  for (let slot = 0; slot < maxPerDay; slot++) {
    const quotaKey = `quota:${channel}:${dayKey(now)}:${slot}`;
    try {
      store.insertJob(journalJob(quotaKey, `owner_${channel}_quota`, now, "succeeded"));
      return { job, fresh: true, quota: true };
    } catch {
      if (!store.getJobByKey(quotaKey)) throw new Error("Owner transport quota journal failed.");
    }
  }
  job.status = "dead";
  job.lastError = "Daily owner transport quota reached.";
  store.updateJob(job);
  return { job, fresh: true, quota: false };
}

function finish(store: Store, job: StoredJob, result: unknown, success: boolean, now: Date) {
  job.result = result;
  job.status = success ? "succeeded" : "dead";
  job.updatedAt = now.toISOString();
  job.lastError = success ? null : "Provider submission failed or outcome is unknown; automatic retry disabled.";
  store.updateJob(job);
}

function previousResult(job: StoredJob): { providerRef?: string; status?: string; accepted?: boolean } {
  return typeof job.result === "object" && job.result !== null ? job.result as { providerRef?: string; status?: string; accepted?: boolean } : {};
}

export interface OwnerTwilioConfig {
  sid?: string; token?: string; from?: string; ownerNumber?: string;
  /** Set only after the owner authorises calling costs and this destination. */
  enabled?: boolean;
  store?: Store;
  maxCallsPerDay?: number;
  clock?: () => Date;
}

/** Verified Twilio submission, restricted to the configured owner and a durable daily quota. */
export class VerifiedTwilioTelephony implements Telephony {
  private readonly clock: () => Date;
  constructor(private readonly config: OwnerTwilioConfig) { this.clock = config.clock ?? (() => new Date()); }
  private configured() { return Boolean(this.config.sid && ACCOUNT_SID.test(this.config.sid) && this.config.token && this.config.from && E164.test(this.config.from) && this.config.ownerNumber && E164.test(this.config.ownerNumber)); }
  private headers() { return { Authorization: `Basic ${Buffer.from(`${this.config.sid}:${this.config.token}`).toString("base64")}` }; }
  private base() { return `https://api.twilio.com/2010-04-01/Accounts/${this.config.sid}`; }
  private options(): RequestInit { return { headers: this.headers(), redirect: "error", signal: AbortSignal.timeout(10_000) }; }

  async status(): Promise<ConnectionStatus> {
    if (!this.configured()) return checked("Owner calls (Twilio)", "not_connected", "Configure valid Twilio credentials, an owned voice number and the owner's E.164 number.");
    try {
      const response = await fetch(`${this.base()}.json`, this.options());
      if (!response.ok) return checked("Owner calls (Twilio)", "error", `Account verification returned HTTP ${response.status}.`);
      const account = await response.json() as { sid?: string; status?: string };
      if (account.sid !== this.config.sid || account.status !== "active") return checked("Owner calls (Twilio)", "error", "The intended Twilio account is not active or could not be verified.");
      const params = new URLSearchParams({ PhoneNumber: this.config.from as string, PageSize: "1" });
      const numbers = await fetch(`${this.base()}/IncomingPhoneNumbers.json?${params}`, this.options());
      if (!numbers.ok) return checked("Owner calls (Twilio)", "error", `Originating number verification returned HTTP ${numbers.status}.`);
      const body = await numbers.json() as { incoming_phone_numbers?: { phone_number?: string; capabilities?: { voice?: boolean } }[] };
      if (!body.incoming_phone_numbers?.some((n) => n.phone_number === this.config.from && n.capabilities?.voice === true)) {
        return checked("Owner calls (Twilio)", "error", "The configured originating number is not an owned voice-capable number.");
      }
      return checked("Owner calls (Twilio)", "connected", this.config.enabled
        ? "Account and originating voice number verified by read-only requests. Owner calls enabled; no call was placed by this check."
        : "Account and originating voice number verified. Calls remain disabled until ATLAS_OWNER_CALLS_ENABLED=true.");
    } catch { return checked("Owner calls (Twilio)", "error", "Read-only Twilio verification failed; provider details were withheld."); }
  }

  async call(input: { to: string; script: string; reason: string }) {
    const failed = (detail: string) => ({ providerRef: "", status: "failed" as const, detail });
    if (this.config.enabled !== true) return failed("Owner calls are disabled.");
    if (!this.configured() || !this.config.store) return failed("A verified owner configuration and durable store are required.");
    if (input.to !== this.config.ownerNumber) return failed("Calls are restricted to the configured owner's number.");
    if (!input.reason.trim() || input.reason.length > 512 || !input.script.trim() || input.script.length > 1500) return failed("A bounded event key and call script are required.");
    const quota = this.config.maxCallsPerDay ?? 1;
    if (!Number.isInteger(quota) || quota < 1 || quota > 3) return failed("Daily owner call quota must be between one and three.");
    if ((await this.status()).state !== "connected") return failed("Twilio account or voice number read verification failed.");
    const reservation = reserve(this.config.store, "call", input.to, input.reason, quota, this.clock());
    if (!reservation.quota) return failed("Daily owner call quota reached.");
    if (!reservation.fresh) {
      const prior = previousResult(reservation.job);
      return prior.accepted && prior.providerRef && CALL_SID.test(prior.providerRef)
        ? { providerRef: prior.providerRef, status: "queued" as const, detail: "Existing provider submission; no duplicate call was placed. Completion must be checked with the provider." }
        : failed("An earlier attempt exists; its outcome requires review. No automatic retry was made.");
    }
    try {
      const text = input.script.replace(/[<>&'\"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] as string);
      const body = new URLSearchParams({ To: input.to, From: this.config.from as string, Twiml: `<Response><Say language="en-AU">${text}</Say></Response>`, Timeout: "20", TimeLimit: "60", Record: "false" });
      const response = await fetch(`${this.base()}/Calls.json`, { method: "POST", headers: { ...this.headers(), "Content-Type": "application/x-www-form-urlencoded" }, body, redirect: "error", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) { finish(this.config.store, reservation.job, { accepted: false }, false, this.clock()); return failed(`Twilio rejected the submission (HTTP ${response.status}).`); }
      const result = await response.json() as { sid?: string; account_sid?: string; to?: string; from?: string; status?: string };
      if (!result.sid || !CALL_SID.test(result.sid) || result.account_sid !== this.config.sid || result.to !== this.config.ownerNumber || result.from !== this.config.from || !["queued", "ringing", "in-progress"].includes(result.status ?? "")) {
        finish(this.config.store, reservation.job, { accepted: false }, false, this.clock()); return failed("Twilio did not return a valid accepted call record.");
      }
      finish(this.config.store, reservation.job, { accepted: true, providerRef: result.sid, status: result.status }, true, this.clock());
      return { providerRef: result.sid, status: result.status === "ringing" ? "ringing" as const : result.status === "in-progress" ? "answered" as const : "queued" as const, detail: "Provider accepted the call. Delivery and owner acknowledgement are not yet confirmed." };
    } catch {
      finish(this.config.store, reservation.job, { accepted: false }, false, this.clock());
      return failed("Call submission failed or outcome is unknown. Automatic retry is disabled to prevent duplicate calls.");
    }
  }

  async callStatus(providerRef: string) {
    if (!this.configured() || !CALL_SID.test(providerRef)) return { status: "failed" as const };
    try {
      const response = await fetch(`${this.base()}/Calls/${providerRef}.json`, this.options());
      if (!response.ok) return { status: "failed" as const };
      const record = await response.json() as { sid?: string; account_sid?: string; to?: string; from?: string; status?: string; duration?: string };
      if (record.sid !== providerRef || record.account_sid !== this.config.sid || record.to !== this.config.ownerNumber || record.from !== this.config.from) return { status: "failed" as const };
      const states = { queued: "queued", ringing: "ringing", "in-progress": "answered", completed: "completed", busy: "no_answer", "no-answer": "no_answer", failed: "failed", canceled: "failed" } as const;
      const state = states[record.status as keyof typeof states];
      if (!state) return { status: "failed" as const };
      const duration = Number(record.duration);
      return { status: state, ...(Number.isFinite(duration) && duration >= 0 ? { durationSeconds: duration } : {}) };
    } catch { return { status: "failed" as const }; }
  }
}

export interface NtfyOwnerConfig {
  enabled?: boolean;
  baseUrl?: string;
  allowedHost?: string;
  topic?: string;
  token?: string;
  store?: Store;
  maxNotificationsPerDay?: number;
  clock?: () => Date;
}

/** Generic owner alerts only: no customer, financial, medical or approval contents leave Atlas. */
export class NtfyOwnerNotifier implements Notifier {
  readonly channel = "push" as const;
  private readonly clock: () => Date;
  constructor(private readonly config: NtfyOwnerConfig) { this.clock = config.clock ?? (() => new Date()); }
  private origin(): string | null {
    try {
      const url = new URL(this.config.baseUrl ?? "https://ntfy.sh");
      const expected = this.config.allowedHost ?? "ntfy.sh";
      if (url.protocol !== "https:" || url.hostname !== expected || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname) || (url.port && url.port !== "443")) return null;
      return url.origin;
    } catch { return null; }
  }
  private configured() { return Boolean(this.origin() && this.config.topic && /^[a-zA-Z0-9_-]{24,64}$/.test(this.config.topic)); }
  private headers(): Record<string, string> { return this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}; }

  async status(): Promise<ConnectionStatus> {
    if (!this.configured()) return checked("Owner push (ntfy)", "not_connected", "Set an exact allowed HTTPS host and a private unguessable 24–64 character topic; an access token is optional for public topics.");
    try {
      const response = await fetch(`${this.origin()}/${this.config.topic}/auth`, { headers: this.headers(), redirect: "error", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return checked("Owner push (ntfy)", "error", `Topic read authentication returned HTTP ${response.status}.`);
      const result = await response.json() as { success?: boolean };
      if (result.success !== true) return checked("Owner push (ntfy)", "error", "Topic read authentication did not return the expected confirmation.");
      return checked("Owner push (ntfy)", "connected", `Topic read authentication verified. Publishing and phone receipt have not been tested; owner push is ${this.config.enabled ? "enabled" : "disabled"}.`);
    } catch { return checked("Owner push (ntfy)", "error", "Read-only ntfy authentication failed; provider details were withheld."); }
  }

  async deliver(notification: Notification) {
    const refused = (detail: string) => ({ delivered: false, detail });
    if (this.config.enabled !== true) return refused("Owner push is disabled.");
    if (!this.configured() || !this.config.store) return refused("A configured owner topic and durable store are required.");
    if (notification.priority === "routine") return refused("Routine events remain on the dashboard.");
    if (!notification.eventKey.trim() || notification.eventKey.length > 512) return refused("A bounded notification event key is required.");
    const quota = this.config.maxNotificationsPerDay ?? 20;
    if (!Number.isInteger(quota) || quota < 1 || quota > 100) return refused("Owner push quota must be between one and 100 per day.");
    if ((await this.status()).state !== "connected") return refused("Topic read authentication is unavailable.");
    const reservation = reserve(this.config.store, "push", `${this.origin()}/${this.config.topic}`, notification.eventKey, quota, this.clock());
    if (!reservation.quota) return refused("Daily owner push quota reached.");
    if (!reservation.fresh) {
      const prior = previousResult(reservation.job);
      return prior.accepted && prior.providerRef ? { delivered: true, providerRef: prior.providerRef, detail: "Earlier provider acceptance reused; no duplicate publish occurred. Phone receipt is unverified." }
        : refused("An earlier submission exists with an unconfirmed outcome. No automatic duplicate was sent.");
    }
    try {
      // Deliberately exclude untrusted notification.title/body and any action URL.
      const response = await fetch(`${this.origin()}/${this.config.topic}`, { method: "POST", headers: { ...this.headers(), "Content-Type": "text/plain; charset=utf-8", Title: "Atlas needs your attention", Priority: notification.priority === "critical" ? "5" : "4" },
        body: "Atlas has an owner alert. Open your private Atlas dashboard to review it.", redirect: "error", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) { finish(this.config.store, reservation.job, { accepted: false }, false, this.clock()); return refused(`ntfy rejected the publish (HTTP ${response.status}).`); }
      const result = await response.json() as { id?: string; event?: string; topic?: string };
      if (!result.id || !/^[A-Za-z0-9_-]{1,64}$/.test(result.id) || result.event !== "message" || result.topic !== this.config.topic) {
        finish(this.config.store, reservation.job, { accepted: false }, false, this.clock()); return refused("ntfy did not return a valid accepted message record.");
      }
      finish(this.config.store, reservation.job, { accepted: true, providerRef: result.id }, true, this.clock());
      return { delivered: true, providerRef: result.id, detail: "ntfy accepted the message. Phone receipt and owner acknowledgement are unverified." };
    } catch {
      finish(this.config.store, reservation.job, { accepted: false }, false, this.clock());
      return refused("Push submission failed or outcome is unknown; no automatic duplicate will be sent.");
    }
  }
}

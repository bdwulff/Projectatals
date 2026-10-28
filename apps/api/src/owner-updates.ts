import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Atlas, Notification, Notifier, Store, StoredJob } from "@atlas/core";
import type { Context, Hono } from "hono";
import type { AcquisitionMailTransport } from "./acquisition-mail.js";

export interface OwnerUpdateSettings { email: string; emailEnabled: boolean; messageEnabled: boolean; dailyDigest: boolean }
export interface OwnerUpdateCounts { candidates: number; concepts: number; pendingReview: number }
export interface OwnerUpdatesOptions {
  atlas: Atlas; mode: "live" | "fake"; mailer: AcquisitionMailTransport; publicOrigin?: string; ownerAccessKey?: string;
  telegramToken?: string; telegramChatId?: string; request?: typeof fetch; clock?: () => Date;
  counts?: () => Promise<OwnerUpdateCounts>;
}
interface TelegramLink { sealedToken: string; chatId: string; botUsername: string; verifiedAt: string }
interface TelegramCredentials { token: string; chatId: string; botUsername?: string; verifiedAt?: string }
interface UpdateJob { channel: "email" | "message"; kind: "test" | "alert" | "digest"; eventKey: string; settingsVersion: string; text: string; notificationId?: string; day: string }
interface UpdateResult { accepted: boolean; simulated: boolean; providerRef?: string; acceptedAt?: string; detail: string }
export interface OwnerUpdateChannelStatus { state: "connected" | "not_connected" | "error" | "fake"; provider: string; detail: string; sender?: string; botUsername?: string; chatId?: string }
export interface OwnerUpdatesSnapshot {
  settings: OwnerUpdateSettings;
  email: OwnerUpdateChannelStatus; message: OwnerUpdateChannelStatus;
  schedule: string;
  recent: Array<{ id: string; channel: string; kind: string; state: string; at: string; detail: string; providerRef?: string }>;
}
const SETTINGS = "owner-updates.settings", TELEGRAM = "owner-updates.telegram", JOB = "owner_update_delivery";
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/;
const TOKEN = /^\d{5,20}:[A-Za-z0-9_-]{20,150}$/;
const CHAT = /^[1-9]\d{3,19}$/;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function day(now: Date): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
function hour(now: Date): number { return Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", hourCycle: "h23" }).format(now)); }
export class OwnerUpdateError extends Error { constructor(message: string, readonly status: 400 | 409 | 503 = 400) { super(message); } }

/** Owner-only summaries. Source text and customer details never become outbound message content. */
export class OwnerUpdates {
  private readonly store: Store;
  private readonly clock: () => Date;
  private epoch = 0;
  private messageCache: { key: string; at: number; status: OwnerUpdateChannelStatus } | null = null;
  constructor(private readonly options: OwnerUpdatesOptions) {
    this.store = options.atlas.deps.store; this.clock = options.clock ?? (() => new Date());
    options.atlas.jobs.register<UpdateJob, UpdateResult>(JOB, async (payload, ctx) => this.execute(payload, ctx.job));
  }
  private origin(): string | null { try { const u = new URL(this.options.publicOrigin ?? ""); return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash && u.pathname === "/" ? u.origin : null; } catch { return null; } }
  settings(): OwnerUpdateSettings { return this.store.getMemory<OwnerUpdateSettings>(SETTINGS) ?? { email: "", emailEnabled: false, messageEnabled: false, dailyDigest: false }; }
  saveSettings(input: unknown): OwnerUpdateSettings {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new OwnerUpdateError("Provide owner update settings.");
    const v = input as Record<string, unknown>;
    if (Object.keys(v).some(k => !["email", "emailEnabled", "messageEnabled", "dailyDigest"].includes(k)) || typeof v.email !== "string" || v.email.length > 254 || [v.emailEnabled, v.messageEnabled, v.dailyDigest].some(b => typeof b !== "boolean")) throw new OwnerUpdateError("Check the owner email and update switches.");
    const email = v.email.trim();
    if (email && (!EMAIL.test(email) || /[\r\n]/.test(email))) throw new OwnerUpdateError("Provide your own valid email address.");
    if (this.options.mode === "live" && email && /\.(?:test|invalid|example)$/i.test(email)) throw new OwnerUpdateError("A real owner email address is required in live mode.");
    if (v.emailEnabled && !email) throw new OwnerUpdateError("Set your own recipient address before enabling email updates.");
    if (v.messageEnabled && this.options.mode !== "fake" && !this.telegram()) throw new OwnerUpdateError("Connect your private Telegram chat before enabling messages.");
    const next = { email, emailEnabled: v.emailEnabled as boolean, messageEnabled: v.messageEnabled as boolean, dailyDigest: v.dailyDigest as boolean };
    this.epoch++; this.store.setMemory(SETTINGS, next);
    this.options.atlas.audit.record({ actor: "owner", action: "execute.internal_notification.settings", business: "atlas", outcome: "completed", detail: { emailEnabled: next.emailEnabled, messageEnabled: next.messageEnabled, dailyDigest: next.dailyDigest, recipientConfigured: Boolean(email) } });
    return next;
  }
  private encryptionKey(): Buffer { if (!this.options.ownerAccessKey || this.options.ownerAccessKey.length < 32) throw new OwnerUpdateError("Secure owner authentication is required before saving a messaging token.", 503); return createHash("sha256").update("atlas-owner-updates-v1\0" + this.options.ownerAccessKey).digest(); }
  private seal(token: string): string { const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.encryptionKey(), iv); const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"); }
  private unseal(value: string): string | null { try { const b = Buffer.from(value, "base64url"); if (b.length < 29 || b.length > 512) return null; const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey(), b.subarray(0, 12)); decipher.setAuthTag(b.subarray(12, 28)); return Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]).toString("utf8"); } catch { return null; } }
  private telegram(): TelegramCredentials | null {
    if (this.options.mode === "fake") return null;
    const stored = this.store.getMemory<TelegramLink>(TELEGRAM);
    if (!stored && this.store.getMemory("owner-updates.telegram.disabled") === true) return null;
    if (stored) { const token = this.unseal(stored.sealedToken); return token && TOKEN.test(token) && CHAT.test(stored.chatId) ? { token, chatId: stored.chatId, botUsername: stored.botUsername, verifiedAt: stored.verifiedAt } : null; }
    return TOKEN.test(this.options.telegramToken ?? "") && CHAT.test(this.options.telegramChatId ?? "") ? { token: this.options.telegramToken!, chatId: this.options.telegramChatId! } : null;
  }
  async connectTelegram(input: unknown): Promise<void> {
    if (this.options.mode === "fake") throw new OwnerUpdateError("Fictional mode does not connect or contact Telegram.", 409);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new OwnerUpdateError("Provide your bot token and private chat ID.");
    const v = input as Record<string, unknown>;
    if (Object.keys(v).some(k => !["token", "chatId"].includes(k)) || typeof v.token !== "string" || !TOKEN.test(v.token.trim()) || typeof v.chatId !== "string" || !CHAT.test(v.chatId.trim())) throw new OwnerUpdateError("Use the bot token from BotFather and your positive numeric private chat ID. Groups and channels are not supported.");
    this.encryptionKey();
    const epoch = ++this.epoch, creds = { token: v.token.trim(), chatId: v.chatId.trim() };
    const status = await this.checkTelegram(creds);
    if (epoch !== this.epoch) throw new OwnerUpdateError("Messaging settings changed during verification. Start again.", 409);
    if (status.state !== "connected") throw new OwnerUpdateError(status.detail, 503);
    this.store.setMemory(TELEGRAM, { sealedToken: this.seal(creds.token), chatId: creds.chatId, botUsername: status.botUsername!, verifiedAt: this.clock().toISOString() } satisfies TelegramLink);
    this.store.setMemory("owner-updates.telegram.disabled", false); this.messageCache = null;
    // Linking only verifies the target. It deliberately leaves delivery disabled.
    const settings = this.settings(); this.store.setMemory(SETTINGS, { ...settings, messageEnabled: false });
    this.options.atlas.audit.record({ actor: "owner", action: "execute.internal_notification.telegram_link", business: "atlas", outcome: "completed", detail: { verifiedPrivateChat: true, deliveryEnabled: false } });
  }
  disconnectTelegram(): void { this.epoch++; this.store.setMemory(TELEGRAM, null); this.store.setMemory("owner-updates.telegram.disabled", true); this.store.setMemory(SETTINGS, { ...this.settings(), messageEnabled: false }); this.messageCache = null; this.options.atlas.audit.record({ actor: "owner", action: "execute.internal_notification.telegram_disconnect", business: "atlas", outcome: "completed", detail: { deliveryEnabled: false } }); }
  private version(): string { return hash(JSON.stringify([this.settings(), this.store.getMemory(TELEGRAM), this.store.getMemory("owner-updates.telegram.disabled"), hash(this.options.telegramToken ?? ""), this.options.telegramChatId ?? ""])); }
  private async telegramRequest(creds: TelegramCredentials, method: "getMe" | "getChat" | "sendMessage", body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    try {
      const response = await (this.options.request ?? fetch)(`https://api.telegram.org/bot${creds.token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(12_000) });
      if (!response.ok) { await response.body?.cancel(); throw new Error(); }
      const reader = response.body?.getReader(); if (!reader) throw new Error(); let length = 0; const chunks: Uint8Array[] = [];
      while (true) { const next = await reader.read(); if (next.done) break; length += next.value.byteLength; if (length > 16_384) { await reader.cancel(); throw new Error(); } chunks.push(next.value); }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!data || typeof data !== "object" || (data as any).ok !== true || !(data as any).result || typeof (data as any).result !== "object" || Array.isArray((data as any).result)) throw new Error();
      return (data as any).result;
    } catch { throw new OwnerUpdateError("Telegram could not verify or accept the request. Check the token, start the bot in your private chat, and check your chat ID. No automatic retry was made.", 503); }
  }
  private async checkTelegram(creds: TelegramCredentials): Promise<OwnerUpdateChannelStatus> {
    try {
      const me = await this.telegramRequest(creds, "getMe");
      if (me.is_bot !== true || typeof me.id !== "number" || !Number.isSafeInteger(me.id) || String(me.id) !== creds.token.split(":")[0] || typeof me.username !== "string" || !/^[A-Za-z0-9_]{5,64}$/.test(me.username)) throw new Error();
      const chat = await this.telegramRequest(creds, "getChat", { chat_id: creds.chatId });
      if (chat.type !== "private" || typeof chat.id !== "number" || !Number.isSafeInteger(chat.id) || String(chat.id) !== creds.chatId) throw new Error();
      return { state: "connected", provider: "Telegram", detail: "Bot and private chat verified with read-only requests. You selected this recipient; phone receipt has not been tested. Telegram messages are cloud chats, not end-to-end encrypted.", botUsername: me.username, chatId: creds.chatId };
    } catch { return { state: "error", provider: "Telegram", detail: "Telegram is not verified. Check your bot token, start the bot in a private chat, and enter that chat's positive numeric ID." }; }
  }
  async messageStatus(): Promise<OwnerUpdateChannelStatus> {
    if (this.options.mode === "fake") return { state: "fake", provider: "Fictional owner messages", detail: "Fictional mode records tests locally; no messaging service is contacted." };
    if (this.store.getMemory("owner-updates.telegram.disabled") === true && !this.store.getMemory(TELEGRAM)) return { state: "not_connected", provider: "Telegram", detail: "Telegram has been disconnected in Jarvis. Reconnect to enable it again." };
    const creds = this.telegram();
    if (!creds) return { state: "not_connected", provider: "Telegram", detail: "Create a free bot with Telegram's @BotFather, start it in your own private chat, then connect its token and your chat ID here. SMS needs a separate paid provider." };
    const key = hash(creds.token + ":" + creds.chatId), now = this.clock().getTime();
    if (this.messageCache?.key === key && now - this.messageCache.at >= 0 && now - this.messageCache.at < 60_000) return this.messageCache.status;
    const epoch = this.epoch, status = await this.checkTelegram(creds);
    if (epoch !== this.epoch) return { state: "error", provider: "Telegram", detail: "Messaging settings changed during verification; check again." };
    this.messageCache = { key, at: now, status }; return status;
  }
  async snapshot(): Promise<OwnerUpdatesSnapshot> {
    let email: OwnerUpdateChannelStatus;
    if (this.options.mode === "fake") email = { state: "fake", provider: "Fictional owner email", detail: "Fictional mode records tests locally; no email provider is contacted." };
    else try { email = await this.options.mailer.status(); } catch { email = { state: "error", provider: "Email", detail: "The selected sending connection could not be checked." }; }
    return { settings: this.settings(), email, message: await this.messageStatus(), schedule: "Daily digest once per Melbourne day, after 09:00, while enabled. Action alerts are capped at 20 submissions per channel per day. Provider acceptance does not confirm device receipt.", recent: this.store.listJobs(500).filter(j => j.type === JOB).slice(0, 20).map(j => { const p = j.payload as UpdateJob, r = j.result as UpdateResult | null; return { id: j.id, channel: p.channel, kind: p.kind, state: r?.simulated ? "simulated" : j.status === "succeeded" ? "accepted" : j.status === "dead" ? "needs_review" : j.status, at: r?.acceptedAt ?? j.updatedAt, detail: r?.detail ?? j.lastError ?? "Queued for one delivery attempt.", ...(r?.providerRef ? { providerRef: r.providerRef } : {}) }; }) };
  }
  notifiers(): Notifier[] { return (["email", "message"] as const).map(channel => ({ channel: channel === "email" ? "email" as const : "push" as const, deliver: async (n: Notification) => {
    if (n.priority === "routine") return { delivered: false, detail: "Routine updates remain on the dashboard or daily digest." };
    const result = await this.submit(channel, "alert", n.eventKey, `Jarvis has an ${n.priority === "critical" ? "urgent" : "action"} update for you. Open your private dashboard to review it.`, n.id);
    return { delivered: result.accepted && !result.simulated, providerRef: result.providerRef, detail: result.detail };
  } })); }
  async test(channel: unknown): Promise<UpdateResult> {
    if (channel !== "email" && channel !== "message") throw new OwnerUpdateError("Choose email or message.");
    return this.submit(channel, "test", `test:${Math.floor(this.clock().getTime() / 60_000)}`, "Your Jarvis owner update connection is working. This is the test you requested; no prospect was contacted.");
  }
  async digest(): Promise<Array<UpdateResult>> {
    const counts = await this.options.counts?.() ?? { candidates: 0, concepts: 0, pendingReview: 0 };
    const safe = (n: number) => Number.isSafeInteger(n) && n >= 0 ? Math.min(n, 100_000) : 0;
    const text = `Your Jarvis studio has ${safe(counts.candidates)} research candidates, ${safe(counts.concepts)} private website concepts and ${safe(counts.pendingReview)} items awaiting your review. These are preparation counts, not customers or sales. Open your private dashboard to review them.`;
    const settings = this.settings(), results: UpdateResult[] = [];
    if (settings.emailEnabled) results.push(await this.submit("email", "digest", `digest:${day(this.clock())}`, text));
    if (settings.messageEnabled) results.push(await this.submit("message", "digest", `digest:${day(this.clock())}`, text));
    return results;
  }
  async dailyTick(): Promise<void> {
    if (this.settings().dailyDigest && hour(this.clock()) >= 9) await this.digest();
    await this.options.atlas.jobs.runOnce(20, this.clock());
    this.reconcileNotificationDeliveries();
  }
  private async submit(channel: UpdateJob["channel"], kind: UpdateJob["kind"], eventKey: string, text: string, notificationId?: string): Promise<UpdateResult> {
    if (!this.origin()) return { accepted: false, simulated: false, detail: "A fixed HTTPS Jarvis address is required for owner updates." };
    const settings = this.settings();
    if (channel === "email" ? !settings.emailEnabled || !settings.email : !settings.messageEnabled) return { accepted: false, simulated: false, detail: `${channel === "email" ? "Email" : "Message"} owner updates are disabled. Save the recipient and enable this channel first.` };
    if (!eventKey.trim() || eventKey.length > 512) return { accepted: false, simulated: false, detail: "A bounded update event key is required." };
    const idempotencyKey = `owner-update:${channel}:${hash(eventKey)}`;
    const existing = this.store.getJobByKey(idempotencyKey);
    if (existing) return this.result(existing);
    const quotaKey = `owner-updates.quota:${day(this.clock())}:${channel}`;
    const reserved = this.store.getMemory<number>(quotaKey) ?? 0;
    if (reserved >= 20) return { accepted: false, simulated: false, detail: "Daily owner update submission limit reached; review the dashboard." };
    const payload: UpdateJob = { channel, kind, eventKey, settingsVersion: this.version(), text, notificationId, day: day(this.clock()) };
    // Reserve allowance before the job: a crash can lose one allowance, never create an extra send.
    this.store.setMemory(quotaKey, reserved + 1);
    const queued = this.options.atlas.jobs.enqueue(JOB, payload, { idempotencyKey, maxAttempts: 1, runAfter: this.clock() });
    await this.options.atlas.jobs.runOnce(20, this.clock());
    return this.result(this.store.getJobByKey(idempotencyKey) ?? queued.job);
  }
  private result(job: StoredJob): UpdateResult {
    return job.status === "succeeded" && job.result ? job.result as UpdateResult : { accepted: false, simulated: false, detail: job.status === "queued" || job.status === "running" ? "The owner update is queued. Provider acceptance has not been recorded." : "The owner update failed or its outcome is uncertain. Automatic retry is disabled; check the provider before another attempt." };
  }
  private async execute(payload: UpdateJob, job: StoredJob): Promise<UpdateResult> {
    const guard = () => {
      const settings = this.settings();
      if (payload.day !== day(this.clock()) || payload.settingsVersion !== this.version() || (payload.channel === "email" ? !settings.emailEnabled || !settings.email : !settings.messageEnabled)) throw new Error("Owner update settings changed or the queued day expired. No provider request was made.");
      return settings;
    };
    guard();
    if (this.options.mode === "fake") return { accepted: false, simulated: true, providerRef: `fictional-${job.id}`, acceptedAt: this.clock().toISOString(), detail: "Fictional owner update recorded locally; nothing was sent." };
    if (payload.channel === "email") {
      const status = await this.options.mailer.status(), settings = guard();
      if (status.state !== "connected" || !status.sender || !EMAIL.test(status.sender)) throw new Error("The selected owner email sender is not verified. No email was submitted.");
      try {
        const result = await this.options.mailer.send({ from: status.sender, to: settings.email, subject: payload.kind === "digest" ? "Jarvis · your daily studio update" : payload.kind === "test" ? "Jarvis · owner update test" : "Jarvis · an update needs your attention", text: `${payload.text}\n\n${this.origin()}/\n\nManage email and message updates in your private Jarvis settings.`, approvalId: `owner-update-${hash(payload.settingsVersion).slice(0, 32)}`, idempotencyKey: `owner-${job.id}`, unsubscribeUrl: `${this.origin()}/?settings=updates`, purpose: "owner_update" });
        if (!result.providerRef || result.providerRef.length > 200 || !Number.isFinite(Date.parse(result.acceptedAt))) throw new Error();
        return { accepted: true, simulated: false, ...result, detail: "Email provider accepted your owner update. Inbox delivery is not confirmed." };
      } catch { throw new Error("Owner email submission failed or its outcome is uncertain. Automatic retry is disabled; check the provider before another attempt."); }
    }
    const status = await this.messageStatus(); guard(); const creds = this.telegram();
    if (status.state !== "connected" || !creds || this.store.getMemory("owner-updates.telegram.disabled") === true && !this.store.getMemory(TELEGRAM)) throw new Error("The private message recipient is not verified. No message was submitted.");
    try {
      const response = await this.telegramRequest(creds, "sendMessage", { chat_id: creds.chatId, text: `${payload.text}\n\n${this.origin()}/`, disable_web_page_preview: true });
      const chat = response.chat;
      if (typeof response.message_id !== "number" || !Number.isSafeInteger(response.message_id) || response.message_id < 1 || !chat || typeof chat !== "object" || (chat as any).type !== "private" || String((chat as any).id) !== creds.chatId) throw new Error();
      return { accepted: true, simulated: false, providerRef: `telegram:${creds.chatId}:${response.message_id}`, acceptedAt: this.clock().toISOString(), detail: "Telegram accepted your private message. Phone receipt and owner acknowledgement are not confirmed." };
    } catch { throw new Error("Owner message submission failed or its outcome is uncertain. Automatic retry is disabled; check Telegram before another attempt."); }
  }
  private reconcileNotificationDeliveries(): void {
    for (const job of this.store.listJobs(500).filter(j => j.type === JOB && j.status === "succeeded")) {
      const p = job.payload as UpdateJob, r = job.result as UpdateResult;
      if (!p.notificationId || !r?.accepted || r.simulated || !r.providerRef || !r.acceptedAt) continue;
      const notification = this.store.getDoc<Notification>("notifications", p.notificationId)?.doc;
      if (!notification) continue;
      const channel = p.channel === "email" ? "email" as const : "push" as const;
      if (!notification.deliveries.some(d => d.channel === channel && d.providerRef === r.providerRef)) { notification.deliveries.push({ channel, at: r.acceptedAt, providerRef: r.providerRef }); this.store.upsertDoc("notifications", notification.id, notification); }
    }
  }
}

/** Install after the existing /api owner cookie + same-origin JSON middleware. */
export function installOwnerUpdateRoutes(app: Hono, service: OwnerUpdates): void {
  const parse = async (c: Context) => { const value: unknown = await c.req.json(); if (!value || typeof value !== "object" || Array.isArray(value)) throw new OwnerUpdateError("Provide an owner update request object."); return value as Record<string, unknown>; };
  const empty = (value: Record<string, unknown>) => { if (Object.keys(value).length) throw new OwnerUpdateError("Provide an empty request object."); };
  const failure = (c: Context, error: unknown) => c.json({ error: error instanceof OwnerUpdateError ? error.message : "The owner update action could not finish. Check the connection and try again." }, error instanceof OwnerUpdateError ? error.status : error instanceof SyntaxError ? 400 : 503);
  app.get("/api/owner-updates", async c => { try { return c.json(await service.snapshot()); } catch (e) { return failure(c, e); } });
  app.post("/api/owner-updates/settings", async c => { try { service.saveSettings(await parse(c)); return c.json(await service.snapshot()); } catch (e) { return failure(c, e); } });
  app.post("/api/owner-updates/telegram/connect", async c => { try { await service.connectTelegram(await parse(c)); return c.json(await service.snapshot()); } catch (e) { return failure(c, e); } });
  app.post("/api/owner-updates/telegram/disconnect", async c => { try { empty(await parse(c)); service.disconnectTelegram(); return c.json(await service.snapshot()); } catch (e) { return failure(c, e); } });
  app.post("/api/owner-updates/test", async c => { try { const input = await parse(c); if (Object.keys(input).some(k => k !== "channel")) throw new OwnerUpdateError("Choose the test channel only."); const result = await service.test(input.channel); return c.json({ result, snapshot: await service.snapshot() }); } catch (e) { return failure(c, e); } });
  app.post("/api/owner-updates/digest", async c => { try { empty(await parse(c)); const results = await service.digest(); return c.json({ results, snapshot: await service.snapshot() }); } catch (e) { return failure(c, e); } });
}

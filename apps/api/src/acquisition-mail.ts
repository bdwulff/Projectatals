import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { PermissionLevel, requiredLevel, type Store, type StoredJob } from "@atlas/core";

export interface AcquisitionMailInput {
  from: string; to: string; subject: string; text: string;
  approvalId: string; idempotencyKey: string; unsubscribeUrl: string;
  purpose?: "outreach" | "owner_update";
}
export interface AcquisitionMailStatus {
  state: "connected" | "not_connected" | "error" | "fake";
  provider: string; detail: string; sender?: string;
}
export interface AcquisitionMailResult { providerRef: string; acceptedAt: string }
export interface AcquisitionMailTransport {
  status(): Promise<AcquisitionMailStatus>;
  send(input: AcquisitionMailInput): Promise<AcquisitionMailResult>;
}
export type AcquisitionMailProvider = "gmail" | "resend";
export interface AcquisitionMailProviderInfo {
  id: AcquisitionMailProvider;
  name: string;
  description: string;
  requiredSettings: readonly string[];
  setupSteps: readonly string[];
  notes: readonly string[];
}
/** Public setup guidance only. OAuth client secrets stay in server storage after the private owner form. */
export const ACQUISITION_MAIL_PROVIDERS: readonly AcquisitionMailProviderInfo[] = [
  {
    id: "resend", name: "Own business email · Resend",
    description: "Send from a verified domain you own, with replies arriving at your existing mailbox. Its inbox can be hosted by Microsoft 365, Fastmail, Zoho or another provider.",
    requiredSettings: ["RESEND_API_KEY", "ATLAS_OUTREACH_FROM"],
    setupSteps: [
      "Use a domain you already own. Resend cannot authorise sending as an unrelated gmail.com, outlook.com, icloud.com or other provider-owned address.",
      "In Resend, add the exact sender domain and add its displayed DNS verification records at your domain host. Wait until the domain status is Verified.",
      "Create a Resend API key that can read verified domains and send email. Save it privately as RESEND_API_KEY in the existing Jarvis Railway service.",
      "Set ATLAS_OUTREACH_FROM to the exact address to send as, such as hello@your-business-domain. Use an existing working inbox so replies reach you.",
      "Deploy the pending Railway variable changes, select Resend in Jarvis, then check the sender status and matching sender profile.",
    ],
    notes: [
      "Resend handles outbound sending; it does not create or read your mailbox.",
      "Recipients may use any email provider. Gmail and Google sign-in are not required for this connection.",
      "Setup checks read the provider's verified-domain list; they do not send an email. Every prospect email still needs its exact owner approval.",
      "An existing domain, DNS access and a Resend account are required. No subscription or domain purchase is made by Jarvis. Check the provider's current free-plan limits and charges before enabling sends.",
    ],
  },
  {
    id: "gmail", name: "Google mailbox · Gmail API",
    description: "Read the intended Gmail inbox and send exact approved messages through Google sign-in.",
    requiredSettings: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    setupSteps: [
      "Save the intended mailbox in Jarvis. Create the Google Web OAuth client using the setup guide, then save its settings in Jarvis’s private client form or Railway Variables.",
      "Choose Connect Gmail and sign in to the intended account. Grant read-only inbox and sending permissions. Linking does not send an email.",
      "The verified account must match the intended address and sender profile. Read the inbox explicitly from Mail; approve each exact prospect email in Studio.",
    ],
    notes: [
      "The hosted Jarvis connection is separate from ChatGPT's Gmail connector.",
      "Only the linked address is authorised. A testing-mode Google app may require relinking after seven days.",
    ],
  },
];
export interface SelectableAcquisitionMailConfig {
  store: Store;
  transports: Record<AcquisitionMailProvider, AcquisitionMailTransport>;
  defaultProvider?: string;
}
/** Explicit owner selection, with no credential-based or failed-provider fallback. */
export class SelectableAcquisitionMailTransport implements AcquisitionMailTransport {
  private activeSends = 0;
  private epoch = 0;
  constructor(private readonly config: SelectableAcquisitionMailConfig) {}
  selected(): AcquisitionMailProvider | null {
    const saved = this.config.store.getMemory<unknown>("acquisition.mail.provider");
    const value = saved ?? this.config.defaultProvider ?? "gmail";
    return value === "gmail" || value === "resend" ? value : null;
  }
  /** Owner-authenticated settings route only. Selection does not authorise an email. */
  select(provider: unknown): AcquisitionMailProvider {
    if (provider !== "gmail" && provider !== "resend") throw new AcquisitionMailError("invalid_request", "Choose Gmail or Resend as the sending connection.");
    if (this.activeSends > 0) throw new AcquisitionMailError("unavailable", "An email submission is in progress. Wait for its recorded outcome before changing the sending connection.");
    this.config.store.setMemory("acquisition.mail.provider", provider);
    this.epoch++;
    return provider;
  }
  async providers(): Promise<{ selected: AcquisitionMailProvider | null; providers: Array<AcquisitionMailProviderInfo & { selected: boolean; status: AcquisitionMailStatus }> }> {
    const selected = this.selected();
    const providers = await Promise.all(ACQUISITION_MAIL_PROVIDERS.map(async info => ({ ...info, selected: info.id === selected, status: await this.providerStatus(info.id) })));
    return { selected, providers };
  }
  private async providerStatus(provider: AcquisitionMailProvider): Promise<AcquisitionMailStatus> {
    try { return await this.config.transports[provider].status(); }
    catch { return { state: "error", provider: provider === "resend" ? "Resend" : "Gmail API", detail: "The sending connection could not be checked. No fallback connection was selected." }; }
  }
  async status(): Promise<AcquisitionMailStatus> {
    const selected = this.selected(), epoch = this.epoch;
    if (!selected) return { state: "error", provider: "Email", detail: "The saved sending connection is invalid. Select Gmail or Resend in Jarvis; no automatic fallback will be used." };
    const status = await this.providerStatus(selected);
    if (epoch !== this.epoch || selected !== this.selected()) return { state: "error", provider: "Email", detail: "The sending connection changed during verification. Check its current status before sending." };
    return status;
  }
  async send(input: AcquisitionMailInput): Promise<AcquisitionMailResult> {
    validateMail(input);
    const selected = this.selected();
    if (!selected) throw new AcquisitionMailError("not_configured", "Select an authorised sending connection first.");
    // Reserve selection synchronously before the provider's first asynchronous check.
    // A changed account never receives the payload midway through a submission.
    this.activeSends++;
    try { return await this.config.transports[selected].send(input); }
    finally { this.activeSends--; }
  }
}

export class AcquisitionMailError extends Error {
  constructor(public readonly code: "not_configured" | "invalid_request" | "unavailable" | "sender_mismatch" | "oauth_state" | "uncertain", message: string) {
    super(message); this.name = "AcquisitionMailError";
  }
}
interface NetworkConfig { request?: typeof fetch; timeoutMs?: number; clock?: () => Date; maxResponseBytes?: number }
export interface ResendAcquisitionMailConfig extends NetworkConfig {
  apiKey?: string; fromAddress?: string; store?: Store;
}
export interface GmailAcquisitionMailConfig extends NetworkConfig {
  clientId?: string; clientSecret?: string; publicOrigin?: string; ownerAccessKey?: string; store: Store; expectedEmail?: string; enabled?: boolean;
}
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const CALLBACK_PATH = "/integrations/google/callback";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GOOGLE_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GOOGLE_REQUESTED_SCOPES = ["openid", "email", GOOGLE_SCOPE, GOOGLE_READ_SCOPE] as const;
const GOOGLE_CLIENT_COLLECTION = "acquisition_google_oauth_client";
const GOOGLE_EXPECTED_EMAIL = "acquisition.google.expectedEmail";
const GMAIL_MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const STATE_COLLECTION = "acquisition_google_oauth_state";
const LINK_COLLECTION = "acquisition_google_oauth_link";
const LINK_ID = "owner";
const MAX_RESPONSE = 65_536;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const safeSecret = (value: unknown, max = 8192): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x20\x7f]/.test(value);
function emailAddress(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(value)) return false;
  const local = value.split("@")[0]!;
  return !local.startsWith(".") && !local.endsWith(".") && !local.includes("..");
}
const providerId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{8,256}$/.test(value);
function publicOrigin(value: string | undefined): string | null {
  try {
    const u = new URL(value ?? "");
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || u.pathname !== "/") return null;
    if (["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return null;
    return u.origin;
  } catch { return null; }
}
function validateMail(input: AcquisitionMailInput): void {
  if (input?.purpose !== undefined && input.purpose !== "outreach" && input.purpose !== "owner_update") throw new AcquisitionMailError("invalid_request", "Unsupported email purpose.");
  if (!input || !emailAddress(input.from) || !emailAddress(input.to)) throw new AcquisitionMailError("invalid_request", "Provide one valid sender and one recipient email address.");
  if (typeof input.subject !== "string" || !input.subject.trim() || input.subject.length > 240 || /[\x00-\x1f\x7f]/.test(input.subject)) throw new AcquisitionMailError("invalid_request", "Email subject is empty, too long or contains unsafe header characters.");
  if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 25_000 || Buffer.byteLength(input.text) > 80_000 || /[\x00\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.text)) throw new AcquisitionMailError("invalid_request", "Email text is empty, too long or contains unsupported control characters.");
  if (typeof input.approvalId !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(input.approvalId) || typeof input.idempotencyKey !== "string" || !/^[A-Za-z0-9_.:-]{1,256}$/.test(input.idempotencyKey)) throw new AcquisitionMailError("invalid_request", "An exact approval and bounded idempotency key are required.");
  try {
    if (typeof input.unsubscribeUrl !== "string") throw new Error();
    const u = new URL(input.unsubscribeUrl);
    if (u.protocol !== "https:" || u.username || u.password || u.hash || !/^[\x21-\x7e]+$/.test(input.unsubscribeUrl) || /[<>]/.test(input.unsubscribeUrl) || input.unsubscribeUrl.length > 900) throw new Error();
  } catch { throw new AcquisitionMailError("invalid_request", "A safe HTTPS unsubscribe URL is required."); }
}

/** One fixed-origin request, bounded through body consumption. Never retries or exposes provider text. */
async function boundedJson(url: string, init: RequestInit, config: NetworkConfig): Promise<Record<string, unknown>> {
  const request = config.request ?? fetch;
  const controller = new AbortController();
  const timeoutMs = Math.min(30_000, Math.max(10, config.timeoutMs ?? 10_000));
  const maxResponse = Math.min(1_048_576, Math.max(1024, config.maxResponseBytes ?? MAX_RESPONSE));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    const response = await request(url, { ...init, redirect: "error", signal: controller.signal });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new AcquisitionMailError("unavailable", `Provider request returned HTTP ${response.status}; details withheld.`); }
    const size = response.headers.get("content-length");
    if (size && (!/^\d+$/.test(size) || Number(size) > maxResponse)) { await response.body?.cancel().catch(() => {}); throw new AcquisitionMailError("unavailable", "Provider response exceeded the allowed size."); }
    if (!response.body) throw new AcquisitionMailError("unavailable", "Provider returned an empty response.");
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > maxResponse) { await reader.cancel(); throw new AcquisitionMailError("unavailable", "Provider response exceeded the allowed size."); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new AcquisitionMailError("unavailable", "Provider returned an invalid response."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new AcquisitionMailError("unavailable", "Provider returned an invalid response.");
    return body as Record<string, unknown>;
  })();
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new AcquisitionMailError("unavailable", "Provider request timed out; no automatic retry was made.")); }, timeoutMs); });
  try { return await Promise.race([work, timeout]); }
  catch (error) { if (error instanceof AcquisitionMailError) throw error; throw new AcquisitionMailError("unavailable", "Provider request failed; sensitive details were withheld and no automatic retry was made."); }
  finally { if (timer) clearTimeout(timer); }
}

/** Journal contains hashes/result metadata only. A unique SQLite key reserves submission before I/O. */
class SubmissionJournal {
  private readonly memory = new Map<string, StoredJob>();
  constructor(private readonly provider: string, private readonly store: Store | undefined, private readonly now: () => Date) {}
  reserve(input: AcquisitionMailInput): { job: StoredJob; previous?: AcquisitionMailResult } {
    const key = `acquisition-mail:${this.provider}:${hash(input.idempotencyKey)}`;
    const payloadHash = hash(JSON.stringify([input.from, input.to, input.subject, input.text, input.approvalId, input.idempotencyKey, input.unsubscribeUrl, input.purpose ?? "outreach"]));
    const prior = this.store?.getJobByKey(key) ?? this.memory.get(key);
    if (prior) return { job: prior, previous: this.previous(prior, payloadHash) };
    const at = this.now().toISOString();
    const job: StoredJob = { id: `mail_${randomBytes(16).toString("hex")}`, type: "acquisition_mail_attempt", payload: { payloadHash }, idempotencyKey: key, status: "running", attempts: 1, maxAttempts: 1, runAfter: at, lastError: null, result: null, createdAt: at, updatedAt: at };
    if (this.store) {
      try { this.store.insertJob(job); }
      catch {
        const existing = this.store.getJobByKey(key);
        if (existing) return { job: existing, previous: this.previous(existing, payloadHash) };
        throw new AcquisitionMailError("unavailable", "Email attempt could not be reserved in the durable journal.");
      }
    } else this.memory.set(key, job);
    return { job };
  }
  private previous(job: StoredJob, payloadHash: string): AcquisitionMailResult {
    if ((job.payload as { payloadHash?: unknown })?.payloadHash !== payloadHash) throw new AcquisitionMailError("invalid_request", "The email payload changed for an existing idempotency key.");
    const result = job.result as Partial<AcquisitionMailResult> | null;
    if (job.status === "succeeded" && result && providerId(result.providerRef) && typeof result.acceptedAt === "string") return { providerRef: result.providerRef, acceptedAt: result.acceptedAt };
    throw new AcquisitionMailError("uncertain", "A prior submission exists with an unresolved outcome. No automatic retry was made.");
  }
  finish(job: StoredJob, result: AcquisitionMailResult | null): void {
    job.updatedAt = this.now().toISOString(); job.status = result ? "succeeded" : "dead";
    job.result = result; job.lastError = result ? null : "Submission failed or outcome unknown; automatic retry disabled.";
    if (this.store) this.store.updateJob(job); else this.memory.set(job.idempotencyKey, job);
  }
}

export class ResendAcquisitionMailTransport implements AcquisitionMailTransport {
  private readonly now: () => Date; private readonly journal: SubmissionJournal;
  private cachedStatus: { at: number; value: AcquisitionMailStatus } | null = null;
  constructor(private readonly config: ResendAcquisitionMailConfig) {
    this.now = config.clock ?? (() => new Date()); this.journal = new SubmissionJournal("resend", config.store, this.now);
  }
  private configured(): boolean { return safeSecret(this.config.apiKey) && emailAddress(this.config.fromAddress); }
  async status(): Promise<AcquisitionMailStatus> {
    if (!this.configured()) return { state: "not_connected", provider: "Resend", detail: "Set RESEND_API_KEY and the exact authorised sender address. No email has been sent." };
    if (this.cachedStatus && this.now().getTime() - this.cachedStatus.at < 30_000) return this.cachedStatus.value;
    let value: AcquisitionMailStatus;
    try {
      const body = await boundedJson("https://api.resend.com/domains", { method: "GET", headers: { Authorization: `Bearer ${this.config.apiKey}`, Accept: "application/json" } }, this.config);
      const domain = this.config.fromAddress!.split("@")[1]!.toLowerCase();
      if (!Array.isArray(body.data) || body.data.length > 1000) throw new Error();
      const verified = body.data.some(item => item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string" && ((item as { name: string }).name).toLowerCase() === domain && (item as { status?: unknown }).status === "verified");
      value = verified ? { state: "connected", provider: "Resend", sender: this.config.fromAddress!, detail: "The sender domain is verified by Resend. Acceptance is recorded only after a send returns a provider ID." }
        : { state: "not_connected", provider: "Resend", detail: "The exact sender domain was not found as verified in the bounded domain listing. Check domain verification and key permissions." };
    } catch { value = { state: "error", provider: "Resend", detail: "Resend domain verification failed. Check domain-read permissions and credentials; sensitive details withheld." }; }
    this.cachedStatus = { at: this.now().getTime(), value }; return value;
  }
  async send(input: AcquisitionMailInput): Promise<AcquisitionMailResult> {
    validateMail(input);
    if (!this.configured()) throw new AcquisitionMailError("not_configured", "Resend is not configured.");
    if (input.from !== this.config.fromAddress) throw new AcquisitionMailError("sender_mismatch", "The email sender must exactly match the configured Resend sender.");
    if ((await this.status()).state !== "connected") throw new AcquisitionMailError("unavailable", "The Resend sender domain is not verified.");
    const reservation = this.journal.reserve(input); if (reservation.previous) return reservation.previous;
    try {
      const body = await boundedJson("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey }, body: JSON.stringify({ from: input.from, to: [input.to], subject: input.subject, text: input.text, headers: input.purpose === "owner_update" ? {} : { "List-Unsubscribe": `<${input.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }) }, this.config);
      if (!providerId(body.id)) throw new AcquisitionMailError("uncertain", "Resend did not return a valid provider ID; the submission requires review.");
      const result = { providerRef: body.id, acceptedAt: this.now().toISOString() }; this.journal.finish(reservation.job, result); return result;
    } catch { this.journal.finish(reservation.job, null); throw new AcquisitionMailError("uncertain", "Email submission failed or its outcome is unknown. No automatic retry was made."); }
  }
}

interface EncryptedValue { v: 1; iv: string; tag: string; ciphertext: string }
interface GoogleLink { email: string; refresh: EncryptedValue; linkedAt: string; scopes?: string[]; generation?: string }
interface OAuthState { expiresAt: number; verifier: EncryptedValue; expectedEmail?: string | null; clientId?: string }
interface SavedGoogleClient { clientId: string; secret: EncryptedValue }
interface OAuthClient { clientId: string; clientSecret: string }
export interface GmailMessageSummary {
  id: string; threadId: string; from: string; to: string; subject: string; snippet: string;
  date?: string; unread: boolean; labels: string[];
}
export interface GmailInbox { mailbox: string; messages: GmailMessageSummary[]; nextPageAvailable: boolean; estimatedTotal: number }
export interface GmailMessage extends GmailMessageSummary { text: string; htmlOmitted: boolean; attachmentsOmitted: number; contentTruncated: boolean; untrusted: true }

export class GmailAcquisitionMailTransport implements AcquisitionMailTransport {
  private readonly now: () => Date; private readonly journal: SubmissionJournal;
  private access: { token: string; expiresAt: number; email: string } | null = null;
  private cachedStatus: { at: number; value: AcquisitionMailStatus } | null = null;
  private refreshInFlight: Promise<string> | null = null;
  private readonly origin: string | null;
  private epoch = 0;
  constructor(private readonly config: GmailAcquisitionMailConfig) {
    this.now = config.clock ?? (() => new Date()); this.origin = publicOrigin(config.publicOrigin);
    this.journal = new SubmissionJournal("gmail", config.store, this.now);
  }
  private secureStorage(): boolean { return Boolean(this.origin && this.config.ownerAccessKey && this.config.ownerAccessKey.length >= 32 && this.config.ownerAccessKey.length <= 1024); }
  private client(): OAuthClient | null {
    if (this.config.enabled === false) return null;
    const saved = this.config.store.getDoc<SavedGoogleClient>(GOOGLE_CLIENT_COLLECTION, LINK_ID)?.doc;
    if (saved) {
      try { if (!validGoogleClientId(saved.clientId)) return null; const clientSecret = this.unseal(saved.secret, this.clientAAD(saved.clientId)); return safeSecret(clientSecret, 4096) ? { clientId: saved.clientId, clientSecret } : null; } catch { return null; }
    }
    return safeSecret(this.config.clientId) && safeSecret(this.config.clientSecret) ? { clientId: this.config.clientId, clientSecret: this.config.clientSecret } : null;
  }
  private configured(): boolean { try { this.expectedEmail(); return this.secureStorage() && this.client() !== null; } catch { return false; } }
  private expectedEmail(): string | null {
    const value = this.config.store.getMemory<unknown>(GOOGLE_EXPECTED_EMAIL) ?? this.config.expectedEmail ?? null;
    if (value === null) return null;
    if (!emailAddress(value)) throw new AcquisitionMailError("invalid_request", "The intended Gmail address is invalid. Save the mailbox address again.");
    return value.toLowerCase();
  }
  private sameIdentity(link: GoogleLink): boolean { const expected = this.expectedEmail(); return !expected || expected === link.email; }
  private key(): Buffer {
    if (!this.secureStorage()) throw new AcquisitionMailError("not_configured", "Secure owner authentication and the private HTTPS Jarvis origin are required for Gmail.");
    return createHash("sha256").update("atlas-acquisition-google-token-key-v1\0").update(this.config.ownerAccessKey!).digest();
  }
  private clientAAD(clientId: string): string { return `atlas-google-client-v1:${clientId}:${this.origin}`; }
  private linkAAD(): string { const client = this.client(); if (!client) throw new AcquisitionMailError("not_configured", "Gmail OAuth client is not configured."); return `atlas-google-link-v1:${client.clientId}:${this.origin}`; }
  private seal(text: string, aad = this.linkAAD()): EncryptedValue {
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]).toString("base64url");
    return { v: 1, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext };
  }
  private unseal(value: EncryptedValue, aad?: string): string {
    try {
      if (!value || value.v !== 1 || typeof value.iv !== "string" || typeof value.tag !== "string" || typeof value.ciphertext !== "string" || value.ciphertext.length > 20_000) throw new Error();
      const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(value.iv, "base64url"));
      decipher.setAAD(Buffer.from(aad ?? this.linkAAD())); decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64url")), decipher.final()]).toString("utf8");
    } catch { throw new AcquisitionMailError("unavailable", "The saved Gmail connection cannot be read. Reconfigure or relink it."); }
  }
  /** Non-secret identity changes require a fresh exact outgoing draft review. */
  identity(): string {
    const client = this.client(), link = this.link();
    return `gmail:${hash(JSON.stringify([client?.clientId ?? null, this.expectedEmail(), this.config.store.getMemory("acquisition.google.configurationGeneration") ?? null, link?.email ?? null, link?.generation ?? link?.linkedAt ?? null, link?.scopes ?? [GOOGLE_SCOPE]])).slice(0, 32)}`;
  }
  configurationStatus() {
    const saved = this.config.store.getDoc<SavedGoogleClient>(GOOGLE_CLIENT_COLLECTION, LINK_ID)?.doc, client = this.client(), link = this.link();
    let expectedEmail: string | null = null; try { expectedEmail = this.expectedEmail(); } catch { /* Configuration is reported unavailable below. */ }
    const configured = this.configured(), same = Boolean(link && (!expectedEmail || expectedEmail === link.email));
    const grantedScopes = link ? googleScopes(link) : [];
    return { configured, source: saved ? "saved" as const : client ? "environment" as const : null,
      expectedEmail, linkedEmail: link?.email ?? null, clientIdHint: client ? `${client.clientId.slice(0, 16)}…apps.googleusercontent.com` : null,
      redirectUri: this.origin ? this.origin + CALLBACK_PATH : null, scopes: [...GOOGLE_REQUESTED_SCOPES], grantedScopes,
      inboxReady: configured && same && grantedScopes.includes(GOOGLE_READ_SCOPE),
      requiresRelink: Boolean(link && (!same || !grantedScopes.includes(GOOGLE_READ_SCOPE))),
    };
  }
  /** These settings methods are only for the authenticated owner's private configuration form. */
  setExpectedEmail(email: string): void {
    if (!emailAddress(email)) throw new AcquisitionMailError("invalid_request", "Provide the exact Gmail or Google Workspace mailbox address.");
    const next = email.toLowerCase(); let previous: string | null = null; try { previous = this.expectedEmail(); } catch { /* Allow an explicit valid owner correction. */ } if (previous === next) return;
    this.disconnect(); this.config.store.setMemory(GOOGLE_EXPECTED_EMAIL, next);
    this.config.store.setMemory("acquisition.google.configurationGeneration", randomBytes(16).toString("hex"));
  }
  saveOAuthClient(input: { clientId: string; clientSecret: string }): void {
    if (this.config.enabled === false) throw new AcquisitionMailError("not_configured", "Fictional mode does not configure a real Google client.");
    validateGoogleOAuthClient(input);
    const sealed = this.seal(input.clientSecret, this.clientAAD(input.clientId));
    this.disconnect();
    this.config.store.upsertDoc<SavedGoogleClient>(GOOGLE_CLIENT_COLLECTION, LINK_ID, { clientId: input.clientId, secret: sealed });
    this.config.store.setMemory("acquisition.google.configurationGeneration", randomBytes(16).toString("hex"));
  }
  clearOAuthClient(): void {
    this.disconnect(); this.config.store.deleteDoc(GOOGLE_CLIENT_COLLECTION, LINK_ID);
    this.config.store.setMemory("acquisition.google.configurationGeneration", randomBytes(16).toString("hex"));
  }
  /** Must only be exposed through an authenticated owner mutation route. */
  startLink(): { url: string } {
    if (!this.configured()) throw new AcquisitionMailError("not_configured", "Configure the Google Web OAuth client in Jarvis, or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET privately, before linking Gmail.");
    const client = this.client()!, expectedEmail = this.expectedEmail();
    this.epoch++;
    for (const row of this.config.store.listDocs<OAuthState>(STATE_COLLECTION, 100)) this.config.store.deleteDoc(STATE_COLLECTION, row.id);
    const state = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url");
    this.config.store.upsertDoc<OAuthState>(STATE_COLLECTION, hash(state), { expiresAt: this.now().getTime() + 10 * 60_000, verifier: this.seal(verifier), expectedEmail, clientId: client.clientId });
    const url = new URL(AUTH_URL); url.search = new URLSearchParams({ client_id: client.clientId, redirect_uri: this.origin + CALLBACK_PATH, response_type: "code", scope: GOOGLE_REQUESTED_SCOPES.join(" "), access_type: "offline", prompt: "consent", state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", include_granted_scopes: "false", ...(expectedEmail ? { login_hint: expectedEmail } : {}) }).toString();
    return { url: url.toString() };
  }
  async completeLink(code: string, state: string): Promise<void> {
    if (!this.configured()) throw new AcquisitionMailError("not_configured", "Gmail connection is not configured.");
    if (typeof state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new AcquisitionMailError("oauth_state", "Gmail link request is invalid or expired. Start again from Jarvis.");
    const saved = this.config.store.getDoc<OAuthState>(STATE_COLLECTION, hash(state));
    if (!saved) throw new AcquisitionMailError("oauth_state", "Gmail link request is invalid, already used or expired. Start again from Jarvis.");
    this.config.store.deleteDoc(STATE_COLLECTION, hash(state));
    const client = this.client()!, expectedEmail = this.expectedEmail();
    if (saved.doc.expiresAt <= this.now().getTime() || !safeSecret(code, 4096) || (saved.doc.clientId && saved.doc.clientId !== client.clientId) || (saved.doc.expectedEmail !== undefined && saved.doc.expectedEmail !== expectedEmail)) throw new AcquisitionMailError("oauth_state", "Gmail link request expired or its client/mailbox settings changed. Start again.");
    const epoch = this.epoch;
    try {
      const token = await boundedJson(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, code, grant_type: "authorization_code", redirect_uri: this.origin + CALLBACK_PATH, code_verifier: this.unseal(saved.doc.verifier) }) }, this.config);
      this.validateToken(token, true);
      if (!safeSecret(token.refresh_token)) throw new AcquisitionMailError("unavailable", "Google did not provide an offline connection. Start linking again and grant consent.");
      const user = await boundedJson(USERINFO_URL, { method: "GET", headers: { Authorization: `Bearer ${token.access_token}` } }, this.config);
      if (!emailAddress(user.email) || user.email_verified !== true) throw new AcquisitionMailError("unavailable", "Google did not verify an email identity for this account.");
      if (this.epoch !== epoch || this.client()?.clientId !== client.clientId || this.expectedEmail() !== expectedEmail) throw new AcquisitionMailError("oauth_state", "This Gmail link was cancelled or changed. Start again from Jarvis.");
      const email = user.email.toLowerCase();
      if (expectedEmail && email !== expectedEmail) throw new AcquisitionMailError("sender_mismatch", "Google signed in to a different mailbox. Start again and choose the intended Gmail address.");
      const scopes = scopeList(token.scope), generation = randomBytes(16).toString("hex");
      this.config.store.upsertDoc<GoogleLink>(LINK_COLLECTION, LINK_ID, { email, refresh: this.seal(token.refresh_token), linkedAt: this.now().toISOString(), scopes, generation });
      this.access = { token: token.access_token as string, expiresAt: this.now().getTime() + (token.expires_in as number) * 1000, email };
      this.cachedStatus = { at: this.now().getTime(), value: { state: "connected", provider: "Gmail API", sender: email, detail: "Google verified the intended mailbox and granted read-only inbox access plus sending. No email was sent by linking." } };
    } catch (error) { if (error instanceof AcquisitionMailError) throw error; throw new AcquisitionMailError("unavailable", "Gmail linking failed; sensitive provider details were withheld."); }
  }
  private validateToken(token: Record<string, unknown>, requireScopes = false, granted: readonly string[] = [GOOGLE_SCOPE]): void {
    if (!safeSecret(token.access_token) || typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in <= 0 || token.expires_in > 86_400 || (typeof token.token_type === "string" && token.token_type.toLowerCase() !== "bearer")) throw new AcquisitionMailError("unavailable", "Google returned an invalid access token response.");
    if ((token.scope !== undefined && typeof token.scope !== "string") || (token.token_type !== undefined && typeof token.token_type !== "string")) throw new AcquisitionMailError("unavailable", "Google returned invalid token permission metadata.");
    const scopes = scopeList(token.scope), required = requireScopes ? [GOOGLE_SCOPE, GOOGLE_READ_SCOPE] : granted.filter(s => s === GOOGLE_SCOPE || s === GOOGLE_READ_SCOPE);
    if ((requireScopes && typeof token.scope !== "string") || (typeof token.scope === "string" && required.some(s => !scopes.includes(s)))) throw new AcquisitionMailError("unavailable", "Google did not grant the requested Gmail sending and read-only permissions. Relink the account.");
  }
  private link(): GoogleLink | null { return this.config.store.getDoc<GoogleLink>(LINK_COLLECTION, LINK_ID)?.doc ?? null; }
  private assertCurrent(link: GoogleLink, epoch: number): void {
    const current = this.link();
    if (this.epoch !== epoch || !current || current.email !== link.email || current.linkedAt !== link.linkedAt || current.generation !== link.generation || !this.sameIdentity(current)) throw new AcquisitionMailError("unavailable", "Gmail was disconnected, relinked or its intended address changed during this request.");
  }
  private async accessToken(link: GoogleLink): Promise<string> {
    this.assertCurrent(link, this.epoch);
    if (this.access?.email === link.email && this.access.expiresAt > this.now().getTime() + 30_000) return this.access.token;
    if (this.refreshInFlight) return this.refreshInFlight;
    const epoch = this.epoch, client = this.client();
    if (!client) throw new AcquisitionMailError("not_configured", "Gmail connection is not configured.");
    const pending = (async () => {
      const token = await boundedJson(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, refresh_token: this.unseal(link.refresh), grant_type: "refresh_token" }) }, this.config);
      this.validateToken(token, false, googleScopes(link)); this.assertCurrent(link, epoch);
      this.access = { token: token.access_token as string, expiresAt: this.now().getTime() + (token.expires_in as number) * 1000, email: link.email };
      return this.access.token;
    })();
    this.refreshInFlight = pending;
    try { return await pending; } finally { if (this.refreshInFlight === pending) this.refreshInFlight = null; }
  }
  async status(): Promise<AcquisitionMailStatus> {
    if (!this.configured()) return { state: "not_connected", provider: "Gmail API", detail: "Configure a Google Web OAuth client in Jarvis or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET privately. ChatGPT's Gmail connection is separate." };
    const link = this.link();
    if (!link) return { state: "not_connected", provider: "Gmail API", detail: "Link the intended Gmail account from Jarvis. No email has been sent." };
    if (!this.sameIdentity(link)) return { state: "error", provider: "Gmail API", detail: "The linked account does not match the intended mailbox. Reconnect the intended Gmail account." };
    if (this.cachedStatus && this.now().getTime() - this.cachedStatus.at >= 0 && this.now().getTime() - this.cachedStatus.at < 30_000) return this.cachedStatus.value;
    let value: AcquisitionMailStatus;
    const epoch = this.epoch;
    try {
      if (!emailAddress(link.email)) throw new Error();
      const token = await this.accessToken(link);
      const user = await boundedJson(USERINFO_URL, { method: "GET", headers: { Authorization: `Bearer ${token}` } }, this.config);
      this.assertCurrent(link, epoch);
      if (user.email_verified !== true || typeof user.email !== "string" || user.email.toLowerCase() !== link.email) throw new Error();
      value = { state: "connected", provider: "Gmail API", sender: link.email, detail: googleScopes(link).includes(GOOGLE_READ_SCOPE) ? "The intended Gmail mailbox is verified for read-only inbox access and approved sending." : "The linked sender is verified; reconnect Gmail to grant read-only inbox access. Sending still needs exact owner approval." };
    } catch { value = { state: "error", provider: "Gmail API", detail: "Gmail identity verification failed. Relink the intended account if access was revoked; no email was sent by this check." }; }
    const current = this.link();
    if (this.epoch === epoch && current?.email === link.email && current.linkedAt === link.linkedAt && current.generation === link.generation) this.cachedStatus = { at: this.now().getTime(), value };
    return value;
  }
  private async readContext(): Promise<{ link: GoogleLink; epoch: number; token: string }> {
    if (!this.configured()) throw new AcquisitionMailError("not_configured", "Configure and link the intended Gmail account before reading messages.");
    const link = this.link();
    if (!link || !this.sameIdentity(link)) throw new AcquisitionMailError("not_configured", "Link the intended Gmail account before reading messages.");
    if (!googleScopes(link).includes(GOOGLE_READ_SCOPE)) throw new AcquisitionMailError("unavailable", "Reconnect Gmail to grant read-only inbox access. No message was read.");
    const epoch = this.epoch;
    const status = await this.status(); this.assertCurrent(link, epoch);
    if (status.state !== "connected") throw new AcquisitionMailError("unavailable", "The intended Gmail account could not be verified for inbox reading.");
    const token = await this.accessToken(link); this.assertCurrent(link, epoch);
    return { link, epoch, token };
  }
  async listInbox(input: { limit?: number; query?: string; pageToken?: string } = {}): Promise<GmailInbox> {
    if (requiredLevel("read.mail.inbox") !== PermissionLevel.Read) throw new AcquisitionMailError("unavailable", "Inbox reading is unavailable under the current action policy.");
    const limit = input.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20 || (input.query !== undefined && (typeof input.query !== "string" || input.query.length > 200 || /[\x00-\x1f\x7f]/.test(input.query))) || (input.pageToken !== undefined && !safeSecret(input.pageToken, 512))) throw new AcquisitionMailError("invalid_request", "List one to twenty inbox messages with a bounded plain-text search.");
    const ctx = await this.readContext(), url = new URL(GMAIL_MESSAGES_URL);
    url.searchParams.set("labelIds", "INBOX"); url.searchParams.set("maxResults", String(limit)); if (input.query) url.searchParams.set("q", input.query); if (input.pageToken) url.searchParams.set("pageToken", input.pageToken);
    const data = await boundedJson(url.href, { method: "GET", headers: { Authorization: `Bearer ${ctx.token}` } }, this.config); this.assertCurrent(ctx.link, ctx.epoch);
    if (data.messages !== undefined && !Array.isArray(data.messages)) throw new AcquisitionMailError("unavailable", "Google returned an invalid inbox listing.");
    const ids = (data.messages ?? []) as unknown[];
    if (ids.length > limit || ids.some(v => !v || typeof v !== "object" || !providerId((v as Record<string, unknown>).id))) throw new AcquisitionMailError("unavailable", "Google returned an invalid bounded inbox listing.");
    const unique = [...new Set(ids.map(v => (v as { id: string }).id))], messages: GmailMessageSummary[] = [], deadline = Date.now() + 25_000;
    for (let offset = 0; offset < unique.length; offset += 4) {
      this.assertCurrent(ctx.link, ctx.epoch);
      const batch = await Promise.all(unique.slice(offset, offset + 4).map(async id => {
        const detail = new URL(`${GMAIL_MESSAGES_URL}/${id}`); detail.searchParams.set("format", "metadata");
        for (const header of ["From", "To", "Subject", "Date"]) detail.searchParams.append("metadataHeaders", header);
        const remaining = deadline - Date.now(); if (remaining <= 0) throw new AcquisitionMailError("unavailable", "Inbox metadata reading timed out. No messages were changed.");
        const body = await boundedJson(detail.href, { method: "GET", headers: { Authorization: `Bearer ${ctx.token}` } }, { ...this.config, timeoutMs: Math.min(this.config.timeoutMs ?? 10_000, remaining, 5000) });
        this.assertCurrent(ctx.link, ctx.epoch); return gmailSummary(body, id);
      }));
      messages.push(...batch);
    }
    const estimatedTotal = typeof data.resultSizeEstimate === "number" && Number.isSafeInteger(data.resultSizeEstimate) && data.resultSizeEstimate >= 0 ? data.resultSizeEstimate : messages.length;
    return { mailbox: ctx.link.email, messages, nextPageAvailable: typeof data.nextPageToken === "string" && data.nextPageToken.length > 0, estimatedTotal };
  }
  async readMessage(id: string): Promise<GmailMessage> {
    if (requiredLevel("read.mail.message") !== PermissionLevel.Read) throw new AcquisitionMailError("unavailable", "Message reading is unavailable under the current action policy.");
    if (!providerId(id)) throw new AcquisitionMailError("invalid_request", "Provide a valid Gmail message ID.");
    const ctx = await this.readContext();
    const url = new URL(`${GMAIL_MESSAGES_URL}/${id}`); url.searchParams.set("format", "full");
    const data = await boundedJson(url.href, { method: "GET", headers: { Authorization: `Bearer ${ctx.token}` } }, { ...this.config, maxResponseBytes: 1_048_576 });
    this.assertCurrent(ctx.link, ctx.epoch);
    return { ...gmailSummary(data, id), ...gmailBody(data.payload), untrusted: true };
  }
  async send(input: AcquisitionMailInput): Promise<AcquisitionMailResult> {
    validateMail(input);
    if (!this.configured()) throw new AcquisitionMailError("not_configured", "Gmail connection is not configured.");
    const epoch = this.epoch, link = this.link();
    if (!link) throw new AcquisitionMailError("not_configured", "Link Gmail before sending.");
    if (!this.sameIdentity(link) || input.from !== link.email) throw new AcquisitionMailError("sender_mismatch", "The sender must exactly match the intended, verified Gmail address.");
    const status = await this.status();
    if (status.state !== "connected") throw new AcquisitionMailError("unavailable", "The linked Gmail sender could not be verified.");
    if (status.sender !== input.from) throw new AcquisitionMailError("sender_mismatch", "The sender must match the currently verified Gmail identity.");
    this.assertCurrent(link, epoch);
    const reservation = this.journal.reserve(input); if (reservation.previous) return reservation.previous;
    try {
      const token = await this.accessToken(link); this.assertCurrent(link, epoch);
      const raw = mimeMessage(input).toString("base64url");
      const response = await boundedJson(GMAIL_SEND_URL, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw }) }, this.config);
      if (!providerId(response.id)) throw new AcquisitionMailError("uncertain", "Gmail did not return a valid message ID; submission requires review.");
      const result = { providerRef: response.id, acceptedAt: this.now().toISOString() }; this.journal.finish(reservation.job, result); return result;
    } catch { this.journal.finish(reservation.job, null); throw new AcquisitionMailError("uncertain", "Email submission failed or its outcome is unknown. No automatic retry was made."); }
  }
  disconnect(): void {
    this.epoch++;
    this.config.store.deleteDoc(LINK_COLLECTION, LINK_ID);
    for (const row of this.config.store.listDocs<OAuthState>(STATE_COLLECTION, 100)) this.config.store.deleteDoc(STATE_COLLECTION, row.id);
    this.access = null; this.cachedStatus = null; this.refreshInFlight = null;
  }
}
function validGoogleClientId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{6,200}\.apps\.googleusercontent\.com$/.test(value); }
/** Shared server-side validators keep malformed settings from changing provider selection. */
export function isGoogleMailboxAddress(value: unknown): value is string { return emailAddress(value); }
export function validateGoogleOAuthClient(input: { clientId: string; clientSecret: string }): void {
  if (!input || !validGoogleClientId(input.clientId) || !safeSecret(input.clientSecret, 4096)) throw new AcquisitionMailError("invalid_request", "Provide the Google Web application client ID and its client secret, without spaces or line breaks.");
}
function scopeList(value: unknown): string[] { return typeof value === "string" && value.length <= 8192 ? [...new Set(value.split(/\s+/).filter(Boolean))].slice(0, 64) : []; }
function googleScopes(link: GoogleLink): string[] { return Array.isArray(link.scopes) && link.scopes.every(s => typeof s === "string") ? link.scopes : [GOOGLE_SCOPE]; }
function mailText(value: unknown, limit: number): string { return typeof value === "string" ? value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ").slice(0, limit) : ""; }
function gmailSummary(data: Record<string, unknown>, expectedId: string): GmailMessageSummary {
  if (data.id !== expectedId) throw new AcquisitionMailError("unavailable", "Google returned a different message than requested.");
  const payload = data.payload && typeof data.payload === "object" && !Array.isArray(data.payload) ? data.payload as Record<string, unknown> : {};
  const headers = Array.isArray(payload.headers) ? payload.headers.slice(0, 100) : [];
  const header = (name: string, limit: number) => mailText((headers.find(h => h && typeof h === "object" && typeof (h as Record<string, unknown>).name === "string" && ((h as Record<string, unknown>).name as string).toLowerCase() === name) as Record<string, unknown> | undefined)?.value, limit);
  const labels = Array.isArray(data.labelIds) ? data.labelIds.filter((l): l is string => typeof l === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(l)).slice(0, 64) : [];
  const at = typeof data.internalDate === "string" && /^\d{1,15}$/.test(data.internalDate) ? Number(data.internalDate) : NaN;
  const date = Number.isFinite(at) && at >= 0 && Number.isFinite(new Date(at).getTime()) ? new Date(at).toISOString() : undefined;
  return { id: expectedId, threadId: providerId(data.threadId) ? data.threadId : "", from: header("from", 1000), to: header("to", 2000), subject: header("subject", 500), snippet: decodeMailEntities(mailText(data.snippet, 800)), ...(date ? { date } : {}), unread: labels.includes("UNREAD"), labels };
}
function gmailBody(payload: unknown): Pick<GmailMessage, "text" | "htmlOmitted" | "attachmentsOmitted" | "contentTruncated"> {
  const plain: string[] = [], html: string[] = []; let attachmentsOmitted = 0, walked = 0, contentTruncated = false, htmlOmitted = false;
  const walk = (value: unknown, depth: number) => {
    if (++walked > 100 || depth > 10) { contentTruncated = true; return; }
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const part = value as Record<string, unknown>, body = part.body && typeof part.body === "object" && !Array.isArray(part.body) ? part.body as Record<string, unknown> : {};
    if (typeof part.filename === "string" && part.filename) { attachmentsOmitted++; return; }
    const mime = typeof part.mimeType === "string" ? part.mimeType.toLowerCase() : "";
    if (typeof body.attachmentId === "string" && mime !== "text/plain" && mime !== "text/html") attachmentsOmitted++;
    if ((mime === "text/plain" || mime === "text/html") && typeof body.data === "string") {
      if (body.data.length > 200_000 || !/^[A-Za-z0-9_-]*={0,2}$/.test(body.data)) { contentTruncated = true; return; }
      const decoded = Buffer.from(body.data, "base64url").toString("utf8");
      if (mime === "text/plain") plain.push(mailText(decoded, 50_000)); else { html.push(decoded.slice(0, 120_000)); htmlOmitted = true; }
      if (decoded.length > (mime === "text/plain" ? 50_000 : 120_000)) contentTruncated = true;
    } else if ((mime === "text/plain" || mime === "text/html") && typeof body.attachmentId === "string") { contentTruncated = true; attachmentsOmitted++; }
    if (Array.isArray(part.parts)) { for (const child of part.parts.slice(0, 100)) walk(child, depth + 1); if (part.parts.length > 100) contentTruncated = true; }
  };
  walk(payload, 0);
  const all = plain.length ? plain.join("\n\n") : html.map(htmlMailToText).join("\n\n");
  if (all.length > 50_000) contentTruncated = true;
  return { text: all.slice(0, 50_000), htmlOmitted, attachmentsOmitted, contentTruncated };
}
function decodeMailEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d{1,7}|#x[0-9a-f]{1,6});/gi, entity => {
    const named: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()]!;
    const n = entity[2]?.toLowerCase() === "x" ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
  });
}
/** Linear, bounded HTML-to-text fallback. No HTML, image URLs or active content reaches the browser as markup. */
function htmlMailToText(value: string): string {
  const source = value.slice(0, 120_000), lower = source.toLowerCase(); let result = "", i = 0;
  while (i < source.length) {
    if (source[i] !== "<") { result += source[i]; i++; continue; }
    const end = source.indexOf(">", i + 1); if (end < 0) break;
    const tag = lower.slice(i + 1, end).trim(), type = tag.split(/[\s/]/, 1)[0];
    if (type && ["script", "style", "template", "noscript"].includes(type)) { const close = lower.indexOf(`</${type}`, end + 1); i = close < 0 ? source.length : (source.indexOf(">", close) + 1 || source.length); continue; }
    if (/^(?:br\b|\/?(?:p|div|li|tr|h[1-6])\b)/.test(tag)) result += "\n";
    i = end + 1;
  }
  return mailText(decodeMailEntities(result), 50_000).replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function encodedSubject(subject: string): string {
  const words: string[] = []; let part = "";
  for (const character of subject) {
    if (part && Buffer.byteLength(part + character, "utf8") > 42) { words.push(`=?UTF-8?B?${Buffer.from(part).toString("base64")}?=`); part = ""; }
    part += character;
  }
  if (part) words.push(`=?UTF-8?B?${Buffer.from(part).toString("base64")}?=`);
  return words.join("\r\n ");
}
function mimeMessage(input: AcquisitionMailInput): Buffer {
  const domain = input.from.split("@")[1]!;
  const body = Buffer.from(input.text.replace(/\r\n|\r|\n/g, "\r\n"), "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
  return Buffer.from([`From: ${input.from}`, `To: ${input.to}`, `Subject: ${encodedSubject(input.subject)}`, `Message-ID: <${hash(input.idempotencyKey)}@${domain}>`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", ...(input.purpose === "owner_update" ? [] : [`List-Unsubscribe: <${input.unsubscribeUrl}>`, "List-Unsubscribe-Post: List-Unsubscribe=One-Click"]), "", body, ""].join("\r\n"), "utf8");
}

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Store, StoredJob } from "@atlas/core";

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
/** Public setup guidance only. Credentials are configured privately in Railway, never in a browser payload. */
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
    description: "Send from the exact Gmail or Google Workspace address you link through Google sign-in.",
    requiredSettings: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    setupSteps: [
      "Create the Google web OAuth client using the Google connection setup guide in Jarvis and save its client settings privately in Railway.",
      "Choose Connect Gmail and sign in to the intended sender account. Linking does not send any email.",
      "Use the verified address in the sender profile. Recipients may use Gmail, Outlook, business email or any other provider.",
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
interface NetworkConfig { request?: typeof fetch; timeoutMs?: number; clock?: () => Date }
export interface ResendAcquisitionMailConfig extends NetworkConfig {
  apiKey?: string; fromAddress?: string; store?: Store;
}
export interface GmailAcquisitionMailConfig extends NetworkConfig {
  clientId?: string; clientSecret?: string; publicOrigin?: string; ownerAccessKey?: string; store: Store;
}
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const CALLBACK_PATH = "/integrations/google/callback";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/gmail.send";
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    const response = await request(url, { ...init, redirect: "error", signal: controller.signal });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new AcquisitionMailError("unavailable", `Provider request returned HTTP ${response.status}; details withheld.`); }
    const size = response.headers.get("content-length");
    if (size && (!/^\d+$/.test(size) || Number(size) > MAX_RESPONSE)) { await response.body?.cancel().catch(() => {}); throw new AcquisitionMailError("unavailable", "Provider response exceeded the allowed size."); }
    if (!response.body) throw new AcquisitionMailError("unavailable", "Provider returned an empty response.");
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_RESPONSE) { await reader.cancel(); throw new AcquisitionMailError("unavailable", "Provider response exceeded the allowed size."); }
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
interface GoogleLink { email: string; refresh: EncryptedValue; linkedAt: string }
interface OAuthState { expiresAt: number; verifier: EncryptedValue }

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
  private configured(): boolean { return Boolean(safeSecret(this.config.clientId) && safeSecret(this.config.clientSecret) && this.origin && this.config.ownerAccessKey && this.config.ownerAccessKey.length >= 32 && this.config.ownerAccessKey.length <= 1024); }
  private key(): Buffer {
    if (!this.configured()) throw new AcquisitionMailError("not_configured", "Gmail connection is not configured.");
    return createHash("sha256").update("atlas-acquisition-google-token-key-v1\0").update(this.config.ownerAccessKey!).digest();
  }
  private seal(text: string): EncryptedValue {
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(Buffer.from(`atlas-google-link-v1:${this.config.clientId}:${this.origin}`));
    const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]).toString("base64url");
    return { v: 1, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext };
  }
  private unseal(value: EncryptedValue): string {
    try {
      if (value.v !== 1 || typeof value.iv !== "string" || typeof value.tag !== "string" || typeof value.ciphertext !== "string" || value.ciphertext.length > 20_000) throw new Error();
      const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(value.iv, "base64url"));
      decipher.setAAD(Buffer.from(`atlas-google-link-v1:${this.config.clientId}:${this.origin}`)); decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64url")), decipher.final()]).toString("utf8");
    } catch { throw new AcquisitionMailError("unavailable", "The saved Gmail connection cannot be read. Relink the account."); }
  }
  /** Must only be exposed through an authenticated owner mutation route. */
  startLink(): { url: string } {
    if (!this.configured()) throw new AcquisitionMailError("not_configured", "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, and configure the private HTTPS Jarvis origin before linking Gmail.");
    this.epoch++;
    for (const row of this.config.store.listDocs<OAuthState>(STATE_COLLECTION, 100)) this.config.store.deleteDoc(STATE_COLLECTION, row.id);
    const state = randomBytes(32).toString("base64url"); const verifier = randomBytes(32).toString("base64url");
    this.config.store.upsertDoc<OAuthState>(STATE_COLLECTION, hash(state), { expiresAt: this.now().getTime() + 10 * 60_000, verifier: this.seal(verifier) });
    const url = new URL(AUTH_URL); url.search = new URLSearchParams({ client_id: this.config.clientId!, redirect_uri: this.origin + CALLBACK_PATH, response_type: "code", scope: `openid email ${GOOGLE_SCOPE}`, access_type: "offline", prompt: "consent", state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", include_granted_scopes: "false" }).toString();
    return { url: url.toString() };
  }
  async completeLink(code: string, state: string): Promise<void> {
    if (!this.configured()) throw new AcquisitionMailError("not_configured", "Gmail connection is not configured.");
    if (typeof state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new AcquisitionMailError("oauth_state", "Gmail link request is invalid or expired. Start again from Jarvis.");
    const saved = this.config.store.getDoc<OAuthState>(STATE_COLLECTION, hash(state));
    if (!saved) throw new AcquisitionMailError("oauth_state", "Gmail link request is invalid, already used or expired. Start again from Jarvis.");
    this.config.store.deleteDoc(STATE_COLLECTION, hash(state)); // consume before any await, including failed exchanges
    if (saved.doc.expiresAt <= this.now().getTime() || !safeSecret(code, 4096)) throw new AcquisitionMailError("oauth_state", "Gmail link request is invalid or expired. Start again from Jarvis.");
    const epoch = this.epoch;
    try {
      const token = await boundedJson(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: this.config.clientId!, client_secret: this.config.clientSecret!, code, grant_type: "authorization_code", redirect_uri: this.origin + CALLBACK_PATH, code_verifier: this.unseal(saved.doc.verifier) }) }, this.config);
      this.validateToken(token, true);
      if (!safeSecret(token.refresh_token)) throw new AcquisitionMailError("unavailable", "Google did not provide an offline connection. Start linking again and grant consent.");
      const user = await boundedJson(USERINFO_URL, { method: "GET", headers: { Authorization: `Bearer ${token.access_token}` } }, this.config);
      if (!emailAddress(user.email) || user.email_verified !== true) throw new AcquisitionMailError("unavailable", "Google did not verify an email identity for this account.");
      if (this.epoch !== epoch) throw new AcquisitionMailError("oauth_state", "This Gmail link was cancelled. Start again from Jarvis.");
      const email = user.email.toLowerCase();
      this.config.store.upsertDoc<GoogleLink>(LINK_COLLECTION, LINK_ID, { email, refresh: this.seal(token.refresh_token), linkedAt: this.now().toISOString() });
      this.access = { token: token.access_token as string, expiresAt: this.now().getTime() + (token.expires_in as number) * 1000, email };
      this.cachedStatus = { at: this.now().getTime(), value: { state: "connected", provider: "Gmail API", sender: email, detail: "Google verified this sender and granted an offline send connection. No email was sent by linking." } };
    } catch (error) { if (error instanceof AcquisitionMailError) throw error; throw new AcquisitionMailError("unavailable", "Gmail linking failed; sensitive provider details were withheld."); }
  }
  private validateToken(token: Record<string, unknown>, requireScope = false): void {
    if (!safeSecret(token.access_token) || typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in <= 0 || token.expires_in > 86_400 || (typeof token.token_type === "string" && token.token_type.toLowerCase() !== "bearer")) throw new AcquisitionMailError("unavailable", "Google returned an invalid access token response.");
    if ((requireScope && typeof token.scope !== "string") || (typeof token.scope === "string" && !token.scope.split(/\s+/).includes(GOOGLE_SCOPE))) throw new AcquisitionMailError("unavailable", "Google did not grant the Gmail send permission. Relink the account.");
  }
  private link(): GoogleLink | null { return this.config.store.getDoc<GoogleLink>(LINK_COLLECTION, LINK_ID)?.doc ?? null; }
  private async accessToken(link: GoogleLink): Promise<string> {
    const currentLink = this.link();
    if (!currentLink || currentLink.email !== link.email || currentLink.linkedAt !== link.linkedAt) throw new AcquisitionMailError("unavailable", "Gmail was disconnected or relinked before verification.");
    if (this.access?.email === link.email && this.access.expiresAt > this.now().getTime() + 30_000) return this.access.token;
    if (this.refreshInFlight) return this.refreshInFlight;
    const epoch = this.epoch;
    this.refreshInFlight = (async () => {
      const refresh = this.unseal(link.refresh);
      const token = await boundedJson(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: this.config.clientId!, client_secret: this.config.clientSecret!, refresh_token: refresh, grant_type: "refresh_token" }) }, this.config);
      this.validateToken(token);
      const current = this.link();
      if (this.epoch !== epoch || !current || current.email !== link.email || current.linkedAt !== link.linkedAt) throw new AcquisitionMailError("unavailable", "Gmail was disconnected or relinked during verification.");
      this.access = { token: token.access_token as string, expiresAt: this.now().getTime() + (token.expires_in as number) * 1000, email: link.email };
      return this.access.token;
    })();
    try { return await this.refreshInFlight; } finally { this.refreshInFlight = null; }
  }
  async status(): Promise<AcquisitionMailStatus> {
    if (!this.configured()) return { state: "not_connected", provider: "Gmail API", detail: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for hosted Google sign-in. ChatGPT's Gmail connection is separate." };
    const link = this.link();
    if (!link) return { state: "not_connected", provider: "Gmail API", detail: "Link the owner's Gmail account from Jarvis. No email has been sent." };
    if (this.cachedStatus && this.now().getTime() - this.cachedStatus.at < 30_000) return this.cachedStatus.value;
    let value: AcquisitionMailStatus;
    const epoch = this.epoch;
    try {
      if (!emailAddress(link.email)) throw new Error();
      const token = await this.accessToken(link);
      const user = await boundedJson(USERINFO_URL, { method: "GET", headers: { Authorization: `Bearer ${token}` } }, this.config);
      if (this.epoch !== epoch || !this.link() || user.email_verified !== true || typeof user.email !== "string" || user.email.toLowerCase() !== link.email) throw new Error();
      value = { state: "connected", provider: "Gmail API", sender: link.email, detail: "The linked sender is verified with Google. Sending still requires the exact owner-approved email." };
    } catch { value = { state: "error", provider: "Gmail API", detail: "Gmail read verification failed. Relink the account if access was revoked; no email was sent by this check." }; }
    const current = this.link();
    if (this.epoch === epoch && current?.email === link.email && current.linkedAt === link.linkedAt) this.cachedStatus = { at: this.now().getTime(), value };
    return value;
  }
  async send(input: AcquisitionMailInput): Promise<AcquisitionMailResult> {
    validateMail(input);
    if (!this.configured()) throw new AcquisitionMailError("not_configured", "Gmail connection is not configured.");
    const epoch = this.epoch;
    const link = this.link();
    if (!link) throw new AcquisitionMailError("not_configured", "Link Gmail before sending.");
    if (input.from !== link.email) throw new AcquisitionMailError("sender_mismatch", "The sender must exactly match the verified Gmail address.");
    const status = await this.status();
    if (status.state !== "connected") throw new AcquisitionMailError("unavailable", "The linked Gmail sender could not be verified.");
    if (status.sender !== input.from) throw new AcquisitionMailError("sender_mismatch", "The sender must match the currently verified Gmail identity.");
    if (this.epoch !== epoch || !this.link()) throw new AcquisitionMailError("unavailable", "Gmail was disconnected or relinked before submission.");
    const reservation = this.journal.reserve(input); if (reservation.previous) return reservation.previous;
    try {
      const token = await this.accessToken(link);
      const current = this.link();
      if (this.epoch !== epoch || !current || current.email !== link.email || current.linkedAt !== link.linkedAt) throw new AcquisitionMailError("unavailable", "Gmail was disconnected or relinked before submission.");
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
    this.access = null; this.cachedStatus = null;
    // Local disconnection deletes credentials. Google account access can also be revoked in its security settings.
  }
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

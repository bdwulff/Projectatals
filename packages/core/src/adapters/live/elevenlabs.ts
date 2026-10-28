import { createHash } from "node:crypto";
import type { Store } from "../../store.js";
import type { JobQueue } from "../../jobs.js";
import type { ConnectionStatus } from "../types.js";
import { requiredLevel, PermissionLevel } from "../../permissions.js";

const ORIGIN = "https://api.elevenlabs.io";
const JOB = "owner_speech_preview";
const MODELS = new Set(["eleven_multilingual_v2", "eleven_flash_v2_5"]);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const day = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

export class VoicePreviewError extends Error {
  constructor(public readonly code: "unavailable" | "invalid_request" | "quota" | "duplicate" | "busy" | "provider_error", message: string) {
    super(message); this.name = "VoicePreviewError";
  }
}

export interface ElevenLabsVoiceOptions {
  apiKey?: string;
  voiceId?: string;
  modelId?: string;
  /** Owner-approved use of existing provider credits. Off until explicitly configured. */
  enabled?: boolean;
  maxCharactersPerRequest?: number;
  maxCharactersPerDay?: number;
  store: Store;
  jobs: JobQueue;
  clock?: () => Date;
  request?: typeof fetch;
}

interface VoiceJob {
  requestId: string;
  textHash: string;
  characters: number;
  day: string;
  voiceId: string;
  modelId: string;
}
export interface VoicePreview { audio: Uint8Array; contentType: "audio/mpeg"; requestId: string; characters: number; provider: "ElevenLabs"; cached: boolean }

/** Explicit owner previews only. This is deliberately not wired to command/polling speech. */
export class ElevenLabsVoice {
  private readonly modelId: string;
  private readonly requestLimit: number;
  private readonly dayLimit: number;
  private readonly clock: () => Date;
  private readonly request: typeof fetch;
  private readonly pending = new Map<string, { text: string; textHash: string }>();
  private readonly audio = new Map<string, { result: VoicePreview; at: number; textHash: string }>();
  private statusCache: { at: number; value: ConnectionStatus & { enabled: boolean; voiceName?: string } } | null = null;

  constructor(private readonly options: ElevenLabsVoiceOptions) {
    this.modelId = options.modelId ?? "eleven_multilingual_v2";
    if (!MODELS.has(this.modelId)) throw new Error("Choose a supported configured speech model.");
    this.requestLimit = bounded(options.maxCharactersPerRequest ?? 1200, 1, 2000);
    this.dayLimit = bounded(options.maxCharactersPerDay ?? 4000, this.requestLimit, 10_000);
    this.clock = options.clock ?? (() => new Date());
    this.request = options.request ?? fetch;
    options.jobs.register<VoiceJob, { provider: string; characters: number; audioAvailableOnlyInCurrentProcess: true }>(JOB, async (payload) => {
      const source = this.pending.get(payload.requestId);
      if (!source || source.textHash !== payload.textHash || payload.day !== day(this.clock()) || payload.voiceId !== this.options.voiceId || payload.modelId !== this.modelId) {
        throw new VoicePreviewError("unavailable", "Speech request expired or changed. No provider request was made.");
      }
      if (!this.configured() || !this.options.enabled) throw new VoicePreviewError("unavailable", "ElevenLabs previews are not enabled.");
      const connection = await this.status();
      if (connection.state !== "connected") throw new VoicePreviewError("unavailable", "The configured ElevenLabs voice could not be verified.");
      const quotaKey = `voice.elevenlabs.characters:${payload.day}`;
      const used = this.options.store.getMemory<number>(quotaKey) ?? 0;
      if (!Number.isSafeInteger(used) || used < 0 || used + payload.characters > this.dayLimit) {
        throw new VoicePreviewError("quota", "The local daily speech character limit has been reached.");
      }
      // Reserve before billing can occur. Failures/unknown outcomes keep this reservation.
      this.options.store.setMemory(quotaKey, used + payload.characters);
      let response: Response;
      try {
        response = await this.request(`${ORIGIN}/v1/text-to-speech/${this.options.voiceId}?output_format=mp3_44100_128`, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
          headers: { "xi-api-key": this.options.apiKey!, "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify({ text: source.text, model_id: this.modelId }),
        });
      } catch {
        throw new VoicePreviewError("provider_error", "Speech submission failed or its outcome is unknown. It will not retry automatically.");
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new VoicePreviewError("provider_error", `ElevenLabs returned HTTP ${response.status}. No automatic retry was made.`);
      }
      if (!/^audio\/(mpeg|mp3)(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
        await response.body?.cancel().catch(() => {});
        throw new VoicePreviewError("provider_error", "ElevenLabs did not return the expected audio format.");
      }
      let audio: Uint8Array;
      try { audio = await readAudio(response); }
      catch (error) { throw error instanceof VoicePreviewError ? error : new VoicePreviewError("provider_error", "Speech response could not be read. No automatic retry was made."); }
      const result: VoicePreview = { audio, contentType: "audio/mpeg", requestId: payload.requestId, characters: payload.characters, provider: "ElevenLabs", cached: false };
      this.pruneAudio();
      if (this.audio.size >= 8) this.audio.delete(this.audio.keys().next().value!);
      this.audio.set(payload.requestId, { result, at: this.clock().getTime(), textHash: payload.textHash });
      // Persist metadata, never an API key, full speech text or audio in the job database.
      return { provider: "ElevenLabs", characters: payload.characters, audioAvailableOnlyInCurrentProcess: true };
    });
  }

  private configured() { return Boolean(this.options.apiKey?.trim() && /^[a-zA-Z0-9_-]{1,64}$/.test(this.options.voiceId ?? "")); }
  private pruneAudio() { const cutoff = this.clock().getTime() - 15 * 60_000; for (const [key, item] of this.audio) if (item.at < cutoff) this.audio.delete(key); }

  /** Read-only voice verification. Presence of a key is never reported as connected. */
  async status(): Promise<ConnectionStatus & { enabled: boolean; voiceName?: string }> {
    const checkedAt = this.clock().toISOString();
    if (!this.configured()) return { name: "Voice (ElevenLabs)", state: "not_connected", mode: "live", checkedAt, enabled: false, detail: "Set a server-side ElevenLabs key and an existing voice ID. No cloud voice is connected." };
    if (this.statusCache && this.clock().getTime() - this.statusCache.at < 30_000) return this.statusCache.value;
    let value: ConnectionStatus & { enabled: boolean; voiceName?: string };
    try {
      const response = await this.request(`${ORIGIN}/v1/voices/${this.options.voiceId}`, {
        method: "GET", headers: { "xi-api-key": this.options.apiKey!, Accept: "application/json" },
        redirect: "error", signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("Voice verification refused");
      const text = await boundedText(response, 128_000);
      const voice = JSON.parse(text) as { voice_id?: string; name?: string };
      if (voice.voice_id !== this.options.voiceId || typeof voice.name !== "string") throw new Error("Voice verification invalid");
      value = { name: "Voice (ElevenLabs)", state: "connected", mode: "live", checkedAt, enabled: this.options.enabled === true, voiceName: voice.name.slice(0, 120), detail: this.options.enabled ? "Configured voice verified by a read. Audio is generated only by an explicit owner request and may use provider credits." : "Configured voice verified. Cloud speech remains disabled until the owner enables provider-credit use." };
    } catch {
      value = { name: "Voice (ElevenLabs)", state: "error", mode: "live", checkedAt, enabled: false, detail: "The configured voice could not be verified. Provider details were withheld; no speech was generated." };
    }
    this.statusCache = { at: this.clock().getTime(), value };
    return value;
  }

  async synthesise(input: { text: string; requestId: string; confirmProviderUse: boolean }): Promise<VoicePreview> {
    if (requiredLevel("execute.owner_speech") !== PermissionLevel.ExecuteRoutine) throw new VoicePreviewError("unavailable", "Owner speech is not permitted by the current action policy.");
    if (!this.configured() || !this.options.enabled) throw new VoicePreviewError("unavailable", "ElevenLabs voice is not connected and enabled. Device speech remains available in supported browsers.");
    if (input.confirmProviderUse !== true || typeof input.text !== "string" || !input.text.trim() || input.text.length > this.requestLimit || !/^[a-zA-Z0-9_-]{16,80}$/.test(input.requestId ?? "")) {
      throw new VoicePreviewError("invalid_request", `Explicit owner confirmation, a request ID and 1–${this.requestLimit} characters are required.`);
    }
    const text = input.text.trim();
    const textHash = hash(text);
    this.pruneAudio();
    const previous = this.audio.get(input.requestId);
    if (previous) {
      if (previous.textHash !== textHash) throw new VoicePreviewError("duplicate", "This speech request ID belongs to different text.");
      return { ...previous.result, cached: true };
    }
    const key = `owner-speech:${hash(input.requestId)}`;
    if (this.options.store.getJobByKey(key)) throw new VoicePreviewError("duplicate", "This speech request was already attempted. Audio is unavailable or expired; no automatic regeneration was made.");
    const payload: VoiceJob = { requestId: input.requestId, textHash, characters: text.length, day: day(this.clock()), voiceId: this.options.voiceId!, modelId: this.modelId };
    this.pending.set(input.requestId, { text, textHash });
    try {
      this.options.jobs.enqueue(JOB, payload, { idempotencyKey: key, maxAttempts: 1 });
      await this.options.jobs.runOnce();
      const result = this.audio.get(input.requestId);
      if (result) return result.result;
      const job = this.options.store.getJobByKey(key);
      if (job?.status === "queued") {
        job.status = "dead";
        job.lastError = "Speech was refused while the job runner was busy. No provider request was made.";
        this.options.store.updateJob(job);
        throw new VoicePreviewError("busy", "Speech was refused while the job runner was busy. No provider request was made. Generate a new explicit preview when it is idle.");
      }
      if (job?.status === "running") throw new VoicePreviewError("busy", "Speech generation has started. Recover the existing preview later; do not automatically generate another request.");
      const safe = job?.lastError;
      if (safe?.includes("daily speech character limit")) throw new VoicePreviewError("quota", safe);
      throw new VoicePreviewError("provider_error", safe ?? "Speech generation was not confirmed. No automatic retry was made.");
    } finally { this.pending.delete(input.requestId); }
  }

  limits() { return { maxCharactersPerRequest: this.requestLimit, maxCharactersPerDay: this.dayLimit, usedCharactersToday: this.options.store.getMemory<number>(`voice.elevenlabs.characters:${day(this.clock())}`) ?? 0 }; }
}

function bounded(value: number, low: number, high: number) {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw new Error(`Speech character limits must be integers between ${low} and ${high}.`);
  return value;
}
async function bytes(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new VoicePreviewError("provider_error", "The speech provider returned an empty response.");
  const parts: Uint8Array[] = []; let size = 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new VoicePreviewError("provider_error", "Speech response timed out. No automatic retry was made.")), { once: true }));
  void aborted.catch(() => {});
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), aborted]);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new VoicePreviewError("provider_error", "Speech provider response exceeded the local size limit.");
      parts.push(part.value);
    }
    if (!size) throw new VoicePreviewError("provider_error", "The speech provider returned an empty response.");
    const result = new Uint8Array(size); let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
  } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); }
}
async function boundedText(response: Response, limit: number) { return new TextDecoder().decode(await bytes(response, limit)); }
async function readAudio(response: Response) { return bytes(response, 2 * 1024 * 1024); }

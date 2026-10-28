import { createHash } from "node:crypto";
import type { Hono } from "hono";
import { PermissionLevel, requiredLevel, type JobQueue, type Store } from "@atlas/core";
import type { Runtime } from "./runtime.js";

const JOB = "owner_recorded_transcription", ORIGIN = "https://api.elevenlabs.io";
const MODEL = "scribe_v2";
export const MAX_TRANSCRIPTION_BYTES = 1_048_576;
export const MAX_TRANSCRIPTION_DURATION_MS = 30_000;
const RESULT_TTL = 15 * 60_000;
const TYPES = new Map([["audio/webm", "webm"], ["audio/mp4", "m4a"], ["audio/ogg", "ogg"], ["audio/wav", "wav"]]);
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function day(now: Date): string { const p = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now); return ["year", "month", "day"].map(t => p.find(p => p.type === t)!.value).join("-"); }
export class TranscriptionError extends Error {
  constructor(readonly code: "invalid_request" | "unavailable" | "quota" | "duplicate" | "busy" | "provider_error", message: string) { super(message); }
}
export interface TranscriptionInput { audioBase64: string; mimeType: string; durationMs: number; requestId: string; confirmProviderUse: boolean }
export interface TranscriptionResult { text: string; provider: "ElevenLabs"; modelId: "scribe_v2"; cached: boolean; audioStored: false }
export interface TranscriptionOptions {
  mode: "live" | "fake"; apiKey?: string; enabled?: boolean; store: Store; jobs: JobQueue; clock?: () => Date; request?: typeof fetch;
  maxRequestsPerDay?: number; maxReservedSecondsPerDay?: number; maxAudioBytesPerDay?: number;
}
interface TranscriptionJob { requestId: string; audioHash: string; requestHash: string; mimeType: string; reservedSeconds: number; audioBytes: number; day: string; modelId: "scribe_v2" }
interface PendingAudio { bytes: Uint8Array; requestHash: string }

/** Owner-initiated recording uploads only. Readiness checks never make a paid request. */
export class OwnerTranscription {
  private readonly clock: () => Date;
  private readonly request: typeof fetch;
  private readonly requestLimit: number;
  private readonly secondsLimit: number;
  private readonly bytesLimit: number;
  private readonly pending = new Map<string, PendingAudio>();
  private readonly results = new Map<string, { result: TranscriptionResult; requestHash: string; at: number }>();
  private lastSuccessAt: string | null = null;
  constructor(private readonly options: TranscriptionOptions) {
    this.clock = options.clock ?? (() => new Date()); this.request = options.request ?? fetch;
    this.requestLimit = bounded(options.maxRequestsPerDay ?? 10, 1, 20);
    this.secondsLimit = bounded(options.maxReservedSecondsPerDay ?? 300, 30, 600);
    this.bytesLimit = bounded(options.maxAudioBytesPerDay ?? 5 * MAX_TRANSCRIPTION_BYTES, MAX_TRANSCRIPTION_BYTES, 20 * MAX_TRANSCRIPTION_BYTES);
    options.jobs.register<TranscriptionJob, { provider: string; modelId: string; transcriptionAvailableOnlyInCurrentProcess: true }>(JOB, async payload => {
      const recording = this.pending.get(payload.requestId);
      if (!recording || recording.requestHash !== payload.requestHash || sha(recording.bytes) !== payload.audioHash || payload.modelId !== MODEL || payload.reservedSeconds !== 30 || payload.audioBytes !== recording.bytes.length || payload.day !== day(this.clock())) throw new TranscriptionError("unavailable", "The recording request expired or changed. No provider request was made.");
      if (!this.configured() || !this.options.enabled) throw new TranscriptionError("unavailable", "Recorded transcription is not enabled. Browser dictation remains available where supported.");
      const quota = this.quota();
      if (quota.requests + 1 > this.requestLimit || quota.seconds + payload.reservedSeconds > this.secondsLimit || quota.bytes + payload.audioBytes > this.bytesLimit) throw new TranscriptionError("quota", "The local daily recording-transcription limit has been reached. Use browser dictation or type instead.");
      // Durable reservation precedes any billable network request; failures keep the allowance consumed.
      this.options.store.setMemory(`transcription.elevenlabs.quota:${payload.day}`, { requests: quota.requests + 1, seconds: quota.seconds + payload.reservedSeconds, bytes: quota.bytes + payload.audioBytes });
      const form = new FormData();
      form.set("model_id", MODEL); form.set("language_code", "en"); form.set("timestamps_granularity", "none"); form.set("diarize", "false"); form.set("tag_audio_events", "false"); form.set("webhook", "false");
      form.set("file", new Blob([new Uint8Array(recording.bytes).buffer], { type: payload.mimeType }), `owner-recording.${TYPES.get(payload.mimeType)}`);
      let response: Response;
      try { response = await this.request(`${ORIGIN}/v1/speech-to-text`, { method: "POST", headers: { "xi-api-key": this.options.apiKey!, Accept: "application/json" }, body: form, redirect: "error", signal: AbortSignal.timeout(35_000) }); }
      catch { throw new TranscriptionError("provider_error", "The recording submission failed or its outcome is unknown. It will not retry automatically; recover this request before recording another."); }
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new TranscriptionError("provider_error", `ElevenLabs transcription returned HTTP ${response.status}. Check speech-to-text permission and credits; no automatic retry was made.`); }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) { await response.body?.cancel().catch(() => {}); throw new TranscriptionError("provider_error", "The transcription provider returned an unexpected response. No automatic retry was made."); }
      const data = await boundedJson(response);
      if (typeof data.text !== "string" || data.text.length > 8000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(data.text)) throw new TranscriptionError("provider_error", "The provider did not return a valid bounded transcript. No command was executed.");
      const text = data.text.trim(); if (!text) throw new TranscriptionError("provider_error", "No speech was found in that recording. No command was executed.");
      const result: TranscriptionResult = { text, provider: "ElevenLabs", modelId: MODEL, cached: false, audioStored: false };
      this.prune(); if (this.results.size >= 8) this.results.delete(this.results.keys().next().value!);
      this.results.set(payload.requestId, { result, requestHash: payload.requestHash, at: this.clock().getTime() }); this.lastSuccessAt = this.clock().toISOString();
      // Persist only hashes/quota and provider metadata: never the recording, secret or transcript.
      return { provider: "ElevenLabs", modelId: MODEL, transcriptionAvailableOnlyInCurrentProcess: true };
    });
  }
  private configured(): boolean { return this.options.mode === "live" && typeof this.options.apiKey === "string" && this.options.apiKey.trim().length > 0 && this.options.apiKey.length <= 1024; }
  private quota(): { requests: number; seconds: number; bytes: number } {
    const value = this.options.store.getMemory<{ requests: number; seconds: number; bytes: number }>(`transcription.elevenlabs.quota:${day(this.clock())}`) ?? { requests: 0, seconds: 0, bytes: 0 };
    if (!Number.isSafeInteger(value.requests) || value.requests < 0 || !Number.isSafeInteger(value.seconds) || value.seconds < 0 || !Number.isSafeInteger(value.bytes) || value.bytes < 0) return { requests: this.requestLimit, seconds: this.secondsLimit, bytes: this.bytesLimit };
    return value;
  }
  private prune(): void { const cutoff = this.clock().getTime() - RESULT_TTL; for (const [id, item] of this.results) if (item.at < cutoff) this.results.delete(id); }
  status() {
    const configured = this.configured(), enabled = configured && this.options.enabled === true, quota = this.quota();
    return { provider: "ElevenLabs" as const, configured, enabled, state: !configured ? "not_connected" as const : this.lastSuccessAt ? "connected" as const : "unverified" as const,
      detail: this.options.mode === "fake" ? "Fictional mode never uploads recordings to a provider. Use browser dictation or type." : !configured ? "No server-side transcription key is configured. Browser dictation can still work." : !enabled ? "Recorded transcription is disabled. Browser dictation does not use ElevenLabs." : this.lastSuccessAt ? "A recording was transcribed in this server session. Each new clip requires your explicit request and uses ElevenLabs credits." : "Ready for an explicit recording request. Speech-to-text permission and credits are not proven by the text-to-speech connection; the first transcription may be refused by the provider.",
      lastSuccessfulTranscriptionAt: this.lastSuccessAt, audioUploadedByStatusCheck: false,
      limits: { maxAudioBytes: MAX_TRANSCRIPTION_BYTES, maxDurationMs: MAX_TRANSCRIPTION_DURATION_MS, maxRequestsPerDay: this.requestLimit, usedRequestsToday: quota.requests, maxReservedSecondsPerDay: this.secondsLimit, usedReservedSecondsToday: quota.seconds, maxAudioBytesPerDay: this.bytesLimit, usedAudioBytesToday: quota.bytes, durationLimitVerifiedByServer: false } };
  }
  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    if (requiredLevel("prepare.owner_transcription") !== PermissionLevel.Prepare) throw new TranscriptionError("unavailable", "Owner transcription is not permitted by the current action policy.");
    if (!this.configured() || !this.options.enabled) throw new TranscriptionError("unavailable", "Recorded transcription is not enabled. Browser dictation or keyboard dictation remains available.");
    const bytes = validateRecording(input);
    const requestHash = sha(JSON.stringify({ audioHash: sha(bytes), mimeType: input.mimeType, durationMs: input.durationMs, modelId: MODEL }));
    this.prune();
    const previous = this.results.get(input.requestId);
    if (previous) { if (previous.requestHash !== requestHash) throw new TranscriptionError("duplicate", "This recording request ID belongs to a different clip."); return { ...previous.result, cached: true }; }
    const key = `owner-transcription:${sha(input.requestId)}`;
    const prior = this.options.store.getJobByKey(key);
    if (prior) throw new TranscriptionError(prior.status === "running" || prior.status === "queued" ? "busy" : "duplicate", "This recording was already submitted or attempted. Its transcript is unavailable or expired. No automatic upload or retry was made.");
    if (this.pending.size > 0) throw new TranscriptionError("busy", "Another recording is being transcribed. Wait for its result before sending another.");
    const payload: TranscriptionJob = { requestId: input.requestId, audioHash: sha(bytes), requestHash, mimeType: input.mimeType, reservedSeconds: 30, audioBytes: bytes.length, day: day(this.clock()), modelId: MODEL };
    this.pending.set(input.requestId, { bytes, requestHash });
    try {
      this.options.jobs.enqueue(JOB, payload, { idempotencyKey: key, maxAttempts: 1, runAfter: this.clock() });
      await this.options.jobs.runOnce(20, this.clock());
      const result = this.results.get(input.requestId); if (result) return result.result;
      const job = this.options.store.getJobByKey(key);
      if (job?.status === "queued") { job.status = "dead"; job.lastError = "Recording upload was refused while the job runner was busy. No provider request was made."; this.options.store.updateJob(job); throw new TranscriptionError("busy", job.lastError); }
      if (job?.status === "running") throw new TranscriptionError("busy", "The recording upload is in progress. Recover the same request; do not automatically submit another recording.");
      if (job?.lastError?.includes("local daily recording-transcription limit")) throw new TranscriptionError("quota", job.lastError);
      throw new TranscriptionError("provider_error", job?.lastError ?? "Transcription was not confirmed. No automatic retry was made.");
    } finally { bytes.fill(0); this.pending.delete(input.requestId); }
  }
}

export function createOwnerTranscription(rt: Runtime, env: NodeJS.ProcessEnv = process.env) {
  return new OwnerTranscription({ mode: rt.mode, apiKey: rt.mode === "live" ? env.ELEVENLABS_API_KEY : undefined, enabled: env.ATLAS_ELEVENLABS_TRANSCRIPTION_ENABLED === "true", store: rt.atlas.deps.store, jobs: rt.atlas.jobs, clock: rt.atlas.clock, maxRequestsPerDay: Number(env.ATLAS_TRANSCRIPTION_MAX_REQUESTS_PER_DAY ?? 10), maxReservedSecondsPerDay: Number(env.ATLAS_TRANSCRIPTION_MAX_RESERVED_SECONDS_PER_DAY ?? 300), maxAudioBytesPerDay: Number(env.ATLAS_TRANSCRIPTION_MAX_AUDIO_BYTES_PER_DAY ?? 5 * MAX_TRANSCRIPTION_BYTES) });
}
/** Install only after owner auth; parent applies the exact-path body limit before this route. */
export function installTranscriptionRoutes(app: Hono, service: OwnerTranscription) {
  app.get("/api/voice/input-status", c => c.json(service.status()));
  app.post("/api/voice/transcribe", async c => {
    let value: unknown; try { value = await c.req.json(); } catch { return c.json({ error: "Provide a valid recording request." }, 400); }
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !["audioBase64", "mimeType", "durationMs", "requestId", "confirmProviderUse"].includes(k))) return c.json({ error: "Provide only the recording, type, duration, request ID and explicit credit confirmation." }, 400);
    try { const result = await service.transcribe(value as TranscriptionInput); c.header("Cache-Control", "no-store"); return c.json(result); }
    catch (error) { const safe = error instanceof TranscriptionError ? error : new TranscriptionError("provider_error", "The recording could not be transcribed. Provider details were withheld; no automatic retry was made."); const status = safe.code === "invalid_request" ? 400 : safe.code === "quota" ? 429 : safe.code === "duplicate" || safe.code === "busy" ? 409 : safe.code === "unavailable" ? 503 : 502; return c.json({ error: safe.message, code: safe.code, browserDictationAvailable: true }, status); }
  });
}
function bounded(value: number, low: number, high: number): number { if (!Number.isSafeInteger(value) || value < low || value > high) throw new Error(`Transcription limits must be integers from ${low} to ${high}.`); return value; }
export function validateRecording(input: TranscriptionInput): Uint8Array {
  if (input.confirmProviderUse !== true || typeof input.requestId !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(input.requestId) || !TYPES.has(input.mimeType) || !Number.isInteger(input.durationMs) || input.durationMs < 100 || input.durationMs > MAX_TRANSCRIPTION_DURATION_MS || typeof input.audioBase64 !== "string" || input.audioBase64.length > Math.ceil(MAX_TRANSCRIPTION_BYTES / 3) * 4 || input.audioBase64.length < 32 || (input.audioBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.audioBase64))) throw new TranscriptionError("invalid_request", "Explicit credit confirmation, a unique request ID and a recording from the 30-second browser recorder under 1 MiB are required.");
  const bytes = Buffer.from(input.audioBase64, "base64");
  if (bytes.length < 24 || bytes.length > MAX_TRANSCRIPTION_BYTES || bytes.toString("base64") !== input.audioBase64) throw new TranscriptionError("invalid_request", "The recording encoding or size is invalid.");
  const head = bytes.subarray(0, 4096), ascii = head.toString("latin1");
  const valid = input.mimeType === "audio/webm" ? bytes.subarray(0, 4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])) && ascii.includes("webm")
    : input.mimeType === "audio/mp4" ? bytes.toString("ascii", 4, 8) === "ftyp" && /(?:M4A |M4B |isom|iso[2-9]|mp4[12]|dash|qt  )/.test(bytes.toString("ascii", 8, Math.min(64, bytes.length)))
    : input.mimeType === "audio/ogg" ? bytes.toString("ascii", 0, 4) === "OggS" && bytes[4] === 0 && /OpusHead|vorbis/.test(ascii)
    : bytes.length >= 44 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE";
  if (!valid) throw new TranscriptionError("invalid_request", "The recording bytes do not match a supported audio container. Record again using Safari or Chrome.");
  return bytes;
}
async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader(); if (!reader) throw new TranscriptionError("provider_error", "The provider returned an empty transcript response.");
  const parts: Uint8Array[] = []; let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TranscriptionError("provider_error", "The transcript response timed out. No automatic retry was made.")), 20_000); });
  void expired.catch(() => {});
  try {
    for (;;) { const p = await Promise.race([reader.read(), expired]); if (p.done) break; size += p.value.length; if (size > 65_536) throw new TranscriptionError("provider_error", "The provider transcript response exceeded the local limit."); parts.push(p.value); }
    const value: unknown = JSON.parse(Buffer.concat(parts).toString("utf8")); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>;
  } catch (error) { throw error instanceof TranscriptionError ? error : new TranscriptionError("provider_error", "The provider did not return a valid transcript. No automatic retry was made."); }
  finally { if (timer) clearTimeout(timer); await reader.cancel().catch(() => {}); }
}

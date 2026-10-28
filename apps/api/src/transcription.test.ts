import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { PermissionLevel, requiredLevel } from "@atlas/core";
import { buildRuntime } from "./runtime.js";
import { installOwnerAuth } from "./auth.js";
import { MAX_TRANSCRIPTION_BYTES, OwnerTranscription, createOwnerTranscription, installTranscriptionRoutes, validateRecording, type TranscriptionInput } from "./transcription.js";

const origin = "https://jarvis.example.test", ownerKey = "fictional-owner-key-".repeat(3), readKey = "fictional-read-key-".repeat(3);
const runtimes: ReturnType<typeof buildRuntime>[] = [];
function recording(length = 128): string { const b = Buffer.alloc(length); b.write("RIFF"); b.writeUInt32LE(length - 8, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(length - 44, 40); return b.toString("base64"); }
const input = (override: Partial<TranscriptionInput> = {}): TranscriptionInput => ({ audioBase64: recording(), mimeType: "audio/wav", durationMs: 1000, requestId: "fictional-recording-0001", confirmProviderUse: true, ...override });
function setup(overrides: { mode?: "live" | "fake"; enabled?: boolean; maxRequestsPerDay?: number; maxReservedSecondsPerDay?: number; maxAudioBytesPerDay?: number; clock?: () => Date; request?: typeof fetch } = {}) {
  const rt = buildRuntime({ ATLAS_MODE: "fake" }); runtimes.push(rt);
  const request = vi.fn(async () => Response.json({ text: "Fictional owner transcript. Give me my status." }));
  const options = { mode: "live" as const, apiKey: "fictional-provider-key-never-log", enabled: true, store: rt.atlas.deps.store, jobs: rt.atlas.jobs, request: request as unknown as typeof fetch, ...overrides };
  const service = new OwnerTranscription(options);
  return { rt, options, service, request };
}
afterEach(() => { for (const rt of runtimes.splice(0)) rt.atlas.deps.store.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("explicit owner recording transcription", () => {
  it("registers preparation separately from customer communications and financial actions", () => { expect(requiredLevel("prepare.owner_transcription")).toBe(PermissionLevel.Prepare); });
  it("never uploads or checks paid capabilities while polling status", () => { const { service, request } = setup(); for (let i = 0; i < 5; i++) expect(service.status()).toMatchObject({ configured: true, enabled: true, state: "unverified", audioUploadedByStatusCheck: false }); expect(request).not.toHaveBeenCalled(); });
  it("rejects fake mode even with live keys and an enabled flag", async () => { const { service, request, rt } = setup({ mode: "fake" }); expect(service.status()).toMatchObject({ configured: false, enabled: false, state: "not_connected" }); await expect(service.transcribe(input())).rejects.toMatchObject({ code: "unavailable" }); const factory = createOwnerTranscription(rt, { ELEVENLABS_API_KEY: "fictional-real-shaped-key", ATLAS_ELEVENLABS_TRANSCRIPTION_ENABLED: "true" }); expect(factory.status().configured).toBe(false); expect(request).not.toHaveBeenCalled(); });
  it("keeps the paid fallback disabled until explicitly configured", async () => { const { service, request } = setup({ enabled: false }); await expect(service.transcribe(input())).rejects.toMatchObject({ code: "unavailable" }); expect(request).not.toHaveBeenCalled(); });
  it("requires per-clip credit confirmation and validates the request before billing", async () => {
    const { service, request } = setup();
    for (const change of [{ confirmProviderUse: false }, { requestId: "bad" }, { durationMs: 99 }, { durationMs: 30001 }, { mimeType: "image/png" }, { audioBase64: "data:audio/wav;base64," + recording() }, { audioBase64: "x".repeat(44) }, { audioBase64: recording().slice(0, -1) }]) await expect(service.transcribe(input(change))).rejects.toMatchObject({ code: "invalid_request" });
    expect(request).not.toHaveBeenCalled();
  });
  it("accepts a full-size canonical clip without a regex-stack failure and rejects oversized or forged media", () => {
    expect(validateRecording(input({ audioBase64: recording(MAX_TRANSCRIPTION_BYTES) })).length).toBe(MAX_TRANSCRIPTION_BYTES);
    expect(() => validateRecording(input({ audioBase64: recording(MAX_TRANSCRIPTION_BYTES + 1) }))).toThrow();
    expect(() => validateRecording(input({ mimeType: "audio/mp4" }))).toThrow(/bytes do not match/);
    expect(() => validateRecording(input({ audioBase64: Buffer.from("<svg>fictional malware recording</svg>".repeat(4)).toString("base64") }))).toThrow(/bytes do not match/);
  });
  it("posts one fixed multipart speech-to-text request and recovers an identical transcript without another charge", async () => {
    const { service, request, rt } = setup(); const a = await service.transcribe(input()); const b = await service.transcribe(input());
    expect(a).toMatchObject({ text: "Fictional owner transcript. Give me my status.", provider: "ElevenLabs", modelId: "scribe_v2", cached: false, audioStored: false }); expect(b.cached).toBe(true); expect(request).toHaveBeenCalledOnce();
    const [url, init] = (request.mock.calls as unknown as Array<[string, RequestInit]>)[0]!; expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text"); expect(init.redirect).toBe("error"); const body = init.body as FormData;
    expect(body.get("model_id")).toBe("scribe_v2"); expect(body.get("webhook")).toBe("false"); expect(body.get("timestamps_granularity")).toBe("none"); expect(body.get("file")).toBeInstanceOf(Blob);
    const persisted = JSON.stringify(rt.atlas.jobs.list()); expect(persisted).not.toContain(input().audioBase64); expect(persisted).not.toContain("fictional-provider-key-never-log"); expect(persisted).not.toContain(a.text); expect(persisted).toContain('"maxAttempts":1');
    expect(service.status()).toMatchObject({ state: "connected", limits: { usedRequestsToday: 1, usedReservedSecondsToday: 30, usedAudioBytesToday: 128, durationLimitVerifiedByServer: false } });
  });
  it("reserves a full recording allowance rather than trusting the declared duration", async () => { const { service } = setup({ maxReservedSecondsPerDay: 30 }); await service.transcribe(input({ durationMs: 100 })); await expect(service.transcribe(input({ requestId: "fictional-recording-0002", durationMs: 100 }))).rejects.toMatchObject({ code: "quota" }); expect(service.status().limits.usedReservedSecondsToday).toBe(30); });
  it("enforces a hard daily byte budget independently of clip duration and attempt count", async () => { const { service, request } = setup({ maxAudioBytesPerDay: MAX_TRANSCRIPTION_BYTES }); await service.transcribe(input({ audioBase64: recording(MAX_TRANSCRIPTION_BYTES), durationMs: 100 })); await expect(service.transcribe(input({ requestId: "fictional-recording-0002" }))).rejects.toMatchObject({ code: "quota" }); expect(request).toHaveBeenCalledOnce(); });
  it("prevents changed-content recovery and duplicate requests across a service restart", async () => { const { service, options, request } = setup(); await service.transcribe(input()); await expect(service.transcribe(input({ durationMs: 2000 }))).rejects.toMatchObject({ code: "duplicate" }); const restarted = new OwnerTranscription(options); await expect(restarted.transcribe(input())).rejects.toMatchObject({ code: "duplicate" }); expect(request).toHaveBeenCalledOnce(); });
  it("keeps ambiguous failures one-attempt and does not persist provider errors or keys", async () => { const request = vi.fn(async () => { throw new Error("fictional-provider-key-never-log https://internal.invalid"); }); const { service, options, rt } = setup({ request }); await expect(service.transcribe(input())).rejects.toMatchObject({ code: "provider_error" }); const restarted = new OwnerTranscription(options); await expect(restarted.transcribe(input())).rejects.toMatchObject({ code: "duplicate" }); await rt.atlas.jobs.runOnce(); expect(request).toHaveBeenCalledOnce(); expect(JSON.stringify(rt.atlas.jobs.list())).not.toContain("fictional-provider-key-never-log"); expect(service.status().limits.usedRequestsToday).toBe(1); });
  it("rejects non-JSON, excessive and empty provider responses without executing a command", async () => {
    for (const response of [new Response("fictional-secret-raw-error", { status: 401 }), new Response("not JSON", { headers: { "Content-Type": "text/html" } }), Response.json({ text: "" }), Response.json({ text: "x".repeat(9000) }), Response.json({ text: "x".repeat(70000) })]) {
      const request = vi.fn(async () => response); const { service, rt } = setup({ request }); const error = await service.transcribe(input()).catch(e => e as Error); expect(String(error)).not.toContain("fictional-secret-raw-error"); expect(error).toMatchObject({ code: "provider_error" }); expect(rt.atlas.audit.recent().some(e => e.action === "command.received")).toBe(false);
    }
  });
  it("refuses a second upload while the first provider response is in flight", async () => {
    let release!: (r: Response) => void; const request = vi.fn(() => new Promise<Response>(r => { release = r; })); const { service } = setup({ request });
    const first = service.transcribe(input()); await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    await expect(service.transcribe(input())).rejects.toMatchObject({ code: "busy" }); await expect(service.transcribe(input({ requestId: "fictional-recording-0002" }))).rejects.toMatchObject({ code: "busy" }); release(Response.json({ text: "Fictional transcript." })); await first;
  });
  it("keeps quota reservations across process replacement and resets at Melbourne day boundaries", async () => {
    let now = new Date("2026-10-26T12:59:59Z"); const { service, options, request } = setup({ maxRequestsPerDay: 1, clock: () => now }); await service.transcribe(input()); const restarted = new OwnerTranscription(options);
    await expect(restarted.transcribe(input({ requestId: "fictional-recording-0002" }))).rejects.toMatchObject({ code: "quota" }); now = new Date("2026-10-26T13:00:00Z"); await restarted.transcribe(input({ requestId: "fictional-recording-0003" })); expect(request).toHaveBeenCalledTimes(2); expect(restarted.status().limits.usedRequestsToday).toBe(1);
  });
});

describe("protected recorded voice endpoints", () => {
  async function apiSetup() { const s = setup(); const app = new Hono(); installOwnerAuth(app, s.rt, { ownerAccessKey: ownerKey, publicOrigin: origin, briefingReadToken: readKey }); installTranscriptionRoutes(app, s.service); const login = await app.request(origin + "/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ accessKey: ownerKey }) }); const cookie = /__Host-atlas_session=[a-f0-9]{64}/.exec(login.headers.get("set-cookie") ?? "")![0]; const post = (value: unknown, headers: Record<string, string> = {}) => app.request(origin + "/api/voice/transcribe", { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json", ...headers }, body: JSON.stringify(value) }); return { ...s, app, cookie, post }; }
  it("requires owner auth for status and upload and rejects the briefing token", async () => { const { app, request } = await apiSetup(); for (const p of ["/api/voice/input-status", "/api/voice/transcribe"]) { expect((await app.request(origin + p)).status).toBe(401); expect((await app.request(origin + p, { headers: { Authorization: `Bearer ${readKey}` } })).status).toBe(401); } expect(request).not.toHaveBeenCalled(); });
  it("rejects cross-origin, unconfirmed and extra-authority uploads", async () => { const { post, request } = await apiSetup(); expect((await post(input(), { Origin: "https://evil.example.test" })).status).toBe(403); expect((await post({ ...input(), confirmProviderUse: false })).status).toBe(400); expect((await post({ ...input(), modelId: "caller-choice" })).status).toBe(400); expect((await post({ ...input(), apiKey: "caller-secret" })).status).toBe(400); expect(request).not.toHaveBeenCalled(); });
  it("returns private transcript JSON only after explicit owner confirmation", async () => { const { app, cookie, post, request } = await apiSetup(); const status = await app.request(origin + "/api/voice/input-status", { headers: { Cookie: cookie } }); expect((await status.json()).state).toBe("unverified"); expect(request).not.toHaveBeenCalled(); const response = await post(input()); expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store"); expect(await response.json()).toMatchObject({ provider: "ElevenLabs", modelId: "scribe_v2", audioStored: false }); });
});

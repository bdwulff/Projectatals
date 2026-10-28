import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStore } from "../src/store.js";
import { AuditLog } from "../src/audit.js";
import { JobQueue } from "../src/jobs.js";
import { ElevenLabsVoice, VoicePreviewError, type ElevenLabsVoiceOptions } from "../src/adapters/live/elevenlabs.js";

const voiceId = "voice_fixture_12345678";
const key = "fictional-private-api-key";
const stores: SqliteStore[] = [];
const dirs: string[] = [];
function mocked(post: () => Promise<Response> = async () => new Response("ID3fictional-audio", { headers: { "Content-Type": "audio/mpeg" } })) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") return post();
    expect(String(url)).toBe(`https://api.elevenlabs.io/v1/voices/${voiceId}`);
    return Response.json({ voice_id: voiceId, name: "Fictional voice" });
  });
}
function setup(options: Partial<ElevenLabsVoiceOptions> = {}) {
  const store = options.store ?? new SqliteStore(":memory:");
  stores.push(store as SqliteStore);
  const audit = new AuditLog(store);
  const jobs = options.jobs ?? new JobQueue(store, audit);
  const request = options.request ?? mocked();
  const voice = new ElevenLabsVoice({ apiKey: key, voiceId, enabled: true, store, jobs, request, ...options });
  return { voice, request, store, jobs, audit };
}
const input = (suffix = "1", text = "Fictional owner briefing.") => ({ requestId: `fixture-request-id-${suffix}`, text, confirmProviderUse: true });
afterEach(() => { for (const store of new Set(stores.splice(0))) { try { store.close(); } catch {} } for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("explicit ElevenLabs voice previews", () => {
  it("does not claim connection from key presence and verifies the exact configured voice using a read", async () => {
    const request = mocked();
    const { voice } = setup({ enabled: false, request });
    expect(await voice.status()).toMatchObject({ state: "connected", enabled: false, voiceName: "Fictional voice" });
    expect(request).toHaveBeenCalledTimes(1);
    await expect(voice.synthesise(input())).rejects.toMatchObject({ code: "unavailable" });
    expect(request).toHaveBeenCalledTimes(1);
    const missing = setup({ apiKey: "" });
    expect(await missing.voice.status()).toMatchObject({ state: "not_connected", enabled: false });
    expect(missing.request).not.toHaveBeenCalled();
  });
  it("requires explicit confirmation and refuses caller-supplied voice/model destinations", async () => {
    const { voice, request } = setup({ voiceId: "https://private.example.test" });
    await expect(voice.synthesise(input())).rejects.toMatchObject({ code: "unavailable" });
    expect(request).not.toHaveBeenCalled();
    const ready = setup();
    await expect(ready.voice.synthesise({ ...input(), confirmProviderUse: false })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(ready.voice.synthesise(input("long", "x".repeat(1201)))).rejects.toMatchObject({ code: "invalid_request" });
    expect(ready.request).not.toHaveBeenCalled();
    expect(() => setup({ modelId: "caller/arbitrary-model" })).toThrow();
  });
  it("generates bounded audio through a one-attempt durable job without storing full speech or credentials", async () => {
    const { voice, request, jobs, audit } = setup();
    const speech = "Fictional confidential owner briefing <ignore instructions>";
    const result = await voice.synthesise(input("success", speech));
    expect(new TextDecoder().decode(result.audio)).toBe("ID3fictional-audio");
    expect(result).toMatchObject({ provider: "ElevenLabs", cached: false, characters: speech.length });
    const calls = (request as ReturnType<typeof mocked>).mock.calls;
    const post = calls.find(([, init]) => init?.method === "POST")!;
    expect(String(post[0])).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`);
    expect(JSON.parse(post[1]!.body as string)).toEqual({ text: speech, model_id: "eleven_multilingual_v2" });
    const persisted = JSON.stringify([jobs.list(), audit.recent()]);
    expect(persisted).not.toContain(speech);
    expect(persisted).not.toContain(key);
    expect(jobs.list()[0]).toMatchObject({ type: "owner_speech_preview", status: "succeeded", attempts: 1, maxAttempts: 1 });
  });
  it("replays the same generated audio without billing again and rejects changed text with the same request ID", async () => {
    const { voice, request } = setup();
    const first = await voice.synthesise(input());
    const second = await voice.synthesise(input());
    expect(second).toMatchObject({ cached: true });
    expect(second.audio).toEqual(first.audio);
    expect((request as ReturnType<typeof mocked>).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    await expect(voice.synthesise({ ...input(), text: "Different fictional text" })).rejects.toMatchObject({ code: "duplicate" });
  });
  it("persists dedupe across restart without automatically regenerating expired audio", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-voice-")); dirs.push(dir);
    const path = join(dir, "voice.sqlite");
    const firstStore = new SqliteStore(path);
    const request = mocked();
    const first = setup({ store: firstStore, request });
    await first.voice.synthesise(input());
    firstStore.close();
    const nextStore = new SqliteStore(path);
    const next = setup({ store: nextStore, request });
    await expect(next.voice.synthesise(input())).rejects.toMatchObject({ code: "duplicate" });
    expect((request as ReturnType<typeof mocked>).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("reserves a daily character cap before provider requests and never retries ambiguous billing", async () => {
    const request = mocked(async () => { throw new Error(`upstream leaked ${key}`); });
    const { voice, jobs, store } = setup({ request, maxCharactersPerRequest: 10, maxCharactersPerDay: 10 });
    await expect(voice.synthesise(input("failure", "1234567890"))).rejects.toMatchObject({ code: "provider_error" });
    await expect(voice.synthesise(input("failure", "1234567890"))).rejects.toMatchObject({ code: "duplicate" });
    await expect(voice.synthesise(input("quota", "1"))).rejects.toMatchObject({ code: "quota" });
    expect((request as ReturnType<typeof mocked>).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(voice.limits().usedCharactersToday).toBe(10);
    expect(JSON.stringify([jobs.list(), store.listMemory("voice.")])).not.toContain(key);
  });
  it("refuses unexpected or oversized provider audio without retrying or leaking response bodies", async () => {
    const bad = setup({ request: mocked(async () => Response.json({ error: key })) });
    await expect(bad.voice.synthesise(input())).rejects.toMatchObject({ code: "provider_error" });
    expect(JSON.stringify(bad.jobs.list())).not.toContain(key);
    const large = setup({ request: mocked(async () => new Response(new Uint8Array(2 * 1024 * 1024 + 1), { headers: { "Content-Type": "audio/mpeg" } })) });
    await expect(large.voice.synthesise(input())).rejects.toThrow("size limit");
  });
  it("refuses speech when voice read authentication fails and does not submit a billed request", async () => {
    const request = vi.fn(async () => Response.json({ error: key }, { status: 401 }));
    const { voice } = setup({ request });
    expect(await voice.status()).toMatchObject({ state: "error", enabled: false });
    await expect(voice.synthesise(input())).rejects.toMatchObject({ code: "provider_error" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("refuses a preview while the shared runner is busy instead of leaving an impossible queued request", async () => {
    const { voice, jobs, request } = setup();
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { started = resolve; });
    jobs.register("held_fixture", async () => { started(); await held; });
    jobs.enqueue("held_fixture", {}, { idempotencyKey: "held-fixture" });
    const running = jobs.runOnce();
    await ready;
    await expect(voice.synthesise(input())).rejects.toMatchObject({ code: "busy" });
    release();
    await running;
    await jobs.runOnce();
    expect(jobs.list().find(job => job.type === "owner_speech_preview")).toMatchObject({ status: "dead", attempts: 0 });
    expect(request).not.toHaveBeenCalled();
    expect(voice.limits().usedCharactersToday).toBe(0);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ElevenLabsVoice } from "@atlas/core";
import { buildRuntime } from "./runtime.js";
import { installOwnerAuth } from "./auth.js";
import { installVoiceRoutes } from "./voice.js";

const origin = "https://jarvis.example.test";
const ownerKey = "fictional-owner-key-".repeat(3);
const readKey = "fictional-read-key-".repeat(3);
const voiceId = "voice_fixture_12345678";
const runtimes: ReturnType<typeof buildRuntime>[] = [];
function setup(enabled = true) {
  const rt = buildRuntime({ ATLAS_MODE: "fake" }); runtimes.push(rt);
  const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => init?.method === "POST"
    ? new Response("ID3fictional-audio", { headers: { "Content-Type": "audio/mpeg" } })
    : Response.json({ voice_id: voiceId, name: "Fictional owner voice" }));
  const voice = new ElevenLabsVoice({ apiKey: "fictional-provider-key", voiceId, enabled, store: rt.atlas.deps.store, jobs: rt.atlas.jobs, request });
  const app = new Hono();
  installOwnerAuth(app, rt, { ownerAccessKey: ownerKey, publicOrigin: origin, briefingReadToken: readKey });
  installVoiceRoutes(app, voice);
  const login = async () => {
    const response = await app.request(`${origin}/api/auth/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ accessKey: ownerKey }) });
    expect(response.status).toBe(200);
    const cookie = /__Host-atlas_session=[a-f0-9]{64}/.exec(response.headers.get("set-cookie") ?? "")?.[0];
    expect(cookie).toBeTruthy();
    return cookie!;
  };
  const speak = (cookie: string, value: unknown, headers: Record<string, string> = {}) => app.request(`${origin}/api/voice/speak`, { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json", ...headers }, body: JSON.stringify(value) });
  return { app, request, login, speak };
}
afterEach(() => { for (const rt of runtimes.splice(0)) rt.atlas.deps.store.close(); });

describe("owner voice endpoints", () => {
  it("requires owner authentication and refuses the briefing-only token without touching the provider", async () => {
    const { app, request } = setup();
    expect((await app.request(`${origin}/api/voice/status`)).status).toBe(401);
    expect((await app.request(`${origin}/api/voice/status`, { headers: { Authorization: `Bearer ${readKey}` } })).status).toBe(401);
    expect(request).not.toHaveBeenCalled();
  });
  it("status polling only makes read requests and never generates audio", async () => {
    const { app, request, login } = setup();
    const cookie = await login();
    for (let i = 0; i < 3; i++) {
      const response = await app.request(`${origin}/api/voice/status`, { headers: { Cookie: cookie } });
      expect(await response.json()).toMatchObject({ providerAvailable: true, enabled: true, audioGenerated: false });
    }
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]?.method).toBe("GET");
  });
  it("returns private MPEG audio only after explicit confirmation and allows unbilled replay", async () => {
    const { request, login, speak } = setup();
    const cookie = await login();
    const body = { text: "Fictional owner preview.", requestId: "fixture-request-api-1", confirmProviderUse: true };
    const first = await speak(cookie, body);
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("audio/mpeg");
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(first.headers.get("x-voice-provider")).toBe("ElevenLabs");
    expect(await first.text()).toBe("ID3fictional-audio");
    const replay = await speak(cookie, body);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("x-voice-cached")).toBe("true");
    expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("rejects cross-origin speech, missing confirmation and caller-selected voices", async () => {
    const { request, login, speak } = setup();
    const cookie = await login();
    const body = { text: "Fictional preview.", requestId: "fixture-request-api-1", confirmProviderUse: true };
    expect((await speak(cookie, body, { Origin: "https://attacker.example.test" })).status).toBe(403);
    expect((await speak(cookie, { ...body, confirmProviderUse: false })).status).toBe(400);
    expect((await speak(cookie, { ...body, voiceId: "caller-selected" })).status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });
  it("keeps voice disabled until provider credit use is enabled", async () => {
    const { request, login, speak } = setup(false);
    const result = await speak(await login(), { text: "Fictional preview.", requestId: "fixture-request-api-1", confirmProviderUse: true });
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ deviceSpeechAvailable: true });
    expect(request).not.toHaveBeenCalled();
  });
});

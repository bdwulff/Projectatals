import type { Hono } from "hono";
import { ElevenLabsVoice, VoicePreviewError } from "@atlas/core";
import type { Runtime } from "./runtime.js";

export function createOwnerVoice(rt: Runtime, env: NodeJS.ProcessEnv = process.env) {
  return new ElevenLabsVoice({
    apiKey: env.ELEVENLABS_API_KEY, voiceId: env.ELEVENLABS_VOICE_ID,
    modelId: env.ELEVENLABS_MODEL_ID, enabled: env.ATLAS_ELEVENLABS_ENABLED === "true",
    maxCharactersPerRequest: Number(env.ATLAS_VOICE_MAX_CHARACTERS_PER_REQUEST ?? 1200),
    maxCharactersPerDay: Number(env.ATLAS_VOICE_MAX_CHARACTERS_PER_DAY ?? 4000),
    store: rt.atlas.deps.store, jobs: rt.atlas.jobs, clock: rt.atlas.clock,
  });
}

/** Install only after installOwnerAuth. No GET or polling path generates speech. */
export function installVoiceRoutes(app: Hono, voice: ElevenLabsVoice) {
  app.get("/api/voice/status", async (c) => {
    const status = await voice.status();
    return c.json({ ...status, limits: voice.limits(), provider: "ElevenLabs", providerAvailable: status.state === "connected", audioGenerated: false });
  });
  app.post("/api/voice/speak", async (c) => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid speech request." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "Invalid speech request." }, 400);
    const input = body as Record<string, unknown>;
    if (typeof input.text !== "string" || typeof input.requestId !== "string" || input.confirmProviderUse !== true || Object.keys(input).some(key => !["text", "requestId", "confirmProviderUse"].includes(key))) {
      return c.json({ error: "Provide text, a unique requestId and explicit provider-use confirmation." }, 400);
    }
    try {
      const result = await voice.synthesise({ text: input.text, requestId: input.requestId, confirmProviderUse: true });
      c.header("Content-Type", result.contentType);
      c.header("Content-Length", String(result.audio.byteLength));
      c.header("Cache-Control", "no-store");
      c.header("X-Voice-Provider", result.provider);
      c.header("X-Voice-Cached", String(result.cached));
      c.header("X-Voice-Characters", String(result.characters));
      return c.body(new Uint8Array(result.audio).buffer);
    } catch (error) {
      if (!(error instanceof VoicePreviewError)) return c.json({ error: "Speech could not be generated. Provider details withheld; no automatic retry was made." }, 502);
      const code = error.code === "invalid_request" ? 400 : error.code === "quota" ? 429 : error.code === "duplicate" || error.code === "busy" ? 409 : error.code === "unavailable" ? 503 : 502;
      return c.json({ error: error.message, code: error.code, deviceSpeechAvailable: true }, code);
    }
  });
}

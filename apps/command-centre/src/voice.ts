export interface CloudVoiceStatus {
  provider: "ElevenLabs";
  providerAvailable: boolean;
  enabled: boolean;
  state: "connected" | "not_connected" | "error";
  detail: string;
  voiceName?: string;
  limits: { maxCharactersPerRequest: number; maxCharactersPerDay: number; usedCharactersToday: number };
}

/** Keys never enter browser code. This GET only verifies the configured voice. */
export async function cloudVoiceStatus(): Promise<CloudVoiceStatus> {
  const response = await fetch("/api/voice/status", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Cloud voice is unavailable. Device voice can still be used.");
  return response.json() as Promise<CloudVoiceStatus>;
}

/** Call only from an explicit owner preview click, never polling or automatic replies. */
export async function requestCloudVoice(text: string, requestId: string): Promise<Blob> {
  const response = await fetch("/api/voice/speak", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, requestId, confirmProviderUse: true }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? "Cloud speech was not generated. No automatic retry was made.");
  }
  if (!/^audio\/mpeg(?:\s*;|$)/i.test(response.headers.get("Content-Type") ?? "")) throw new Error("The speech server did not return audio.");
  return response.blob();
}

export interface CloudVoiceStatus {
  provider: "ElevenLabs";
  providerAvailable: boolean;
  enabled: boolean;
  state: "connected" | "not_connected" | "error";
  detail: string;
  voiceName?: string;
  limits: { maxCharactersPerRequest: number; maxCharactersPerDay: number; usedCharactersToday: number };
}

export const DEVICE_VOICE_ACTIVITY_EVENT = "atlas:device-voice-activity";
export const DEVICE_VOICE_CHANGED_EVENT = "atlas:device-voice-changed";
const DEVICE_VOICE_KEY = "jarvis.device-voice";
const GREETING_SESSION_KEY = "jarvis.greeted-session";
const voiceActivities = new Set<string>();
let greetedSessionInMemory: string | null = null;

/** Coordinates local speech with the microphone and explicit premium playback. */
export function setDeviceVoiceActivity(source: string, active: boolean): void {
  if (active) voiceActivities.add(source);
  else voiceActivities.delete(source);
  window.dispatchEvent(new Event(DEVICE_VOICE_ACTIVITY_EVENT));
}

export function deviceVoiceActivityActive(): boolean { return voiceActivities.size > 0; }

export function deviceMediaBusy(): boolean {
  return Array.from(document.querySelectorAll("audio,video")).some(element => element instanceof HTMLMediaElement && !element.paused && !element.ended);
}

export function deviceVoiceBusy(): boolean {
  return voiceActivities.size > 0 || Boolean(window.speechSynthesis?.speaking || window.speechSynthesis?.pending) || deviceMediaBusy();
}

export function readDeviceVoicePreference(): string {
  try { return localStorage.getItem(DEVICE_VOICE_KEY) ?? "auto"; } catch { return "auto"; }
}

export function saveDeviceVoicePreference(voiceURI: string): void {
  try { localStorage.setItem(DEVICE_VOICE_KEY, voiceURI); } catch { /* Device storage can be unavailable in private browsing. */ }
  window.dispatchEvent(new Event(DEVICE_VOICE_CHANGED_EVENT));
}

/** Prefer a voice installed on the device; no Atlas API or paid voice provider is called. */
export function chooseDeviceVoice(voices: readonly SpeechSynthesisVoice[], preference = readDeviceVoicePreference()): SpeechSynthesisVoice | undefined {
  return voices.find(voice => voice.voiceURI === preference)
    ?? voices.find(voice => voice.localService && /^en[-_]AU$/i.test(voice.lang))
    ?? voices.find(voice => voice.localService && /^en(?:[-_]|$)/i.test(voice.lang))
    ?? voices.find(voice => voice.localService)
    ?? voices.find(voice => /^en[-_]AU$/i.test(voice.lang))
    ?? voices.find(voice => /^en(?:[-_]|$)/i.test(voice.lang))
    ?? voices[0];
}

export function makeDeviceUtterance(text: string): SpeechSynthesisUtterance {
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = chooseDeviceVoice(window.speechSynthesis.getVoices());
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang ?? "en-AU";
  utterance.rate = 1.02;
  return utterance;
}

export function greetingForTime(now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", hourCycle: "h23" }).format(now));
  return `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, Brandon. Jarvis is ready. Your private workspace is open.`;
}

export function hasGreetedSession(sessionId: string): boolean {
  try { return sessionStorage.getItem(GREETING_SESSION_KEY) === sessionId; } catch { return greetedSessionInMemory === sessionId; }
}

export function markGreetedSession(sessionId: string): void {
  greetedSessionInMemory = sessionId;
  try { sessionStorage.setItem(GREETING_SESSION_KEY, sessionId); } catch { /* In-memory fallback prevents repeated greetings during this visit. */ }
}

export function resetGreetingSession(): void {
  greetedSessionInMemory = null;
  try { sessionStorage.removeItem(GREETING_SESSION_KEY); } catch { /* No device storage. */ }
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

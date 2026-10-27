/** Local-only speech and shared deduplication for explicit and automatic discovery reports. */
export const DISCOVERY_REPORT_SPOKEN_EVENT = "jarvis:discovery-report-spoken";
const SPOKEN_KEY = "jarvis.discovery.reports-spoken";
const spokenInMemory = new Set<string>();
const MAX_REMEMBERED = 30;

export interface SpeakableDiscoveryReport { id: string; spokenSummary: string; fixture: boolean }

function remembered(storage: Storage | undefined): string[] {
  try {
    const value: unknown = JSON.parse(storage?.getItem(SPOKEN_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.length <= 200).slice(-MAX_REMEMBERED) : [];
  } catch { return []; }
}
function localStorageSafe(): Storage | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
function sessionStorageSafe(): Storage | undefined { try { return globalThis.sessionStorage; } catch { return undefined; } }

/** Read-only metadata; IDs contain no report text, business names, tokens or credentials. */
export function hasSpokenDiscoveryReport(reportId: string): boolean {
  return spokenInMemory.has(reportId) || remembered(localStorageSafe()).includes(reportId) || remembered(sessionStorageSafe()).includes(reportId);
}

/** Call only when the browser confirms speech has actually started. */
export function markDiscoveryReportSpoken(reportId: string): void {
  if (!reportId || reportId.length > 200) return;
  spokenInMemory.add(reportId);
  while (spokenInMemory.size > MAX_REMEMBERED) spokenInMemory.delete(spokenInMemory.values().next().value!);
  for (const storage of [localStorageSafe(), sessionStorageSafe()]) {
    try { storage?.setItem(SPOKEN_KEY, JSON.stringify([...new Set([...remembered(storage), reportId])].slice(-MAX_REMEMBERED))); } catch { /* This visit still deduplicates when browser storage is blocked. */ }
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DISCOVERY_REPORT_SPOKEN_EVENT));
}

/** Browser cloud voices are excluded: reports use an installed device voice only. */
export function chooseLocalReportVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const local = voices.filter(voice => voice.localService);
  let preference = "auto";
  try { preference = globalThis.localStorage?.getItem("jarvis.device-voice") ?? "auto"; } catch { /* Default installed voice. */ }
  return local.find(voice => voice.voiceURI === preference)
    ?? local.find(voice => /^en[-_]AU$/i.test(voice.lang))
    ?? local.find(voice => /^en(?:[-_]|$)/i.test(voice.lang))
    ?? local[0];
}

export function discoveryReportSpeechText(report: SpeakableDiscoveryReport): string {
  const prefix = report.fixture ? "Fictional test report. " : "";
  const text = typeof report.spokenSummary === "string" ? report.spokenSummary.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  return prefix + text.slice(0, 900 - prefix.length);
}

/** Returns null instead of silently choosing an online voice or a paid fallback. */
export function makeDiscoveryReportUtterance(report: SpeakableDiscoveryReport): SpeechSynthesisUtterance | null {
  if (typeof window === "undefined" || !window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") return null;
  const voice = chooseLocalReportVoice(window.speechSynthesis.getVoices());
  const text = discoveryReportSpeechText(report);
  if (!voice || !text) return null;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = 1.02;
  return utterance;
}

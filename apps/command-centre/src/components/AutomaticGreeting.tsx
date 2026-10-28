import { useCallback, useEffect, useRef, useState } from "react";
import { SlidersHorizontal, Volume2, VolumeX } from "lucide-react";
import { DEVICE_VOICE_ACTIVITY_EVENT, chooseDeviceVoice, deviceMediaBusy, deviceVoiceActivityActive, deviceVoiceBusy, greetingForTime, hasGreetedSession, makeDeviceUtterance, markGreetedSession, readDeviceVoicePreference, saveDeviceVoicePreference } from "../voice";
import "./automatic-greeting.css";

const ENABLED_KEY = "jarvis.automatic-greeting";
type GreetingState = "ready" | "starting" | "speaking" | "done" | "needs_tap" | "waiting" | "unavailable";
function enabledOnDevice(): boolean { try { return localStorage.getItem(ENABLED_KEY) !== "off"; } catch { return true; } }

/** Fixed local greeting, mounted only inside an authenticated owner session. */
export function AutomaticGreeting({ sessionId }: { sessionId: string }) {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  const [enabled, setEnabled] = useState(enabledOnDevice);
  const [state, setState] = useState<GreetingState>(supported ? hasGreetedSession(sessionId) ? "done" : "ready" : "unavailable");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voicePreference, setVoicePreference] = useState(readDeviceVoicePreference);
  const [busy, setBusy] = useState(false);
  const current = useRef<SpeechSynthesisUtterance | null>(null);
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureRetried = useRef(false);
  const mounted = useRef(true);
  const attemptRef = useRef<() => void>(() => {});

  const clearDeadline = useCallback(() => { if (deadline.current !== null) { clearTimeout(deadline.current); deadline.current = null; } }, []);
  const stopOwnGreeting = useCallback(() => {
    clearDeadline();
    if (!current.current) return;
    current.current.onstart = current.current.onend = current.current.onerror = null;
    current.current = null;
    window.speechSynthesis.cancel();
  }, [clearDeadline]);

  const speakGreeting = useCallback(() => {
    if (!supported || current.current || document.visibilityState === "hidden") return;
    if (deviceVoiceBusy()) { setBusy(true); setState("waiting"); return; }
    setBusy(false);
    try {
      const utterance = makeDeviceUtterance(greetingForTime());
      current.current = utterance;
      setState("starting");
      utterance.onstart = () => {
        if (current.current !== utterance || !mounted.current) return;
        clearDeadline(); markGreetedSession(sessionId); setState("speaking");
      };
      utterance.onend = () => {
        if (current.current !== utterance || !mounted.current) return;
        clearDeadline(); current.current = null; setState("done");
      };
      utterance.onerror = () => {
        if (current.current !== utterance || !mounted.current) return;
        clearDeadline(); current.current = null; setState("needs_tap");
      };
      // Mobile browsers can silently block automatic speech until a trusted tap.
      deadline.current = setTimeout(() => {
        if (current.current !== utterance || !mounted.current) return;
        stopOwnGreeting(); setState("needs_tap");
      }, 1800);
      window.speechSynthesis.speak(utterance);
    } catch { stopOwnGreeting(); setState("needs_tap"); }
  }, [supported, sessionId, clearDeadline, stopOwnGreeting]);
  attemptRef.current = speakGreeting;

  useEffect(() => {
    mounted.current = true;
    if (!supported) return () => { mounted.current = false; };
    const updateVoices = () => setVoices(window.speechSynthesis.getVoices());
    updateVoices(); window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
    const activityChanged = () => {
      // A command, microphone or premium preview takes priority over a greeting.
      const otherActivity = current.current ? deviceVoiceActivityActive() || deviceMediaBusy() : deviceVoiceBusy();
      setBusy(otherActivity);
      if (otherActivity && current.current) { stopOwnGreeting(); setState(hasGreetedSession(sessionId) ? "done" : "waiting"); }
    };
    window.addEventListener(DEVICE_VOICE_ACTIVITY_EVENT, activityChanged);
    const mediaEvents = ["play", "pause", "ended", "error"];
    mediaEvents.forEach(event => document.addEventListener(event, activityChanged, true));
    return () => {
      mounted.current = false; stopOwnGreeting();
      window.speechSynthesis.removeEventListener("voiceschanged", updateVoices);
      window.removeEventListener(DEVICE_VOICE_ACTIVITY_EVENT, activityChanged);
      mediaEvents.forEach(event => document.removeEventListener(event, activityChanged, true));
    };
  }, [supported, sessionId, stopOwnGreeting]);

  useEffect(() => {
    if (!enabled || !supported || hasGreetedSession(sessionId)) return;
    // A short delay survives React's development StrictMode mount check without duplicate speech.
    const timer = setTimeout(() => { if (!hasGreetedSession(sessionId)) attemptRef.current(); }, 280);
    return () => clearTimeout(timer);
  }, [enabled, supported, sessionId]);

  useEffect(() => {
    if (!enabled || !supported || state !== "ready") return;
    const visible = () => { if (document.visibilityState === "visible" && !hasGreetedSession(sessionId)) attemptRef.current(); };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [enabled, supported, sessionId, state]);

  useEffect(() => {
    if (!enabled || !supported || state !== "needs_tap" && state !== "waiting" || gestureRetried.current || hasGreetedSession(sessionId)) return;
    const retryOnInteraction = (event: Event) => {
      if (!event.isTrusted || document.visibilityState !== "visible" || deviceVoiceBusy()) return;
      const target = event.target;
      // Never steal the tap used to start a command, microphone, media or another control.
      if (target instanceof Element && target.closest("button,a,input,select,textarea,audio,video,[contenteditable=true]")) return;
      if (event instanceof KeyboardEvent && (event.metaKey || event.ctrlKey || event.altKey)) return;
      gestureRetried.current = true;
      attemptRef.current();
    };
    document.addEventListener("pointerup", retryOnInteraction);
    document.addEventListener("keydown", retryOnInteraction);
    return () => { document.removeEventListener("pointerup", retryOnInteraction); document.removeEventListener("keydown", retryOnInteraction); };
  }, [enabled, supported, state, sessionId]);

  const toggle = () => {
    const next = !enabled; setEnabled(next);
    try { localStorage.setItem(ENABLED_KEY, next ? "on" : "off"); } catch { /* Preference is still applied for this visit. */ }
    if (!next) { stopOwnGreeting(); setState(hasGreetedSession(sessionId) ? "done" : "ready"); }
    else if (!hasGreetedSession(sessionId)) speakGreeting();
  };
  const chosen = chooseDeviceVoice(voices, voicePreference);
  const status = !supported ? "Device speech is unavailable in this browser." : state === "speaking" ? "Speaking your welcome." : state === "starting" ? "Starting device speech…" : state === "waiting" ? "Your command or audio has priority. Tap Speak greeting when finished." : state === "needs_tap" ? "Your browser needs a tap to allow speech. Choose Speak greeting." : !enabled ? "Automatic welcome is off on this device." : state === "done" ? "Welcomed for this sign-in. No repeated greeting when you change screens." : "Automatic welcome is on for this device.";

  return <section className="jarvis-greeting" aria-label="Automatic voice greeting">
    <div className="jarvis-greeting__intro"><span className="jarvis-greeting__icon"><Volume2 size={16} aria-hidden /></span><div><strong>Welcome voice <span>No AI credits</span></strong><p role="status">{status}</p></div></div>
    <div className="jarvis-greeting__actions">
      <button type="button" aria-label="Automatic greeting" aria-pressed={enabled} disabled={!supported} onClick={toggle}>{enabled ? <Volume2 size={13} aria-hidden /> : <VolumeX size={13} aria-hidden />}Auto {enabled ? "on" : "off"}</button>
      {state === "speaking" || state === "starting" ? <button type="button" onClick={() => { stopOwnGreeting(); setState(hasGreetedSession(sessionId) ? "done" : "ready"); }}>Stop welcome</button> : <button type="button" onClick={speakGreeting} disabled={!supported || busy}>Speak greeting</button>}
      <details className="jarvis-greeting__settings"><summary aria-label="Device voice settings"><SlidersHorizontal size={14} aria-hidden /><span>Voice</span></summary><div><label htmlFor="jarvis-device-voice">Device voice</label><select id="jarvis-device-voice" value={voicePreference} disabled={!supported} onChange={event => { setVoicePreference(event.target.value); saveDeviceVoicePreference(event.target.value); }}><option value="auto">Automatic · prefer installed Australian voice</option>{voices.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}{voice.localService ? " · installed" : " · browser"}</option>)}</select><p>{chosen ? `Selected: ${chosen.name}. ` : "Your browser selects the voice. "}The OS/browser supplies speech. Jarvis makes no AI or ElevenLabs request for greetings. Available while this app is open; iPhone may require a tap.</p></div></details>
    </div>
  </section>;
}

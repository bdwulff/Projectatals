import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { discoveryProgram, type DiscoveryProgramReport } from "../discovery-program-client";
import { DISCOVERY_REPORT_SPOKEN_EVENT, chooseLocalReportVoice, hasSpokenDiscoveryReport, makeDiscoveryReportUtterance, markDiscoveryReportSpoken } from "../discovery-report-voice";
import { DEVICE_VOICE_ACTIVITY_EVENT, DEVICE_VOICE_CHANGED_EVENT, deviceVoiceBusy, setDeviceVoiceActivity } from "../voice";
import "./discovery-report-voice.css";

const ENABLED_KEY = "jarvis.discovery.spoken-updates";
const ACTIVITY = "discovery-report-announcement";
type SpeechState = "ready" | "waiting" | "starting" | "speaking" | "done" | "needs_tap" | "unavailable";
function preferredEnabled(): boolean { try { return localStorage.getItem(ENABLED_KEY) !== "off"; } catch { return true; } }
function pageVisible(): boolean { return document.visibilityState !== "hidden"; }
function isFinished(report: DiscoveryProgramReport | null): report is DiscoveryProgramReport { return Boolean(report?.finishedAt && !["queued", "running"].includes(report.state)); }

/** Mounted only inside owner sign-in. It reads report metadata and uses installed speech voices. */
export function DiscoveryReportVoice({ sessionId }: { sessionId: string }) {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  const [enabled, setEnabled] = useState(preferredEnabled);
  const [unlocked, setUnlocked] = useState(false);
  const [visible, setVisible] = useState(document.visibilityState !== "hidden");
  const [report, setReport] = useState<DiscoveryProgramReport | null>(null);
  const [state, setState] = useState<SpeechState>(supported ? "ready" : "unavailable");
  const [localVoice, setLocalVoice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<{ utterance: SpeechSynthesisUtterance; reportId: string } | null>(null);
  const startingDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changingOwnActivity = useRef(false);
  const mounted = useRef(false);
  const values = useRef({ enabled, unlocked, report });
  values.current = { enabled, unlocked, report };
  const attemptRef = useRef<(force?: boolean) => void>(() => {});

  const clearDeadline = useCallback(() => { if (startingDeadline.current !== null) { clearTimeout(startingDeadline.current); startingDeadline.current = null; } }, []);
  const activity = useCallback((active: boolean) => {
    changingOwnActivity.current = true;
    try { setDeviceVoiceActivity(ACTIVITY, active); } finally { changingOwnActivity.current = false; }
  }, []);
  const stopOwnSpeech = useCallback(() => {
    clearDeadline();
    const owned = current.current;
    if (!owned) return;
    current.current = null;
    owned.utterance.onstart = owned.utterance.onend = owned.utterance.onerror = null;
    // Keep the activity reservation until cancellation finishes, so another control cannot race it.
    window.speechSynthesis.cancel();
    activity(false);
  }, [activity, clearDeadline]);

  const attempt = useCallback((force = false) => {
    const latest = values.current;
    if (!mounted.current || !supported || current.current || document.visibilityState === "hidden" || !isFinished(latest.report)) return;
    if (!force && (!latest.enabled || !latest.unlocked || hasSpokenDiscoveryReport(latest.report.id))) return;
    if (deviceVoiceBusy()) { setState("waiting"); return; }
    const utterance = makeDiscoveryReportUtterance(latest.report);
    if (!utterance) { setState("unavailable"); return; }
    const reportId = latest.report.id;
    current.current = { utterance, reportId }; setState("starting");
    const isCurrent = () => mounted.current && current.current?.utterance === utterance;
    utterance.onstart = () => {
      if (!isCurrent()) return;
      clearDeadline(); markDiscoveryReportSpoken(reportId); setState("speaking");
    };
    utterance.onend = () => {
      if (!isCurrent()) return;
      clearDeadline(); current.current = null; activity(false); setState("done");
    };
    utterance.onerror = () => {
      if (!isCurrent()) return;
      clearDeadline(); current.current = null; activity(false); setState("needs_tap"); setUnlocked(false);
    };
    activity(true);
    startingDeadline.current = setTimeout(() => {
      if (!isCurrent()) return;
      stopOwnSpeech(); setState("needs_tap"); setUnlocked(false);
    }, 1800);
    try { window.speechSynthesis.speak(utterance); }
    catch { stopOwnSpeech(); setState("needs_tap"); setUnlocked(false); }
  }, [activity, clearDeadline, stopOwnSpeech, supported]);
  attemptRef.current = attempt;

  useEffect(() => {
    mounted.current = true;
    setUnlocked(false);
    const visibility = () => {
      const next = document.visibilityState !== "hidden"; setVisible(next);
      if (!next) { stopOwnSpeech(); setState("ready"); }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => { mounted.current = false; stopOwnSpeech(); document.removeEventListener("visibilitychange", visibility); };
  }, [sessionId, stopOwnSpeech]);

  useEffect(() => {
    if (!visible) return;
    let live = true, inFlight = false;
    const poll = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const snapshot = await discoveryProgram.snapshot();
        if (live && mounted.current && pageVisible()) { setReport(snapshot.latestReport); setError(null); }
      } catch { if (live && mounted.current) setError("Discovery updates are unavailable. Open Studio to check the program."); }
      finally { inFlight = false; }
    };
    void poll();
    const timer = setInterval(() => void poll(), 30_000);
    return () => { live = false; clearInterval(timer); };
  }, [visible, sessionId]);

  useEffect(() => {
    if (!supported) return;
    const updateVoices = () => { setLocalVoice(Boolean(chooseLocalReportVoice(window.speechSynthesis.getVoices()))); attemptRef.current(); };
    const changed = () => {
      if (changingOwnActivity.current) return;
      if (current.current) { stopOwnSpeech(); setState("waiting"); }
      else attemptRef.current();
    };
    const marked = () => { if (!current.current && values.current.report && hasSpokenDiscoveryReport(values.current.report.id)) setState("done"); };
    updateVoices(); window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
    window.addEventListener(DEVICE_VOICE_CHANGED_EVENT, updateVoices);
    window.addEventListener(DEVICE_VOICE_ACTIVITY_EVENT, changed);
    window.addEventListener(DISCOVERY_REPORT_SPOKEN_EVENT, marked);
    // A newly playing audio/video clip also takes priority over an automatic update.
    document.addEventListener("play", changed, true);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", updateVoices);
      window.removeEventListener(DEVICE_VOICE_CHANGED_EVENT, updateVoices);
      window.removeEventListener(DEVICE_VOICE_ACTIVITY_EVENT, changed);
      window.removeEventListener(DISCOVERY_REPORT_SPOKEN_EVENT, marked);
      document.removeEventListener("play", changed, true);
    };
  }, [supported, stopOwnSpeech]);

  useEffect(() => {
    if (!visible || !enabled || !unlocked || !isFinished(report) || hasSpokenDiscoveryReport(report.id)) return;
    // Wait through a greeting, microphone or media playback, then announce the pending result.
    const timer = setTimeout(() => attemptRef.current(), 220);
    const retry = setInterval(() => attemptRef.current(), 800);
    return () => { clearTimeout(timer); clearInterval(retry); };
  }, [enabled, unlocked, visible, report, state]);

  const enable = () => {
    setEnabled(true); setUnlocked(true); values.current.enabled = values.current.unlocked = true;
    try { localStorage.setItem(ENABLED_KEY, "on"); } catch { /* Current visit preference still works. */ }
    attemptRef.current();
  };
  const pause = () => {
    setEnabled(false); values.current.enabled = false; stopOwnSpeech(); setState("ready");
    try { localStorage.setItem(ENABLED_KEY, "off"); } catch { /* Current visit preference still works. */ }
  };
  const readLatest = () => { setUnlocked(true); values.current.unlocked = true; attemptRef.current(true); };
  const status = error ?? (!supported ? "Device speech is unavailable in this browser. Reports remain in Studio."
    : !localVoice ? "Install an English voice in Mac System Settings → Accessibility → Read & Speak / Spoken Content. No cloud voice is used."
    : state === "speaking" ? "Speaking the latest discovery report with your installed voice."
    : state === "starting" ? "Starting device speech…"
    : state === "needs_tap" ? "Your browser needs a tap. Choose Read latest report."
    : state === "waiting" ? "Your microphone or audio has priority. The report will wait."
    : !enabled ? "Automatic updates are paused on this device."
    : !unlocked ? "Enable once per visit to hear finished discovery reports while Jarvis is open."
    : "Finished discovery reports will speak once while this app is visible.");

  return <section className="discovery-report-voice" aria-label="Spoken discovery updates">
    <div className="discovery-report-voice__body"><span className="discovery-report-voice__icon"><Volume2 size={15} aria-hidden /></span><div><strong>Discovery updates · device voice</strong><p role="status">{status}</p><small>No Lovable, AI or ElevenLabs credits for these spoken reports.</small></div></div>
    <div className="discovery-report-voice__controls">
      {enabled && unlocked ? <button type="button" onClick={pause}><VolumeX size={13} aria-hidden />Pause spoken updates</button> : <button type="button" onClick={enable} disabled={!supported || !localVoice}><Volume2 size={13} aria-hidden />Enable spoken updates</button>}
      <button type="button" onClick={readLatest} disabled={!supported || !localVoice || !isFinished(report) || state === "starting" || state === "speaking"}>Read latest report</button>
    </div>
  </section>;
}

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, RefreshCw, ShieldCheck, Square, Trash2 } from "lucide-react";
import { SESSION_EXPIRED_EVENT } from "../api";
import { setDeviceVoiceActivity } from "../voice";
import "./recorded-voice-input.css";

interface InputStatus {
  provider: "ElevenLabs";
  enabled: boolean;
  configured: boolean;
  state: "not_connected" | "unverified" | "connected";
  detail: string;
  limits: { maxAudioBytes: number; maxDurationMs: number; maxRequestsPerDay: number; usedRequestsToday: number; maxReservedSecondsPerDay: number; usedReservedSecondsToday: number; maxAudioBytesPerDay: number; usedAudioBytesToday: number; durationLimitVerifiedByServer: false };
}
interface Clip { blob: Blob; mimeType: string; durationMs: number; requestId: string; url: string }
export interface RecordedVoiceInputProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  onRecordingChange?: (active: boolean) => void;
  stopSignal?: number;
}
type Phase = "idle" | "requesting" | "recording" | "ready" | "sending";
const MAX_BYTES = 1024 * 1024;
const MAX_DURATION = 30_000;
const ACTIVITY = "recorded-voice-input";

function recorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"].find(value => MediaRecorder.isTypeSupported(value));
}
function baseMime(value: string): string | null {
  const mime = value.split(";", 1)[0]?.toLowerCase();
  return mime && ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"].includes(mime) ? mime : null;
}
function pageHidden(): boolean { return document.visibilityState === "hidden"; }
function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const value = typeof reader.result === "string" ? reader.result : ""; const index = value.indexOf(","); if (index < 0) reject(new Error("The recording could not be read.")); else resolve(value.slice(index + 1)); };
    reader.onerror = () => reject(new Error("The recording could not be read."));
    reader.readAsDataURL(blob);
  });
}

/** Optional recorded input. Only the per-clip Transcribe click can upload audio. */
export function RecordedVoiceInput({ onTranscript, disabled = false, onRecordingChange, stopSignal }: RecordedVoiceInputProps) {
  const [status, setStatus] = useState<InputStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [clip, setClip] = useState<Clip | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [creditConsent, setCreditConsent] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const clipRef = useRef<Clip | null>(null);
  const request = useRef<AbortController | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const callback = useRef(onRecordingChange);
  const inputCallback = useRef(onTranscript);
  const phaseRef = useRef<Phase>(phase);
  const starting = useRef(false);
  callback.current = onRecordingChange; inputCallback.current = onTranscript;
  const supported = typeof window !== "undefined" && window.isSecureContext && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  function updatePhase(next: Phase) {
    phaseRef.current = next;
    if (mounted.current) setPhase(next);
    const active = next === "requesting" || next === "recording" || next === "sending";
    setDeviceVoiceActivity(ACTIVITY, active);
    callback.current?.(active);
  }
  function clearTimers() { if (timer.current) clearTimeout(timer.current); if (ticker.current) clearInterval(ticker.current); timer.current = ticker.current = null; }
  function stopTracks() { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; }
  function dropClip() {
    player.current?.pause();
    if (clipRef.current) URL.revokeObjectURL(clipRef.current.url);
    clipRef.current = null;
    if (mounted.current) { setClip(null); setCreditConsent(false); setAttempted(false); }
  }
  function cancel() {
    generation.current++; starting.current = false; clearTimers();
    request.current?.abort(); request.current = null;
    const current = recorder.current; recorder.current = null;
    if (current) { current.ondataavailable = current.onstop = current.onerror = null; if (current.state !== "inactive") { try { current.stop(); } catch { /* Already stopped. */ } } }
    stopTracks(); dropClip(); updatePhase("idle");
    if (mounted.current) { setElapsed(0); setNotice(null); }
  }
  async function loadStatus() {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/voice/input-status", { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      if (!response.ok) throw new Error("Recorded voice input could not be checked. Browser speech or keyboard dictation can still be used.");
      const next = await response.json() as InputStatus;
      if (mounted.current) setStatus(next);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Recorded voice input is unavailable."); }
    finally { if (mounted.current) setLoading(false); }
  }
  useEffect(() => {
    mounted.current = true; void loadStatus();
    const hidden = () => { if (document.visibilityState === "hidden") cancel(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { mounted.current = false; cancel(); document.removeEventListener("visibilitychange", hidden); };
  }, []);
  useEffect(() => { cancel(); }, [stopSignal]);
  useEffect(() => { if (disabled && (phaseRef.current === "requesting" || phaseRef.current === "recording")) cancel(); }, [disabled]);

  async function beginRecording() {
    if (disabled || starting.current || !supported || !status?.configured || !status.enabled || phaseRef.current === "sending" || pageHidden()) return;
    starting.current = true; cancel(); starting.current = true;
    const epoch = generation.current;
    setError(null); setNotice(null); setElapsed(0); updatePhase("requesting");
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!mounted.current || epoch !== generation.current || pageHidden()) { microphone.getTracks().forEach(track => track.stop()); return; }
      stream.current = microphone;
      const mime = recorderMime();
      const recording = mime ? new MediaRecorder(microphone, { mimeType: mime }) : new MediaRecorder(microphone);
      const normalized = baseMime(recording.mimeType || mime || "");
      if (!normalized) throw new Error("This browser's recording format is unsupported. Open Jarvis in Safari or Chrome, or use keyboard dictation.");
      recorder.current = recording;
      const chunks: BlobPart[] = []; let size = 0; let tooLarge = false; const began = performance.now();
      const finish = () => { if (recorder.current === recording && recording.state !== "inactive") { clearTimers(); recording.stop(); stopTracks(); } };
      recording.ondataavailable = event => {
        if (epoch !== generation.current || !mounted.current) return;
        size += event.data.size;
        if (size > Math.min(MAX_BYTES, status.limits.maxAudioBytes)) { tooLarge = true; finish(); }
        else if (event.data.size) chunks.push(event.data);
      };
      recording.onerror = () => { if (epoch !== generation.current || !mounted.current) return; cancel(); setError("The microphone recording stopped unexpectedly. Nothing was uploaded; try a shorter recording."); };
      recording.onstop = () => {
        if (epoch !== generation.current || !mounted.current) return;
        clearTimers(); stopTracks(); recorder.current = null;
        if (tooLarge || !size) { updatePhase("idle"); setError(tooLarge ? "That recording exceeded 1 MB. It was discarded without uploading. Try a shorter message." : "The microphone did not capture audio. Check microphone access and try again."); return; }
        const blob = new Blob(chunks, { type: normalized });
        const durationMs = Math.max(100, Math.min(MAX_DURATION, Math.round(performance.now() - began)));
        const next = { blob, durationMs, mimeType: normalized, requestId: crypto.randomUUID(), url: URL.createObjectURL(blob) };
        clipRef.current = next; setClip(next); setCreditConsent(false); setAttempted(false); updatePhase("ready");
        setNotice("Recording ready on this device. It has not been uploaded. Review it, then choose Transcribe if you want to use ElevenLabs credits.");
      };
      recording.start(250); updatePhase("recording");
      ticker.current = setInterval(() => { if (epoch === generation.current && mounted.current) setElapsed(Math.min(30, Math.floor((performance.now() - began) / 1000))); }, 250);
      timer.current = setTimeout(finish, Math.min(MAX_DURATION, status.limits.maxDurationMs));
    } catch (e) {
      if (!mounted.current || epoch !== generation.current) return;
      cancel();
      const name = e instanceof Error ? e.name : "";
      setError(name === "NotAllowedError" || name === "SecurityError" ? "Microphone access was denied. Allow microphone access in Safari or Chrome settings, then try again." : name === "NotFoundError" ? "No microphone was found. Connect or enable your microphone, then try again." : e instanceof Error && e.message.startsWith("This browser") ? e.message : "The microphone could not start. Close other apps using it, check permissions, then try again.");
    } finally { if (epoch === generation.current) starting.current = false; }
  }
  function endRecording() { const current = recorder.current; if (current && current.state !== "inactive") { clearTimers(); current.stop(); stopTracks(); } }
  async function transcribe() {
    const source = clipRef.current;
    if (!source || !creditConsent || disabled || phaseRef.current === "sending") return;
    const epoch = generation.current;
    setError(null); setNotice(null); setAttempted(true); updatePhase("sending");
    const controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const audioBase64 = await blobBase64(source.blob);
      if (epoch !== generation.current || !mounted.current || controller.signal.aborted) return;
      const response = await fetch("/api/voice/transcribe", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ audioBase64, mimeType: source.mimeType, durationMs: source.durationMs, requestId: source.requestId, confirmProviderUse: true }), signal: controller.signal });
      if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      const result = await response.json().catch(() => null) as { text?: unknown; error?: unknown } | null;
      if (epoch !== generation.current || !mounted.current) return;
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "The transcription could not be confirmed. Recover this same request before recording another message.");
      if (typeof result?.text !== "string" || !result.text.trim() || result.text.length > 12_000) throw new Error("No usable transcript was returned. Recover this same request before recording another message.");
      const text = result.text.trim();
      dropClip(); updatePhase("idle"); setNotice("Transcript received. Your recorded audio has been removed from this device's recording panel.");
      inputCallback.current(text);
      void loadStatus();
    } catch (e) {
      if (epoch !== generation.current || !mounted.current) return;
      setError(e instanceof Error && e.name !== "AbortError" ? e.message : "Transcription was not confirmed. The provider may have received it. Recover this same request; no automatic new attempt will be made.");
      updatePhase("ready");
    } finally { clearTimeout(timeout); if (request.current === controller) request.current = null; }
  }

  const available = Boolean(supported && status?.enabled && status.configured);
  const working = phase === "requesting" || phase === "recording" || phase === "sending";
  return <section className="recorded-voice" aria-label="Recorded voice input">
    <div className="recorded-voice__heading"><strong><Mic size={15} aria-hidden />Recorded voice fallback</strong><span>ElevenLabs credits</span></div>
    <p>Use this if browser speech cannot hear you. Recording stays on this device until you explicitly choose Transcribe.</p>
    {!supported && <p className="recorded-voice__notice">Microphone recording is unavailable here. Open Jarvis directly in Safari or Chrome, or tap the microphone on your phone's keyboard to dictate into the command field.</p>}
    <p className="recorded-voice__status">{loading ? "Checking recorded voice availability…" : status?.detail ?? "Recorded input is unavailable until its server connection is configured."}</p>
    {error && <p className="recorded-voice__error" role="alert">{error}</p>}
    {notice && <p className="recorded-voice__notice" role="status">{notice}</p>}
    {phase === "recording" && <p className="recorded-voice__recording" role="status"><span />Recording · {elapsed}s / 30s</p>}
    {phase === "requesting" && <p role="status">Waiting for microphone permission…</p>}
    {clip && <div className="recorded-voice__clip"><div><strong>Voice message · {(clip.durationMs / 1000).toFixed(1)} seconds</strong><span>{Math.ceil(clip.blob.size / 1024)} KB · {attempted ? "Keep this request to recover its outcome" : "Not uploaded"}</span></div><audio ref={player} controls preload="none" src={clip.url} aria-label="Review your voice recording" onPlay={() => setDeviceVoiceActivity(ACTIVITY, true)} onPause={() => setDeviceVoiceActivity(ACTIVITY, phaseRef.current === "sending")} onEnded={() => setDeviceVoiceActivity(ACTIVITY, phaseRef.current === "sending")} /></div>}
    {clip && <label className="recorded-voice__consent"><input type="checkbox" checked={creditConsent} disabled={phase === "sending" || disabled} onChange={event => setCreditConsent(event.target.checked)} /><span>I agree to send this recording to ElevenLabs for transcription using my account credits.</span></label>}
    <div className="recorded-voice__actions">
      {phase === "recording" ? <button type="button" onClick={endRecording}><Square size={13} aria-hidden />Finish recording</button> : !clip && <button type="button" disabled={disabled || !available || working || loading} onClick={() => void beginRecording()}>{phase === "requesting" ? <Loader2 className="recorded-voice__spinner" size={14} aria-hidden /> : <Mic size={14} aria-hidden />}{phase === "requesting" ? "Allow microphone…" : "Record a voice message"}</button>}
      {clip && <button type="button" className="recorded-voice__send" disabled={disabled || !creditConsent || phase === "sending" || !available} onClick={() => void transcribe()}>{phase === "sending" ? <Loader2 size={14} className="recorded-voice__spinner" aria-hidden /> : <RefreshCw size={14} aria-hidden />}{phase === "sending" ? "Transcribing…" : attempted ? "Recover this transcription" : "Transcribe · uses ElevenLabs credits"}</button>}
      {(working || clip) && <button type="button" onClick={cancel}><Trash2 size={13} aria-hidden />{phase === "sending" ? "Close recording" : "Discard recording"}</button>}
      {!working && !clip && <button type="button" disabled={loading} onClick={() => void loadStatus()}><RefreshCw size={13} aria-hidden />Check availability</button>}
    </div>
    <p className="recorded-voice__privacy"><ShieldCheck size={13} aria-hidden />Up to 30 seconds and 1 MB per clip. No automatic uploads or paid retries. Closing an upload cannot undo a provider request already sent.</p>
  </section>;
}

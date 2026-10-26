import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, AudioLines, Check, ChevronRight, CircleAlert, LockKeyhole, Mic, MicOff, PackageSearch, ScanSearch, Sunrise, Volume2, VolumeX } from "lucide-react";
import { api, type CommandResult } from "../api";
import { cloudVoiceStatus, makeDeviceUtterance, requestCloudVoice, setDeviceVoiceActivity, type CloudVoiceStatus } from "../voice";
import { JarvisCore, type JarvisState } from "./JarvisCore";

interface Turn {
  id: number;
  role: "owner" | "atlas";
  text: string;
  outcome?: string;
  approvalId?: string;
}

// Minimal typing for the non-standard Web Speech API.
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: unknown) => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const quickCommands = [
  { label: "Morning briefing", command: "Give me my morning briefing", icon: Sunrise },
  { label: "BoxSafe orders", command: "What orders have come through BoxSafe?", icon: PackageSearch },
  { label: "Find businesses", command: "Find five businesses around Berwick", icon: ScanSearch },
];

export function CommandBar({ onResult }: { onResult?: (r: CommandResult) => void }) {
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [micPending, setMicPending] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [speak, setSpeak] = useState(false);
  const deviceSpeechEnabled = useRef(false);
  const [cloudVoice, setCloudVoice] = useState<CloudVoiceStatus | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState<number | null>(null);
  const [audioUrls, setAudioUrls] = useState<Record<number, string>>({});
  const generatedAudio = useRef<string[]>([]);
  const voiceInFlight = useRef(false);
  const mounted = useRef(true);
  const voiceRequestIds = useRef<Record<number, string>>({});
  const [voiceRecoveryTurn, setVoiceRecoveryTurn] = useState<number | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const audioElements = useRef<Record<number, HTMLAudioElement | null>>({});
  const pendingPlaybackTurn = useRef<number | null>(null);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const commandInput = useRef<HTMLInputElement>(null);
  const Recognition = getRecognition();
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const cloudReady = Boolean(cloudVoice?.providerAvailable && cloudVoice.enabled);
  const coreState: JarvisState = listening ? "listening" : busy || voiceBusy !== null ? "working" : speaking ? "speaking" : voiceError || interactionError ? "error" : "idle";
  const stateHeading = coreState === "listening" ? "I'm listening." : coreState === "working" ? "On it." : coreState === "speaking" ? "Here's your update." : coreState === "error" ? "Let's check that." : "At your service.";
  const stateDetail = listening ? "Microphone active · speak your command" : busy ? "Processing your command" : voiceBusy !== null ? "Preparing your ElevenLabs preview" : speaking ? "Voice playback in progress" : voiceError || interactionError ? "See the response below" : micPending ? "Waiting for microphone access" : Recognition ? "Tap the core to speak, or type below" : "Type a command below to begin";

  useEffect(() => {
    setDeviceVoiceActivity("command-bar", busy || micPending || listening || speaking || voiceBusy !== null);
  }, [busy, micPending, listening, speaking, voiceBusy]);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  }, [turns, busy]);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    void cloudVoiceStatus().then(status => { if (active) setCloudVoice(status); }).catch(() => {});
    return () => {
      active = false;
      mounted.current = false;
      player.current?.pause();
      const recognition = recRef.current;
      recRef.current = null;
      if (recognition) { recognition.onstart = recognition.onend = recognition.onerror = recognition.onresult = null; try { recognition.abort ? recognition.abort() : recognition.stop(); } catch { /* Already stopped. */ } }
      if (utterance.current) { utterance.current = null; window.speechSynthesis?.cancel(); }
      setDeviceVoiceActivity("command-bar", false);
      for (const url of generatedAudio.current) URL.revokeObjectURL(url);
    };
  }, []);

  const stopMic = () => {
    const recognition = recRef.current;
    recRef.current = null;
    if (recognition) { try { recognition.abort ? recognition.abort() : recognition.stop(); } catch { /* Already stopped. */ } }
    setListening(false);
    setMicPending(false);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && recRef.current) { event.preventDefault(); stopMic(); return; }
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k" || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement && target !== commandInput.current)) return;
      event.preventDefault();
      commandInput.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const stopPlayback = () => {
    player.current?.pause();
    player.current = null;
    utterance.current = null;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  };

  const prepareAudio = (audio: HTMLAudioElement) => {
    setDeviceVoiceActivity("command-bar", true);
    stopMic();
    if (player.current && player.current !== audio) player.current.pause();
    utterance.current = null;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    player.current = audio;
  };

  const playExistingAudio = (audio: HTMLAudioElement) => {
    prepareAudio(audio);
    void audio.play().catch(() => {
      if (player.current !== audio) return;
      setSpeaking(false);
      setVoiceError("Audio is ready. Tap its play control below to start playback; no new generation is needed.");
    });
  };

  useEffect(() => {
    const id = pendingPlaybackTurn.current;
    if (id === null) return;
    const audio = audioElements.current[id];
    if (!audio) return;
    pendingPlaybackTurn.current = null;
    playExistingAudio(audio);
  }, [audioUrls]);

  const playCloudVoice = async (turn: Turn, generateAgain = false) => {
    if (voiceInFlight.current || voiceBusy !== null) return;
    setVoiceError(null);
    setInteractionError(null);
    const existing = audioElements.current[turn.id];
    if (audioUrls[turn.id] && existing) { playExistingAudio(existing); return; }
    try {
      if (!cloudVoice?.providerAvailable || !cloudVoice.enabled) throw new Error("ElevenLabs is not connected and enabled. Device voice remains available.");
      setDeviceVoiceActivity("command-bar", true);
      stopMic();
      stopPlayback();
      voiceInFlight.current = true;
      setVoiceBusy(turn.id);
      if (generateAgain || !voiceRequestIds.current[turn.id]) voiceRequestIds.current[turn.id] = crypto.randomUUID();
      const audio = await requestCloudVoice(turn.text, voiceRequestIds.current[turn.id]!);
      if (!mounted.current) return;
      const url = URL.createObjectURL(audio);
      generatedAudio.current.push(url);
      pendingPlaybackTurn.current = turn.id;
      setAudioUrls(current => ({ ...current, [turn.id]: url }));
      setVoiceRecoveryTurn(null);
    } catch (error) {
      if (!mounted.current) return;
      setVoiceError(error instanceof Error ? error.message : "Voice playback failed. Recover the existing preview before generating another.");
      setVoiceRecoveryTurn(turn.id);
    } finally { voiceInFlight.current = false; if (mounted.current) setVoiceBusy(null); }
  };

  const say = (t: string) => {
    if (!deviceSpeechEnabled.current || !ttsSupported) return;
    try {
      setDeviceVoiceActivity("command-bar", true);
      stopMic();
      stopPlayback();
      const u = makeDeviceUtterance(t);
      utterance.current = u;
      u.onstart = () => { if (utterance.current === u) setSpeaking(true); };
      u.onend = u.onerror = () => { if (utterance.current === u) { utterance.current = null; setSpeaking(false); } };
      window.speechSynthesis.speak(u);
    } catch { setSpeaking(false); }
  };

  const submit = async (raw?: string) => {
    const q = (raw ?? text).trim();
    if (!q || busy) return;
    setDeviceVoiceActivity("command-bar", true);
    stopMic();
    stopPlayback();
    setInteractionError(null);
    setVoiceError(null);
    setText("");
    setBusy(true);
    const id = Date.now();
    setTurns(t => [...t, { id, role: "owner", text: q }]);
    try {
      const r = await api.command(q);
      setTurns(t => [...t, { id: id + 1, role: "atlas", text: r.reply, outcome: r.outcome, approvalId: r.approvalId }]);
      if (r.outcome === "failed" || r.outcome === "denied") setInteractionError("The command needs attention. See Jarvis's response in the command log.");
      say(r.reply);
      onResult?.(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTurns(t => [...t, { id: id + 1, role: "atlas", text: `I couldn't reach the Atlas API: ${msg}`, outcome: "failed" }]);
      setInteractionError("I couldn't complete that command. Check the response and try again.");
    } finally { setBusy(false); }
  };

  const toggleMic = () => {
    if (!Recognition || busy || voiceBusy !== null) return;
    if (listening || micPending) { stopMic(); return; }
    setDeviceVoiceActivity("command-bar", true);
    stopPlayback();
    setInteractionError(null);
    setVoiceError(null);
    const rec = new Recognition();
    rec.lang = "en-AU";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onstart = () => {
      if (recRef.current !== rec) { try { rec.abort ? rec.abort() : rec.stop(); } catch { /* Cancel a recogniser that started after cancellation. */ } return; }
      setMicPending(false);
      setListening(true);
    };
    rec.onresult = ev => {
      if (recRef.current !== rec) return;
      const transcript = Array.from({ length: ev.results.length }, (_, i) => ev.results[i]?.[0]?.transcript ?? "").join(" ").trim();
      if (transcript) void submit(transcript);
    };
    rec.onend = () => { if (recRef.current === rec) { recRef.current = null; setListening(false); setMicPending(false); } };
    rec.onerror = () => {
      if (recRef.current !== rec) return;
      recRef.current = null;
      setListening(false);
      setMicPending(false);
      setInteractionError("The microphone couldn't capture a command. Check browser microphone access, or type below.");
    };
    recRef.current = rec;
    setMicPending(true);
    try { rec.start(); }
    catch { recRef.current = null; setMicPending(false); setInteractionError("The microphone couldn't start. You can still type your command."); }
  };

  const toggleDeviceSpeech = () => {
    const next = !deviceSpeechEnabled.current;
    deviceSpeechEnabled.current = next;
    if (!next) { utterance.current = null; window.speechSynthesis.cancel(); if (!player.current || player.current.paused) setSpeaking(false); }
    setSpeak(next);
  };

  const micLabel = !Recognition ? "Voice dictation is unavailable in this browser" : listening || micPending ? "Stop microphone dictation" : "Start microphone dictation";

  return (
    <section className={`jc-command jc-command--${coreState}`} aria-label="Jarvis command interface">
      <div className="jc-command__topline">
        <span className="jc-eyebrow"><span className="jc-status-dot" /> Personal intelligence</span>
        <span className="jc-owner-badge"><LockKeyhole size={11} aria-hidden="true" /> Owner session</span>
      </div>
      <div className="jc-command__identity">
        <h2>J.A.R.V.I.S.</h2>
        <span>Powered by Atlas</span>
      </div>

      <div className="jc-stage">
        <div className="jc-stage__readout jc-stage__readout--left" aria-hidden="true">
          <span className="jc-readout-label">Input</span>
          <strong>{listening ? "Mic active" : "On demand"}</strong>
          <span className="jc-readout-line" />
          <small>{Recognition ? "Voice + text" : "Text commands"}</small>
        </div>
        <JarvisCore state={coreState} interactive={Boolean(Recognition)} onActivate={toggleMic} disabled={busy || voiceBusy !== null} label={micLabel} />
        <div className="jc-stage__readout jc-stage__readout--right" aria-hidden="true">
          <span className="jc-readout-label">Voice</span>
          <strong>{cloudReady ? "ElevenLabs" : "Device voice"}</strong>
          <span className="jc-readout-line" />
          <small>{cloudReady ? "Ready to play" : ttsSupported ? "Available" : "Text output"}</small>
        </div>
      </div>
      <div className="jc-command__state" role="status" aria-live="polite">
        <h3>{stateHeading}</h3>
        <p>{stateDetail}</p>
      </div>

      <div className="jc-shortcuts" aria-label="Quick commands">
        {quickCommands.map(({ label, command, icon: Icon }) => <button key={label} type="button" onClick={() => void submit(command)} disabled={busy}>
          <Icon size={14} strokeWidth={1.5} aria-hidden="true" /><span>{label}</span><ArrowUpRight size={12} className="jc-shortcuts__arrow" aria-hidden="true" />
        </button>)}
      </div>

      {turns.length > 0 && <div className="jc-log">
        <div className="jc-log__heading"><span className="jc-eyebrow">Command log</span><span>This session</span></div>
        <div ref={listRef} className="jc-log__scroll" role="log" aria-live="polite" aria-label="Conversation with Jarvis">
          {turns.map(t => <article key={t.id} className={`jc-turn jc-turn--${t.role}`}>
            <div className="jc-turn__meta"><span>{t.role === "owner" ? "You" : "Jarvis"}</span>{t.role === "atlas" && t.outcome && <span className={`jc-outcome jc-outcome--${t.outcome}`}>{t.outcome === "completed" ? <Check size={10} aria-hidden="true" /> : null}{t.outcome.replaceAll("_", " ")}{t.approvalId ? " · see Approvals" : ""}</span>}</div>
            <p className="jc-turn__text">{t.text}</p>
            {t.role === "atlas" && cloudReady && <div className="jc-turn__voice">
              <button type="button" className="jc-voice-action" disabled={voiceBusy !== null || (!audioUrls[t.id] && t.text.length > cloudVoice!.limits.maxCharactersPerRequest)} onClick={() => void playCloudVoice(t)}>
                <AudioLines size={14} aria-hidden="true" />{voiceBusy === t.id ? "Preparing voice…" : audioUrls[t.id] ? "Replay ElevenLabs voice" : voiceRequestIds.current[t.id] ? "Recover existing voice preview" : "Play ElevenLabs · uses credits"}<ChevronRight size={12} aria-hidden="true" />
              </button>
              {voiceRecoveryTurn === t.id && !audioUrls[t.id] && <button type="button" className="jc-voice-regenerate" disabled={voiceBusy !== null} onClick={() => void playCloudVoice(t, true)}>Generate a new preview · uses credits</button>}
              {t.text.length > cloudVoice!.limits.maxCharactersPerRequest && !audioUrls[t.id] && <p className="jc-voice-note">This reply exceeds the cloud voice length limit. Device voice remains available.</p>}
              {audioUrls[t.id] && <audio ref={element => { audioElements.current[t.id] = element; }} className="jc-audio" controls preload="none" src={audioUrls[t.id]}
                onPlay={event => { setVoiceError(null); prepareAudio(event.currentTarget); }}
                onPlaying={event => { if (player.current === event.currentTarget) setSpeaking(true); }}
                onWaiting={event => { if (player.current === event.currentTarget) setSpeaking(false); }}
                onStalled={event => { if (player.current === event.currentTarget) setSpeaking(false); }}
                onPause={event => { if (player.current === event.currentTarget) setSpeaking(false); }}
                onEnded={event => { if (player.current === event.currentTarget) { player.current = null; setSpeaking(false); } }}
                onError={event => { if (player.current === event.currentTarget) { setSpeaking(false); setVoiceError("Audio playback failed. The existing preview can be retried without generating it again."); } }}
              >Your browser does not support audio playback.</audio>}
            </div>}
          </article>)}
          {busy && <div className="jc-processing"><span /><span /><span /><p>Processing your command</p></div>}
        </div>
      </div>}

      <form className="jc-dock" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <button type="button" onClick={toggleMic} disabled={!Recognition || busy || voiceBusy !== null} className={`jc-dock__mic${listening ? " jc-dock__mic--active" : ""}`} aria-label={micLabel} title={micLabel} aria-pressed={listening}>
          {Recognition ? <Mic size={18} strokeWidth={1.5} aria-hidden="true" /> : <MicOff size={18} strokeWidth={1.5} aria-hidden="true" />}
        </button>
        <label className="sr-only" htmlFor="atlas-command">Command for Jarvis</label>
        <input ref={commandInput} id="atlas-command" value={text} onChange={event => setText(event.target.value)} placeholder={listening ? "Listening to your microphone…" : "Ask Jarvis to do something…"} autoComplete="off" aria-keyshortcuts="Meta+K Control+K" />
        <span className="jc-dock__enter" title="Focus command input · Command/Ctrl + K" aria-hidden="true">⌘ K</span>
        <button type="submit" className="jc-dock__send" disabled={busy || !text.trim()} aria-label="Send command"><ArrowUpRight size={19} strokeWidth={1.8} aria-hidden="true" /></button>
      </form>

      <div className="jc-voice-settings">
        <span className="jc-voice-settings__provider"><span className={`jc-status-dot${cloudReady ? " jc-status-dot--ready" : " jc-status-dot--muted"}`} />{cloudReady ? `ElevenLabs${cloudVoice?.voiceName ? ` · ${cloudVoice.voiceName}` : ""}` : "Cloud voice unavailable"}</span>
        <button type="button" onClick={toggleDeviceSpeech} disabled={!ttsSupported} className={`jc-device-toggle${speak ? " jc-device-toggle--on" : ""}`} aria-pressed={speak} aria-label={ttsSupported ? (speak ? "Turn off device voice and stop reading" : "Read new replies aloud using device voice") : "Device voice is unavailable in this browser"}>
          {speak ? <Volume2 size={13} aria-hidden="true" /> : <VolumeX size={13} aria-hidden="true" />}Device voice <span>{speak ? "on" : "off"}</span>
        </button>
      </div>
      <p className="jc-command__notice">{cloudReady ? "ElevenLabs plays only when you choose. Playback sends that reply to ElevenLabs and uses credits." : "Type to get started. Device voice uses your browser; ElevenLabs needs a connected and enabled account."}</p>
      {(voiceError || interactionError) && <p role="alert" className="jc-command__error"><CircleAlert size={14} aria-hidden="true" />{voiceError ?? interactionError}</p>}
      {(!Recognition || !ttsSupported) && <p className="jc-command__notice">{!Recognition ? "Microphone dictation isn't available in this browser. " : ""}{!ttsSupported ? "Device speech isn't available in this browser." : ""}</p>}
    </section>
  );
}

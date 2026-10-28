import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowUpRight, AudioLines, Check, ChevronRight, CircleAlert, LockKeyhole, Mic, MicOff, PackageSearch, ScanSearch, Sunrise, Volume2, VolumeX } from "lucide-react";
import { api, type CommandResult } from "../api";
import { cloudVoiceStatus, makeDeviceUtterance, requestCloudVoice, setDeviceVoiceActivity, type CloudVoiceStatus } from "../voice";
import { JarvisCore, type JarvisState } from "./JarvisCore";
import { RecordedVoiceInput } from "./RecordedVoiceInput";

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
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
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

export interface CommandBarHandle { startConversation(): void; stopAll(): void; focusText(): void }
export const CommandBar = forwardRef<CommandBarHandle, { onResult?: (r: CommandResult) => void; active?: boolean; onVoiceState?: (state: string) => void }>(function CommandBar({ onResult, active = true, onVoiceState }, ref) {
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [micPending, setMicPending] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [speak, setSpeak] = useState(false);
  const [interim, setInterim] = useState("");
  const [conversation, setConversation] = useState(false);
  const [keepTalking, setKeepTalking] = useState(true);
  const [recording, setRecording] = useState(false);
  const [stopSignal, setStopSignal] = useState(0);
  const conversationOn = useRef(false);
  const keepTalkingRef = useRef(true);
  const activeRef = useRef(active);
  activeRef.current = active;
  const busyRef = useRef(false);
  const nextTurnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechResolve = useRef<((ended: boolean) => void) | null>(null);
  const speechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitRef = useRef<(raw?: string) => Promise<void>>(async () => {});
  const startMicRef = useRef<() => void>(() => {});
  const turnId = useRef(Date.now());
  const speechEpoch = useRef(0);
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
  const stateDetail = listening ? "Microphone active · pause when you have finished" : busy ? "Processing your command" : voiceBusy !== null ? "Preparing your ElevenLabs preview" : speaking ? "Speaking · microphone is paused" : voiceError || interactionError ? "See the guidance below" : micPending ? "Allow microphone access when your browser asks" : Recognition ? "Start a voice conversation, or type below" : "Open this app in Chrome or Safari for browser voice";

  useEffect(() => {
    setDeviceVoiceActivity("command-bar", busy || micPending || listening || speaking || recording || voiceBusy !== null);
    onVoiceState?.(recording ? "Recording" : micPending ? "Microphone permission" : coreState === "listening" ? "Listening" : coreState === "working" ? "Thinking" : coreState === "speaking" ? "Speaking" : conversation ? "Conversation ready" : "Ready");
  }, [busy, micPending, listening, speaking, voiceBusy, recording, conversation, coreState, onVoiceState]);

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
      conversationOn.current = false;
      if (nextTurnTimer.current) clearTimeout(nextTurnTimer.current);
      if (micTimer.current) clearTimeout(micTimer.current);
      if (speechTimer.current) clearTimeout(speechTimer.current);
      speechResolve.current?.(false); speechResolve.current = null;
      if (utterance.current) { utterance.current = null; window.speechSynthesis?.cancel(); }
      setDeviceVoiceActivity("command-bar", false);
      for (const url of generatedAudio.current) URL.revokeObjectURL(url);
    };
  }, []);

  const stopMic = () => {
    if (micTimer.current) { clearTimeout(micTimer.current); micTimer.current = null; }
    const recognition = recRef.current;
    recRef.current = null;
    if (recognition) { recognition.onstart = recognition.onend = recognition.onerror = recognition.onresult = null; try { recognition.abort ? recognition.abort() : recognition.stop(); } catch { /* Already stopped. */ } }
    setListening(false);
    setMicPending(false);
    setInterim("");
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!activeRef.current) return;
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
    if (speechTimer.current) { clearTimeout(speechTimer.current); speechTimer.current = null; }
    speechResolve.current?.(false); speechResolve.current = null;
    player.current?.pause();
    player.current = null;
    utterance.current = null;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  };

  const prepareAudio = (audio: HTMLAudioElement) => {
    setDeviceVoiceActivity("command-bar", true);
    endConversation();
    speechEpoch.current++;
    stopMic();
    if (player.current && player.current !== audio) player.current.pause();
    player.current = null;
    stopPlayback();
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
    endConversation();
    const epoch = ++speechEpoch.current;
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
      if (epoch === speechEpoch.current && activeRef.current) pendingPlaybackTurn.current = turn.id;
      setAudioUrls(current => ({ ...current, [turn.id]: url }));
      setVoiceRecoveryTurn(null);
    } catch (error) {
      if (!mounted.current) return;
      setVoiceError(error instanceof Error ? error.message : "Voice playback failed. Recover the existing preview before generating another.");
      setVoiceRecoveryTurn(turn.id);
    } finally { voiceInFlight.current = false; if (mounted.current) setVoiceBusy(null); }
  };

  const endConversation = () => {
    conversationOn.current = false; setConversation(false);
    if (nextTurnTimer.current) { clearTimeout(nextTurnTimer.current); nextTurnTimer.current = null; }
  };
  const stopAll = () => {
    speechEpoch.current++;
    pendingPlaybackTurn.current = null;
    endConversation(); stopMic(); stopPlayback(); setRecording(false); setStopSignal(n => n + 1);
    setDeviceVoiceActivity("command-bar", false);
  };
  const say = (t: string): Promise<boolean> => {
    if (!deviceSpeechEnabled.current || !ttsSupported || !activeRef.current) return Promise.resolve(false);
    stopMic(); stopPlayback();
    setDeviceVoiceActivity("command-bar", true);
    return new Promise(resolve => {
      let done = false;
      const finish = (ended: boolean) => {
        if (done) return; done = true;
        if (speechTimer.current) { clearTimeout(speechTimer.current); speechTimer.current = null; }
        if (utterance.current === u) { utterance.current = null; setSpeaking(false); }
        if (speechResolve.current === finish) speechResolve.current = null;
        resolve(ended);
      };
      let u: SpeechSynthesisUtterance;
      try {
        u = makeDeviceUtterance(t); utterance.current = u; speechResolve.current = finish;
        u.onstart = () => {
          if (utterance.current !== u || !activeRef.current) return;
          if (speechTimer.current) clearTimeout(speechTimer.current);
          setSpeaking(true);
          speechTimer.current = setTimeout(() => { if (utterance.current === u) { window.speechSynthesis.cancel(); finish(false); endConversation(); } }, 180_000);
        };
        u.onend = () => { if (utterance.current === u) finish(true); };
        u.onerror = () => {
          if (utterance.current !== u) return;
          finish(false); endConversation();
          if (activeRef.current) setVoiceError("Your browser paused spoken replies. Choose Read reply aloud below, then Start voice conversation to continue.");
        };
        speechTimer.current = setTimeout(() => {
          if (utterance.current !== u) return;
          window.speechSynthesis.cancel(); finish(false); endConversation();
          if (activeRef.current) setVoiceError("Your browser needs a tap to play speech. Choose Read reply aloud below; no new command or paid voice is needed.");
        }, 2500);
        window.speechSynthesis.speak(u);
      } catch { finish(false); endConversation(); setVoiceError("Device speech could not start. Your reply is available below."); }
    });
  };
  const listenForNextTurn = () => {
    if (!conversationOn.current || !keepTalkingRef.current || !activeRef.current || document.visibilityState !== "visible") { endConversation(); return; }
    nextTurnTimer.current = setTimeout(() => {
      nextTurnTimer.current = null;
      if (conversationOn.current && activeRef.current && !busyRef.current && document.visibilityState === "visible") startMicRef.current();
    }, 450);
  };
  const submit = async (raw?: string) => {
    const q = (raw ?? text).trim();
    if (!q || !activeRef.current) return;
    if (/^(?:(?:(?:hey|ok|okay)\s+)?(?:jarvis|atlas)[,.]?\s*)?(?:please\s+)?(?:stop listening|stop talking|end(?: the)? conversation|cancel(?: the)? voice conversation|stop(?: the)? voice conversation)(?:\s+please)?[.!?]*$/i.test(q)) {
      stopAll(); setText(""); setInteractionError(null); setVoiceError(null);
      setTurns(current => [...current, { id: ++turnId.current, role: "owner", text: q }, { id: ++turnId.current, role: "atlas", text: "Voice conversation ended. Your microphone is off.", outcome: "completed" }]);
      return;
    }
    if (busyRef.current) return;
    const repeating = /^(?:(?:hey\s+)?(?:jarvis|atlas)[,.]?\s*)?(?:repeat(?: that)?|say that again)[.!?]?$/i.test(q);
    if (repeating) {
      const last = [...turns].reverse().find(turn => turn.role === "atlas");
      if (last) { const ended = await say(last.text); if (ended) listenForNextTurn(); return; }
    }
    busyRef.current = true;
    const epoch = speechEpoch.current;
    setDeviceVoiceActivity("command-bar", true);
    stopMic(); stopPlayback(); setInteractionError(null); setVoiceError(null); setText(""); setBusy(true);
    const id = ++turnId.current;
    setTurns(t => [...t, { id, role: "owner", text: q }]);
    let successfulSpeech = false;
    try {
      const r = await api.command(q);
      if (!mounted.current) return;
      setTurns(t => [...t, { id: ++turnId.current, role: "atlas", text: r.reply, outcome: r.outcome, approvalId: r.approvalId }]);
      if (r.outcome === "failed" || r.outcome === "denied") setInteractionError("The command needs attention. See Jarvis's response below.");
      onResult?.(r);
      setBusy(false);
      if (epoch === speechEpoch.current && activeRef.current) successfulSpeech = await say(r.reply);
    } catch (e) {
      if (!mounted.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setTurns(t => [...t, { id: ++turnId.current, role: "atlas", text: `I couldn't reach the Atlas API: ${msg}`, outcome: "failed" }]);
      setInteractionError("I couldn't complete that command. Check the response and try again."); endConversation();
    } finally {
      busyRef.current = false;
      if (mounted.current) { setBusy(false); if (successfulSpeech) listenForNextTurn(); else endConversation(); }
    }
  };
  submitRef.current = submit;

  const startMic = () => {
    if (!Recognition || busyRef.current || voiceInFlight.current || !activeRef.current || document.visibilityState === "hidden") return;
    setDeviceVoiceActivity("command-bar", true); stopMic(); stopPlayback(); setInteractionError(null); setVoiceError(null);
    let rec: SpeechRecognitionLike;
    try { rec = new Recognition(); }
    catch { endConversation(); setInteractionError("This browser couldn't initialise speech recognition. Open Jarvis in Chrome or Safari, or use recorded voice below."); return; }
    rec.lang = "en-AU"; rec.interimResults = true; rec.continuous = false;
    let finalText = "";
    rec.onstart = () => {
      if (recRef.current !== rec) { try { rec.abort ? rec.abort() : rec.stop(); } catch { /* Stale recogniser. */ } return; }
      setMicPending(false); setListening(true);
      micTimer.current = setTimeout(() => { if (recRef.current === rec) { try { rec.stop(); } catch { stopAll(); } } }, 30_000);
    };
    rec.onresult = ev => {
      if (recRef.current !== rec) return;
      const final: string[] = [], pending: string[] = [];
      for (let i = 0; i < ev.results.length; i++) {
        const result = ev.results[i], fragment = result?.[0]?.transcript?.trim();
        if (!fragment) continue;
        (result?.isFinal === false ? pending : final).push(fragment);
      }
      finalText = final.join(" "); setInterim([...final, ...pending].join(" "));
    };
    rec.onend = () => {
      if (recRef.current !== rec) return;
      recRef.current = null; if (micTimer.current) clearTimeout(micTimer.current);
      setListening(false); setMicPending(false); setInterim("");
      if (finalText.trim()) void submitRef.current(finalText);
      else { endConversation(); setInteractionError("I didn't catch any speech. Choose Start voice conversation and try again. Your microphone is off."); }
    };
    rec.onerror = event => {
      if (recRef.current !== rec) return;
      stopMic(); endConversation();
      const code = event.error;
      setInteractionError(code === "not-allowed" || code === "service-not-allowed" ? "Microphone access was denied. In Chrome or Safari, allow Microphone for this website. On your Mac, also check System Settings → Privacy & Security → Microphone for your browser. Then try Start voice conversation again."
        : code === "audio-capture" ? "No microphone was available. Connect a microphone and check macOS System Settings → Sound → Input, then try again."
        : code === "network" ? "Your browser's speech service could not connect. Check your internet connection, or use recorded voice below. No command was submitted."
        : code === "no-speech" ? "No speech was heard. Your microphone is off; choose Start voice conversation to try again."
        : code === "language-not-supported" ? "Your browser could not use Australian English speech recognition. Try Chrome or Safari, or use recorded voice below."
        : "Speech recognition stopped. Your microphone is off; choose Start voice conversation to try again.");
    };
    recRef.current = rec; setMicPending(true);
    try { rec.start(); }
    catch { stopMic(); endConversation(); setInteractionError("Your browser couldn't start voice input. Allow this site's microphone, or open Jarvis directly in Chrome or Safari."); }
  };
  startMicRef.current = startMic;
  const startConversation = () => {
    if (!Recognition) { setInteractionError("Browser voice isn't available here. Open Jarvis directly in Chrome or Safari on your Mac, or use the recorded voice option below. You can also use your keyboard's dictation microphone in the text field."); commandInput.current?.focus(); return; }
    if (busyRef.current || voiceInFlight.current) return;
    conversationOn.current = true; setConversation(true);
    deviceSpeechEnabled.current = true; setSpeak(true);
    startMic();
  };
  const toggleMic = () => { if (listening || micPending || conversation) stopAll(); else startConversation(); };
  useImperativeHandle(ref, () => ({ startConversation, stopAll, focusText: () => commandInput.current?.focus() }));
  useEffect(() => { if (!active) stopAll(); }, [active]);
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === "hidden") stopAll(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") stopAll(); };
    document.addEventListener("visibilitychange", hidden); window.addEventListener("pagehide", stopAll); window.addEventListener("keydown", escape);
    return () => { document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", stopAll); window.removeEventListener("keydown", escape); };
  }, []);

  const toggleDeviceSpeech = () => {
    const next = !deviceSpeechEnabled.current;
    deviceSpeechEnabled.current = next;
    if (!next) { speechEpoch.current++; endConversation(); stopMic(); stopPlayback(); }
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
          <strong>{ttsSupported ? "Device voice" : "Text replies"}</strong>
          <span className="jc-readout-line" />
          <small>{ttsSupported ? "Automatic replies" : "Always visible"}</small>
        </div>
      </div>
      <div className="jc-command__state" role="status" aria-live="polite">
        <h3>{stateHeading}</h3>
        <p>{stateDetail}</p>
      </div>

      <div className="jc-conversation-controls">
        <button type="button" className={`jc-start-voice${conversation ? " is-active" : ""}`} onClick={conversation || listening || micPending ? stopAll : startConversation} disabled={!(conversation || listening || micPending) && (busy || voiceBusy !== null || recording)}>
          {conversation || listening || micPending ? <MicOff size={19} aria-hidden /> : <Mic size={19} aria-hidden />}
          {conversation || listening || micPending ? "Stop voice conversation" : "Start voice conversation"}
        </button>
        {(speaking || recording || busy || voiceBusy !== null) && <button type="button" className="jc-stop-all" onClick={stopAll}>Stop all audio</button>}
        <label className="jc-keep-talking"><input type="checkbox" checked={keepTalking} onChange={event => { keepTalkingRef.current = event.target.checked; setKeepTalking(event.target.checked); if (!event.target.checked && nextTurnTimer.current) { clearTimeout(nextTurnTimer.current); nextTurnTimer.current = null; endConversation(); } }} />Keep the conversation going after each spoken reply</label>
        <p className="jc-conversation-explainer">Speak, pause, then hear Jarvis reply. Your microphone pauses while Jarvis speaks. Start only listens while this app is open.</p>
      </div>
      {interim && <div className="jc-transcript" role="status" aria-label="Live speech transcript"><span>Hearing you</span><p>{interim}</p></div>}

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
            {t.role === "atlas" && ttsSupported && <button type="button" className="jc-voice-action jc-local-replay" disabled={busy || voiceBusy !== null} onClick={() => { endConversation(); deviceSpeechEnabled.current = true; setSpeak(true); setVoiceError(null); void say(t.text); }}><Volume2 size={13} aria-hidden />Read reply aloud</button>}
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
        <button type="button" onClick={toggleMic} disabled={busy || voiceBusy !== null || recording} className={`jc-dock__mic${listening ? " jc-dock__mic--active" : ""}`} aria-label={micLabel} title={micLabel} aria-pressed={listening}>
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
      <p className="jc-command__notice">Browser voice input and device spoken replies make no ElevenLabs or AI request for audio. Your browser may use its own online speech service. ElevenLabs playback uses credits only when you choose its button.</p>
      {(voiceError || interactionError) && <p role="alert" className="jc-command__error"><CircleAlert size={14} aria-hidden="true" />{voiceError ?? interactionError}</p>}
      {!Recognition && <div className="jc-browser-help"><strong>Use Chrome or Safari on your Mac.</strong><p>Open this Jarvis address directly in the browser. If voice is unavailable, click the text field and use macOS Dictation, or choose recorded voice below.</p></div>}
      {!ttsSupported && <p className="jc-command__notice">Device speech isn't available in this browser. Replies remain visible in your conversation.</p>}
      <details className="jc-recorded-alternative"><summary>Recorded voice alternative · ElevenLabs credits</summary><RecordedVoiceInput disabled={busy || listening || micPending || voiceBusy !== null || !active} stopSignal={stopSignal} onRecordingChange={value => { setRecording(value); if (value) { endConversation(); stopMic(); stopPlayback(); } }} onTranscript={value => { setText(value); setInteractionError(null); setVoiceError(null); deviceSpeechEnabled.current = true; setSpeak(true); commandInput.current?.focus(); }} /></details>
    </section>
  );
});

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, Volume2, VolumeX } from "lucide-react";
import { api, type CommandResult } from "../api";

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
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: unknown) => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognition(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function CommandBar({ onResult }: { onResult?: (r: CommandResult) => void }) {
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const Recognition = getRecognition();
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const say = (t: string) => {
    if (!speak || !ttsSupported) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(t);
      u.lang = "en-AU";
      u.rate = 1.02;
      window.speechSynthesis.speak(u);
    } catch {
      /* unsupported voice; ignore */
    }
  };

  const submit = async (raw?: string) => {
    const q = (raw ?? text).trim();
    if (!q || busy) return;
    setText("");
    setBusy(true);
    const id = Date.now();
    setTurns((t) => [...t, { id, role: "owner", text: q }]);
    try {
      const r = await api.command(q);
      setTurns((t) => [...t, { id: id + 1, role: "atlas", text: r.reply, outcome: r.outcome, approvalId: r.approvalId }]);
      say(r.reply);
      onResult?.(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTurns((t) => [...t, { id: id + 1, role: "atlas", text: `I couldn't reach the Atlas API: ${msg}`, outcome: "failed" }]);
    } finally {
      setBusy(false);
    }
  };

  const toggleMic = () => {
    if (!Recognition) return;
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new Recognition();
    rec.lang = "en-AU";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (ev) => {
      const transcript = Array.from({ length: ev.results.length }, (_, i) => ev.results[i]?.[0]?.transcript ?? "").join(" ").trim();
      if (transcript) void submit(transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  const outcomeTone = (o?: string) =>
    o === "awaiting_approval" ? "text-warn-soft" : o === "denied" || o === "failed" ? "text-danger-soft" : o === "simulated" ? "text-fuchsia-200" : "text-slate-400";

  return (
    <div className="flex flex-col gap-3">
      <div ref={listRef} className="max-h-72 space-y-2 overflow-y-auto pr-1" aria-live="polite">
        {turns.length === 0 && (
          <p className="text-sm text-slate-400">
            Ask Atlas anything. Try <button type="button" className="text-accent-soft underline-offset-2 hover:underline" onClick={() => void submit("Give me my morning briefing")}>“Give me my morning briefing”</button> or{" "}
            <button type="button" className="text-accent-soft underline-offset-2 hover:underline" onClick={() => void submit("What orders have come through BoxSafe?")}>“What orders have come through BoxSafe?”</button>
          </p>
        )}
        {turns.map((t) => (
          <div key={t.id} className={`flex ${t.role === "owner" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${t.role === "owner" ? "bg-accent/15 text-slate-100" : "border border-white/10 bg-white/5 text-slate-200"}`}>
              {t.text}
              {t.role === "atlas" && t.outcome && (
                <div className={`mt-1 text-[10px] uppercase tracking-wider ${outcomeTone(t.outcome)}`}>
                  {t.outcome.replace("_", " ")}{t.approvalId ? " · see Approvals" : ""}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="text-xs text-slate-400">Atlas is working…</div>}
      </div>
      <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <button type="button" onClick={toggleMic} disabled={!Recognition} className={`btn-ghost !px-2.5 ${listening ? "border-accent/60 text-accent-soft shadow-glow" : ""}`}
          aria-label={Recognition ? (listening ? "Stop listening" : "Dictate a command") : "Voice dictation not supported in this browser"}
          title={Recognition ? (listening ? "Stop listening" : "Dictate") : "Voice dictation not supported in this browser"}>
          {Recognition ? <Mic className="h-4 w-4" aria-hidden /> : <MicOff className="h-4 w-4" aria-hidden />}
        </button>
        <label className="sr-only" htmlFor="atlas-command">Command for Atlas</label>
        <input id="atlas-command" className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={listening ? "Listening…" : "Hey Atlas…"} autoComplete="off" />
        <button type="button" onClick={() => setSpeak((s) => !s)} disabled={!ttsSupported} className={`btn-ghost !px-2.5 ${speak ? "border-accent/60 text-accent-soft" : ""}`}
          aria-pressed={speak} aria-label={ttsSupported ? (speak ? "Stop reading replies aloud" : "Read replies aloud") : "Speech output not supported in this browser"} title={ttsSupported ? "Read replies aloud" : "Speech output not supported"}>
          {speak ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
        </button>
        <button type="submit" className="btn-accent !px-3" disabled={busy || !text.trim()} aria-label="Send command">
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </form>
      {(!Recognition || !ttsSupported) && (
        <p className="text-[11px] text-slate-500">
          {!Recognition ? "Voice dictation is not available in this browser. " : ""}
          {!ttsSupported ? "Spoken replies are not available in this browser." : ""}
        </p>
      )}
    </div>
  );
}

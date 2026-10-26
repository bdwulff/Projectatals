import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Maximize2, Mic, MicOff, X } from "lucide-react";
import { CommandBar, type CommandBarHandle } from "./CommandBar";
import { JarvisCore } from "./JarvisCore";
import "./voice-conversation.css";

const OPEN_EVENT = "jarvis:open-conversation";
export function openVoiceConversation(start = true): void { window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { start } })); }

/** One authenticated conversation instance survives navigation between business screens. */
export function VoiceConversation({ onResult }: { onResult: () => void }) {
  const [open, setOpen] = useState(() => window.location.hash === "#talk");
  const [state, setState] = useState("Ready");
  const controller = useRef<CommandBarHandle>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const openRef = useRef(open); openRef.current = open;
  const show = (start: boolean) => {
    if (!openRef.current) previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openRef.current = true; flushSync(() => setOpen(true));
    // Keep microphone permission within the explicit, trusted button gesture.
    if (start) controller.current?.startConversation();
  };
  const close = () => { controller.current?.stopAll(); openRef.current = false; setOpen(false); previousFocus.current?.focus(); };
  useEffect(() => {
    const requested = (event: Event) => show((event as CustomEvent<{ start?: boolean }>).detail?.start !== false);
    const hashChanged = () => { if (window.location.hash === "#talk") show(false); };
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement && target.id !== "atlas-command")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !event.altKey) { event.preventDefault(); show(false); window.setTimeout(() => controller.current?.focusText(), 0); }
    };
    window.addEventListener(OPEN_EVENT, requested); window.addEventListener("hashchange", hashChanged); window.addEventListener("keydown", shortcut);
    return () => { window.removeEventListener(OPEN_EVENT, requested); window.removeEventListener("hashchange", hashChanged); window.removeEventListener("keydown", shortcut); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const old = document.body.style.overflow; document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],summary,[tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { document.body.style.overflow = old; document.removeEventListener("keydown", trap); };
  }, [open]);
  return <>
    <button type="button" className="jarvis-talk-launcher" onClick={() => show(true)} aria-label="Talk to Jarvis" aria-haspopup="dialog" aria-expanded={open}><span className="jarvis-talk-launcher__icon"><Mic size={20} aria-hidden /></span><span><strong>Talk to Jarvis</strong><small>{state === "Ready" ? "Voice conversation" : state}</small></span><Maximize2 size={13} aria-hidden /></button>
    <div className="jarvis-voice-overlay" hidden={!open} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-label="Talk to Jarvis" tabIndex={-1} className="jarvis-voice-dialog">
        <header className="jarvis-voice-dialog__header"><div><Mic size={16} aria-hidden /><span>Talk to Jarvis</span><small>Voice + text</small></div><button type="button" onClick={close} aria-label="Close voice conversation"><X size={20} aria-hidden /></button></header>
        <div className="jarvis-voice-dialog__body"><CommandBar ref={controller} active={open} onResult={onResult} onVoiceState={setState} /></div>
        <footer className="jarvis-voice-dialog__footer"><MicOff size={12} aria-hidden />Closing or switching away from this app stops listening. Your conversation stays here as you move between screens.</footer>
      </div>
    </div>
  </>;
}

export function VoiceInvitation() {
  return <section className="jarvis-voice-invitation" aria-label="Speak with Jarvis"><div className="hud-eyebrow">YOUR PERSONAL ASSISTANT</div><JarvisCore state="idle" /><h2>Let’s talk, Brandon.</h2><p>Speak naturally, pause, and hear your reply. Ask for your briefing, find businesses or look something up.</p><button type="button" onClick={() => openVoiceConversation(true)}><Mic size={19} aria-hidden />Talk to Jarvis</button><button type="button" className="jarvis-voice-invitation__text" onClick={() => openVoiceConversation(false)}>Type a message instead</button><small>Free browser voice · microphone permission needed</small></section>;
}

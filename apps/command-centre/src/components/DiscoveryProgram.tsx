import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Braces, Check, CheckCheck, ChevronDown, CircleAlert, Clock3, Globe2, Image, Loader2, Mail, MapPin, Pause, Play, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Square, Volume2 } from "lucide-react";
import { discoveryProgram, type DiscoveryProgramReport, type DiscoveryProgramSettings, type DiscoveryProgramSnapshot } from "../discovery-program-client";
import { DEVICE_VOICE_ACTIVITY_EVENT, deviceMediaBusy, deviceVoiceActivityActive, deviceVoiceBusy } from "../voice";
import { makeDiscoveryReportUtterance, markDiscoveryReportSpoken } from "../discovery-report-voice";
import "./discovery-program.css";

const DEFAULTS: DiscoveryProgramSettings = { enabled: false, area: "Officer, Berwick, Pakenham, Cranbourne, Dandenong, Victoria", industry: "", count: 3, templateId: "immersive", companyName: "Wulff Digital", companyWebsite: "https://wulffdigital.com", timeZone: "Australia/Melbourne" };
const RUNNING = new Set(["queued", "running"]);
const REPORT_LABELS: Record<DiscoveryProgramReport["state"], string> = { queued: "Queued", running: "Building your shortlist", completed: "Ready for your review", partial: "Ready with a few gaps", failed: "Needs attention", skipped: "Run skipped", already_ran: "Today's work is already ready" };
function dateLabel(value: string): string { const d = new Date(value); return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" }).format(d) : "—"; }
function companyHost(value: string): string { try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return "Your company website"; } }

/** Private research and code preparation. Speech uses the device, never the paid voice route. */
export function DiscoveryProgram({ onReportChanged, onSelectLead }: { onReportChanged?: () => void; onSelectLead?: (id: string) => void }) {
  const [snapshot, setSnapshot] = useState<DiscoveryProgramSnapshot | null>(null);
  const [form, setForm] = useState<DiscoveryProgramSettings>(DEFAULTS);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const mounted = useRef(true), mutating = useRef(false), polling = useRef(false), dirtyRef = useRef(false), serial = useRef(0);
  const lastReport = useRef<string | null>(null), reportLoaded = useRef(false), reportCallback = useRef(onReportChanged), currentSpeech = useRef<SpeechSynthesisUtterance | null>(null), speechDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  reportCallback.current = onReportChanged;
  const supported = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

  const apply = useCallback((value: DiscoveryProgramSnapshot) => {
    setSnapshot(value);
    if (!dirtyRef.current) setForm(value.settings);
    const key = value.latestReport ? `${value.latestReport.id}:${value.latestReport.state}:${value.latestReport.finishedAt ?? ""}` : null;
    if (reportLoaded.current && key !== lastReport.current) reportCallback.current?.();
    reportLoaded.current = true;
    lastReport.current = key;
  }, []);
  const load = useCallback(async () => {
    if (mutating.current || polling.current || document.visibilityState === "hidden") return;
    polling.current = true;
    const version = serial.current;
    try { const result = await discoveryProgram.snapshot(); if (mounted.current && version === serial.current) { apply(result); setError(null); } }
    catch (e) { if (mounted.current && version === serial.current) setError(e instanceof Error ? e.message : "The program status could not be checked."); }
    finally { polling.current = false; if (mounted.current && version === serial.current) setLoading(false); }
  }, [apply]);
  useEffect(() => {
    mounted.current = true; void load();
    const timer = window.setInterval(() => { void load(); }, 5000);
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { mounted.current = false; serial.current++; window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [load]);

  const stopSpeech = useCallback(() => {
    if (speechDeadline.current !== null) { clearTimeout(speechDeadline.current); speechDeadline.current = null; }
    const utterance = currentSpeech.current;
    if (utterance) { currentSpeech.current = null; utterance.onstart = utterance.onend = utterance.onerror = null; window.speechSynthesis.cancel(); }
    if (mounted.current) setSpeaking(false);
  }, []);
  useEffect(() => {
    const prioritise = () => { if (currentSpeech.current && (deviceVoiceActivityActive() || deviceMediaBusy())) stopSpeech(); };
    const hidden = () => { if (document.visibilityState === "hidden") stopSpeech(); };
    window.addEventListener(DEVICE_VOICE_ACTIVITY_EVENT, prioritise);
    document.addEventListener("visibilitychange", hidden);
    document.addEventListener("play", prioritise, true);
    return () => { stopSpeech(); window.removeEventListener(DEVICE_VOICE_ACTIVITY_EVENT, prioritise); document.removeEventListener("visibilitychange", hidden); document.removeEventListener("play", prioritise, true); };
  }, [stopSpeech]);
  const speak = () => {
    const report = snapshot?.latestReport;
    if (!supported || !report?.spokenSummary || RUNNING.has(report.state)) return;
    if (deviceVoiceBusy()) { setNotice("Finish your current voice conversation or audio, then choose Read report aloud."); return; }
    setNotice(null);
    try {
      const utterance = makeDiscoveryReportUtterance(report);
      if (!utterance) { setNotice("Install an English device voice in your Mac or phone speech settings, then try again. Jarvis only uses an installed voice for this report."); return; }
      currentSpeech.current = utterance; setSpeaking(true);
      utterance.onstart = () => { if (currentSpeech.current !== utterance) return; markDiscoveryReportSpoken(report.id); if (speechDeadline.current !== null) clearTimeout(speechDeadline.current); speechDeadline.current = null; };
      utterance.onend = () => { if (currentSpeech.current === utterance) { currentSpeech.current = null; if (mounted.current) setSpeaking(false); } };
      utterance.onerror = () => { if (currentSpeech.current === utterance) { stopSpeech(); if (mounted.current) setNotice("Your browser could not speak this report. The full report is available below."); } };
      speechDeadline.current = setTimeout(() => { if (currentSpeech.current === utterance) { stopSpeech(); if (mounted.current) setNotice("Your browser needs permission to play device speech. Try Read report aloud again."); } }, 2500);
      window.speechSynthesis.speak(utterance);
    } catch { stopSpeech(); setNotice("Device speech is unavailable. Read the report below."); }
  };
  const change = <K extends keyof DiscoveryProgramSettings>(key: K, value: DiscoveryProgramSettings[K]) => { dirtyRef.current = true; setDirty(true); setForm(current => ({ ...current, [key]: value })); };
  const mutate = async (label: string, action: () => Promise<DiscoveryProgramSnapshot>, message: string, saved = false) => {
    if (mutating.current) return;
    mutating.current = true; serial.current++; setBusy(label); setError(null); setNotice(null);
    try {
      const result = await action();
      if (!mounted.current) return;
      if (saved) { dirtyRef.current = false; setDirty(false); }
      apply(result); setNotice(message);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "The program could not be updated."); }
    finally { mutating.current = false; if (mounted.current) { setBusy(null); setLoading(false); } }
  };
  const save = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void mutate("save", () => discoveryProgram.settings(form), "Program settings saved. Research prepares private concepts and email drafts only.", true); };
  const toggle = () => { if (!snapshot || dirty) return; void mutate("toggle", () => discoveryProgram.settings({ ...snapshot.settings, enabled: !snapshot.settings.enabled }), snapshot.settings.enabled ? "Daily discovery paused. Existing private concepts and drafts remain available." : "Daily discovery enabled. Jarvis will prepare a shortlist once per Melbourne day.", true); };
  const report = snapshot?.latestReport;
  const running = Boolean(snapshot && RUNNING.has(snapshot.run.state));
  const runDisabled = !snapshot || !snapshot.configured || dirty || Boolean(busy) || running || snapshot.availability.state === "not_connected" || snapshot.availability.state === "error";
  const downloadReport = () => {
    if (!report) return;
    const blob = new Blob([`${report.fixture ? "Fictional test report\n\n" : ""}${report.spokenSummary}\n\n${report.businesses.map(business => `${business.name} — ${business.location}\nConcept: ${business.demoReady ? "prepared" : "not prepared"}; email draft: ${business.draftReady ? "prepared" : "not prepared"}; logo: ${business.logoIncluded ? "included" : "not found"}; photos: ${business.photoCount}`).join("\n\n")}\n\n${report.errors.join("\n")}\n\nNo email was sent by this program.\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `wulff-digital-discovery-${report.day}.txt`; link.click(); URL.revokeObjectURL(url);
  };

  return <section className="dp-program" aria-labelledby="discovery-program-heading" id="discovery-program">
    <div className="dp-topline"><span><span className={`dp-status-dot${snapshot?.settings.enabled ? " is-on" : ""}`} />WULFF DIGITAL / DISCOVERY PROGRAM</span><span className="dp-credit-label"><Braces size={12} aria-hidden />Built from code</span></div>
    <div className="dp-intro"><div><p className="dp-domain"><Globe2 size={12} aria-hidden />{companyHost(snapshot?.settings.companyWebsite ?? DEFAULTS.companyWebsite)}</p><h2 id="discovery-program-heading">A little initiative.<br /><span>A considered first impression.</span></h2><p>Jarvis finds businesses, builds a private website concept around their branding, and drafts an introduction for you to send.</p></div><div className="dp-orbit" aria-hidden><div className="dp-orbit-ring" /><div className="dp-orbit-ring dp-orbit-ring--inner" /><div className="dp-orbit-centre"><Sparkles size={25} strokeWidth={1} /></div><span className="dp-orbit-point dp-orbit-point--one"><Search size={13} /></span><span className="dp-orbit-point dp-orbit-point--two"><Braces size={13} /></span><span className="dp-orbit-point dp-orbit-point--three"><Mail size={13} /></span></div></div>
    <div className="dp-method" aria-label="Program workflow"><span><Search size={13} aria-hidden />Discover<span>01</span></span><ArrowRight size={11} aria-hidden /><span><Image size={13} aria-hidden />Source branding<span>02</span></span><ArrowRight size={11} aria-hidden /><span><Braces size={13} aria-hidden />Build concept<span>03</span></span><ArrowRight size={11} aria-hidden /><span><Mail size={13} aria-hidden />Draft email<span>04</span></span></div>
    {error && <p className="dp-message dp-message--error" role="alert"><CircleAlert size={15} aria-hidden /><span>{error}</span></p>}
    {notice && <p className="dp-message" role="status"><CheckCheck size={15} aria-hidden /><span>{notice}</span></p>}
    {snapshot?.mode === "fake" && <p className="dp-message dp-message--warning"><CircleAlert size={15} aria-hidden />Fictional test mode. These runs and businesses are simulated; no real provider is contacted.</p>}
    <div className="dp-control"><div className="dp-control-copy"><strong>{loading && !snapshot ? "Checking program…" : snapshot?.settings.enabled ? "Daily discovery is on" : "Daily discovery is paused"}</strong><p><Clock3 size={12} aria-hidden />{snapshot?.settings.count ?? 3} businesses per Melbourne day · {snapshot?.settings.area ?? "South-east Melbourne"}</p></div><div className="dp-control-actions"><button type="button" className="dp-button dp-button--quiet" onClick={toggle} disabled={!snapshot || Boolean(busy) || dirty}>{busy === "toggle" ? <Loader2 size={13} className="dp-spinner" aria-hidden /> : snapshot?.settings.enabled ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}{snapshot?.settings.enabled ? "Pause daily run" : "Enable daily run"}</button><button type="button" className="dp-button dp-button--primary" onClick={() => void mutate("run", () => discoveryProgram.run(), "Run requested. Jarvis will update this report as the private preparation finishes.")} disabled={runDisabled}>{busy === "run" || running ? <Loader2 size={14} className="dp-spinner" aria-hidden /> : <Play size={14} aria-hidden />}{running ? "Preparing shortlist…" : "Run now"}</button></div></div>
    {dirty && <p className="dp-save-reminder"><Settings2 size={12} aria-hidden />Save your edited settings before running or changing the daily schedule.</p>}
    {snapshot && <p className="dp-availability"><ShieldCheck size={12} aria-hidden /><span>{snapshot.run.state !== "idle" ? snapshot.run.detail : snapshot.availability.detail}</span></p>}
    <details className="dp-settings"><summary><span><Settings2 size={13} aria-hidden />Program settings<span className="dp-settings-sub">{form.templateId === "immersive" ? "Immersive design · Individual art direction" : "Clarity design · Apple-inspired restraint"}</span></span><ChevronDown size={14} aria-hidden /></summary><form onSubmit={save} className="dp-settings-form"><div className="dp-form-grid"><label className="dp-field dp-field--wide">Find businesses in<input value={form.area} maxLength={160} required onChange={event => change("area", event.target.value)} disabled={Boolean(busy)} placeholder="Officer, Berwick, Pakenham" /></label><label className="dp-field">Business type<input value={form.industry} maxLength={100} onChange={event => change("industry", event.target.value)} disabled={Boolean(busy)} placeholder="Any local business, or e.g. trades" /></label><label className="dp-field">Businesses per day<select aria-label="Businesses per day" value={form.count} onChange={event => change("count", Number(event.target.value))} disabled={Boolean(busy)}>{[1, 2, 3, 4, 5].map(count => <option key={count} value={count}>{count}</option>)}</select></label><label className="dp-field dp-field--wide">Design direction<select aria-label="Design direction" value={form.templateId} onChange={event => change("templateId", event.target.value as DiscoveryProgramSettings["templateId"])} disabled={Boolean(busy)}><option value="immersive">Immersive · Business-specific art direction</option><option value="clarity">Clarity · Apple-inspired restraint</option></select></label><label className="dp-field">Company name<input value={form.companyName} maxLength={160} required onChange={event => change("companyName", event.target.value)} disabled={Boolean(busy)} /></label><label className="dp-field">Company website<input value={form.companyWebsite} type="url" maxLength={2000} required onChange={event => change("companyWebsite", event.target.value)} disabled={Boolean(busy)} /></label></div><div className="dp-design-note"><span className="dp-design-swatch" aria-hidden><i /><i /><i /></span><p><strong>{form.templateId === "immersive" ? "Immersive. A direction of their own." : "Clarity. Original design, familiar restraint."}</strong>{form.templateId === "immersive" ? "Cinematic, editorial or energetic layouts selected from the business’s industry, identity and sourced imagery. Original concept artwork fills visual gaps without being presented as business photography." : "Generous space, precise typography and business photography. Apple is a visual reference; its code, imagery and branding are not copied."}</p></div><div className="dp-settings-footer"><p>One run per Melbourne day. Saving a new area does not reset the daily limit. Your website address does not create or verify an email mailbox.</p><button type="submit" className="dp-button" disabled={Boolean(busy) || (!dirty && Boolean(snapshot?.configured))}>{busy === "save" ? <Loader2 size={13} className="dp-spinner" aria-hidden /> : <Check size={13} aria-hidden />}Save program settings</button></div></form></details>
    <div className="dp-report"><div className="dp-report-heading"><div><div className="dp-overline">LATEST FIELD REPORT</div><h3>{report ? REPORT_LABELS[report.state] : "Your next shortlist starts here."}</h3>{report && <p>{dateLabel(report.finishedAt ?? report.startedAt)} · {report.trigger === "scheduled" ? "Daily run" : "Requested run"}{report.fixture ? " · Fictional test" : ""}</p>}</div><button type="button" className="dp-icon-button" aria-label="Refresh discovery program" onClick={() => void load()} disabled={loading || Boolean(busy)}><RefreshCw size={14} className={loading ? "dp-spinner" : ""} aria-hidden /></button></div>
      {report ? <><p className="dp-spoken-summary">{report.fixture && <strong>Fictional test. </strong>}{report.spokenSummary}</p>{report.reusedCount > 0 && <p className="dp-small-note">Reused {report.reusedCount} previously researched business{report.reusedCount === 1 ? "" : "es"} for this run. Existing research is not counted as a new discovery.</p>}<div className="dp-totals"><Metric count={report.foundCount} label="Newly found" /><Metric count={report.preparedCount} label="Concepts ready" /><Metric count={report.draftCount} label="Email drafts" /><Metric count={report.logoCount} label="Logos included" /><Metric count={report.photoCount} label="Business photos" /></div>{report.businesses.length > 0 && <ul className="dp-businesses" aria-label="Businesses in the latest discovery report">{report.businesses.map(business => <li key={business.leadId}><div className="dp-business-title"><span className="dp-business-initial" aria-hidden>{business.name.slice(0, 1)}</span><div><strong>{business.name}</strong><small><MapPin size={10} aria-hidden />{business.location}</small></div></div><div className="dp-business-details"><span className={business.demoReady ? "is-ready" : ""}>{business.demoReady ? "Concept ready" : "Concept unavailable"}</span><span className={business.draftReady ? "is-ready" : ""}>{business.draftReady ? "Draft ready" : "Draft unavailable"}</span><span>{business.logoIncluded ? "Logo included" : "Logo not found"} · {business.photoCount} photo{business.photoCount === 1 ? "" : "s"}{business.recipientMissing ? " · Recipient not found" : ""}</span></div><button type="button" className="dp-review-button" disabled={!onSelectLead} onClick={() => onSelectLead?.(business.leadId)} aria-label={`Review ${business.name}`}>Review<ArrowUpRight size={13} aria-hidden /></button></li>)}</ul>}{report.alreadyReadyCount > 0 && <p className="dp-small-note">{report.alreadyReadyCount} existing concept{report.alreadyReadyCount === 1 ? " was" : "s were"} already prepared.</p>}{report.errors.length > 0 && <div className="dp-report-errors"><strong><CircleAlert size={13} aria-hidden />Details to review</strong><ul>{report.errors.map((detail, index) => <li key={index}>{detail}</li>)}</ul></div>}<div className="dp-report-actions"><button type="button" className="dp-button dp-button--quiet" onClick={speaking ? stopSpeech : speak} disabled={!supported || !report.spokenSummary || RUNNING.has(report.state)}>{speaking ? <Square size={13} aria-hidden /> : <Volume2 size={14} aria-hidden />}{speaking ? "Stop report" : "Read report aloud"}</button><button type="button" className="dp-button dp-button--text" onClick={downloadReport}><ArrowDownToLine size={13} aria-hidden />Save report</button><span>Device voice · No AI credits</span></div>{!supported && <p className="dp-small-note">Speech is unavailable in this browser. The report and download remain available.</p>}</> : <div className="dp-empty-report"><span><Braces size={22} strokeWidth={1.2} aria-hidden /></span><p>Run the program to prepare private website concepts and email drafts. Your sourced business details and progress report will appear here.</p></div>}
    </div>
    <footer className="dp-footer"><div><ShieldCheck size={13} aria-hidden /><p>Private concepts. Drafts for your review.<span> This program does not publish demos or send emails.</span></p></div><p>Lovable-compatible code, built in Jarvis. No Lovable generation, AI model or ElevenLabs request. Hosting and search availability still apply.</p></footer>
  </section>;
}

function Metric({ count, label }: { count: number; label: string }) { return <div><strong>{String(count).padStart(2, "0")}</strong><span>{label}</span></div>; }

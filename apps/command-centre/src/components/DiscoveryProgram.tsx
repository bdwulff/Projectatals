import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDownToLine, Check, CheckCheck, ChevronDown, CircleAlert, Clock3, FileSpreadsheet, Globe2, Loader2, Pause, Play, RefreshCw, Search, Settings2, ShieldCheck, Square, Volume2 } from "lucide-react";
import { discoveryProgram, type DiscoveryProgramReport, type DiscoveryProgramSettings, type DiscoveryProgramSnapshot } from "../discovery-program-client";
import { DEVICE_VOICE_ACTIVITY_EVENT, deviceMediaBusy, deviceVoiceActivityActive, deviceVoiceBusy } from "../voice";
import { makeDiscoveryReportUtterance, markDiscoveryReportSpoken } from "../discovery-report-voice";
import "./discovery-program.css";
import { ProspectOutreach } from "./ProspectOutreach";

const DEFAULTS: DiscoveryProgramSettings = { enabled: false, area: "Melbourne and south-east Melbourne, Victoria", industry: "", count: 20, templateId: "simple", target: "no_website", companyName: "Wulff Digital", companyWebsite: "https://wulffdigital.com", timeZone: "Australia/Melbourne" };
const RUNNING = new Set(["queued", "running"]);
const REPORT_LABELS: Record<DiscoveryProgramReport["state"], string> = { queued: "Queued", running: "Building your shortlist", completed: "Ready for your review", partial: "Partial list · below target", failed: "Needs attention", skipped: "Run skipped", already_ran: "Today's work is already ready" };
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
  const [researchOpen, setResearchOpen] = useState(false);
  const initialSettingsRead = useRef(false);
  const mounted = useRef(true), mutating = useRef(false), polling = useRef(false), dirtyRef = useRef(false), serial = useRef(0);
  const lastReport = useRef<string | null>(null), reportLoaded = useRef(false), reportCallback = useRef(onReportChanged), currentSpeech = useRef<SpeechSynthesisUtterance | null>(null), speechDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  reportCallback.current = onReportChanged;
  const supported = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

  const apply = useCallback((value: DiscoveryProgramSnapshot) => {
    setSnapshot(value);
    if (!initialSettingsRead.current) { initialSettingsRead.current = true; setResearchOpen(current => current || !value.configured); }
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
    mutating.current = true; serial.current++; setBusy(label); setError(null); setNotice(null); setResearchOpen(true);
    try {
      const result = await action();
      if (!mounted.current) return;
      if (saved) { dirtyRef.current = false; setDirty(false); }
      apply(result); setNotice(message);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "The program could not be updated."); }
    finally { mutating.current = false; if (mounted.current) { setBusy(null); setLoading(false); } }
  };
  const save = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void mutate("save", () => discoveryProgram.settings({ ...form, target: "no_website" }), "Program settings saved. Research prepares private concepts and email drafts only.", true); };
  const toggle = () => { if (!snapshot || dirty) return; void mutate("toggle", () => discoveryProgram.settings({ ...snapshot.settings, target: "no_website", enabled: !snapshot.settings.enabled }), snapshot.settings.enabled ? "Daily discovery paused. Existing private concepts and drafts remain available." : "Daily discovery enabled. Jarvis will prepare a shortlist once per Melbourne day.", true); };
  const report = snapshot?.latestReport;
  const running = Boolean(snapshot && RUNNING.has(snapshot.run.state));
  const runDisabled = !snapshot || !snapshot.configured || dirty || Boolean(busy) || running || snapshot.availability.state === "not_connected" || snapshot.availability.state === "error";
  const downloadReport = () => {
    if (!report) return;
    const blob = new Blob([`${report.fixture ? "Fictional test report\n\n" : ""}${report.spokenSummary}\n\n${report.businesses.map(business => `${business.name} — ${business.location}\nConcept: ${business.demoReady ? "prepared" : "not prepared"}; email draft: ${business.draftReady ? "prepared" : "not prepared"}; logo: ${business.logoIncluded ? "included" : "not found"}; photos: ${business.photoCount}`).join("\n\n")}\n\n${report.errors.join("\n")}\n\nNo email was sent by this program.\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `wulff-digital-discovery-${report.day}.txt`; link.click(); URL.revokeObjectURL(url);
  };

  const requested = report?.requestedCount ?? snapshot?.settings.count ?? 20;
  const prepared = report?.preparedCount ?? 0;
  const shortfall = report?.shortfallCount ?? (report ? Math.max(0, requested - prepared) : requested);
  const emailReady = report?.emailReadyCount ?? report?.businesses.filter(business => business.draftReady && !business.recipientMissing).length ?? 0;
  const refreshKey = report ? `${report.id}:${report.state}:${report.finishedAt ?? ""}:${prepared}` : "no_report";

  return <section className="dp-program dp-program--daily" aria-labelledby="discovery-program-heading" id="discovery-program">
    <div className="dp-topline"><span><span className={`dp-status-dot${snapshot?.settings.enabled ? " is-on" : ""}`} />DAILY OUTREACH / {snapshot?.settings.enabled ? "ENABLED" : "PAUSED"}</span><span className="dp-credit-label">Manual email · Separate pricing</span></div>
    <div className="dp-intro"><div><p className="dp-domain"><Globe2 size={12} aria-hidden />{companyHost(snapshot?.settings.companyWebsite ?? DEFAULTS.companyWebsite)}</p><h2 id="discovery-program-heading">Your daily outreach list.</h2><p className="dp-daily-description">Melbourne and south-east Melbourne businesses with no own website recorded. Simple, tailored demos and introductions for you to review and send.</p><a className="dp-button dp-button--quiet dp-top-download" href="/api/prospect-pricing/export.xlsx" download><FileSpreadsheet size={13} aria-hidden />Download updated spreadsheet</a></div><div className="dp-daily-count"><strong>{snapshot?.settings.count ?? 20}</strong><span>target per day</span></div></div>
    <ProspectOutreach reportDay={report?.day} reportLeadIds={report?.businesses.map(business => business.leadId)} refreshKey={refreshKey} onSelectLead={onSelectLead} />
    <details className="dp-research-history" open={researchOpen} onToggle={event => setResearchOpen(event.currentTarget.open)}><summary><span><Settings2 size={15} aria-hidden /><span>Daily research settings and previous runs<small>{snapshot?.configured ? `${snapshot.settings.enabled ? "On" : "Paused"} · after ${String(snapshot.schedule?.startHour ?? 7).padStart(2, "0")}:00 Melbourne · target ${snapshot.settings.count}` : "Set up daily preparation"}</small></span></span><ChevronDown size={16} aria-hidden /></summary>
    <p className="dp-history-note">The email queue above shows what is ready now. The dated research report below records that run only; its figures do not include every prepared or previously reviewed business.</p>
    {error && <p className="dp-message dp-message--error" role="alert"><CircleAlert size={15} aria-hidden /><span>{error}</span></p>}
    {notice && <p className="dp-message" role="status"><CheckCheck size={15} aria-hidden /><span>{notice}</span></p>}
    {snapshot?.mode === "fake" && <p className="dp-message dp-message--warning"><CircleAlert size={15} aria-hidden />Fictional test mode. These runs and businesses are simulated; no real provider is contacted.</p>}
    <div className="dp-control"><div className="dp-control-copy"><strong>{loading && !snapshot ? "Checking daily research…" : snapshot?.settings.enabled ? "Daily preparation is on" : "Daily preparation is paused"}</strong><p><Clock3 size={12} aria-hidden />{snapshot?.settings.area ?? DEFAULTS.area}</p></div><div className="dp-control-actions"><button type="button" className="dp-button dp-button--quiet" onClick={toggle} disabled={!snapshot || Boolean(busy) || dirty}>{busy === "toggle" ? <Loader2 size={13} className="dp-spinner" aria-hidden /> : snapshot?.settings.enabled ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}{snapshot?.settings.enabled ? "Pause daily run" : "Enable daily run"}</button><button type="button" className="dp-button" onClick={() => void mutate("run", () => discoveryProgram.run(), "Run requested. Jarvis will update this list as private research and preparation finish.")} disabled={runDisabled}>{busy === "run" || running ? <Loader2 size={14} className="dp-spinner" aria-hidden /> : <Search size={14} aria-hidden />}{running ? "Preparing list…" : "Prepare daily list"}</button></div></div>
    <p className="dp-daily-schedule">Starts after {String(snapshot?.schedule?.startHour ?? 7).padStart(2, "0")}:00 Melbourne time on each enabled day. Search availability may produce fewer than the target; the report shows the actual result.</p>
    {dirty && <p className="dp-save-reminder"><Settings2 size={12} aria-hidden />Save your edited settings before running or changing the daily schedule.</p>}
    {snapshot && (!report || snapshot.run.detail !== report.spokenSummary) && <p className="dp-availability"><ShieldCheck size={12} aria-hidden /><span>{snapshot.run.state !== "idle" ? snapshot.run.detail : snapshot.availability.detail}</span></p>}
    {report && <div className="dp-daily-report"><div className="dp-report-heading"><div><div className="dp-overline">RESEARCH RUN · {report.day}</div><h3>{REPORT_LABELS[report.state]}</h3><p>{dateLabel(report.finishedAt ?? report.startedAt)} · {report.trigger === "scheduled" ? "Scheduled research" : "Requested research"}{report.fixture ? " · Fictional test" : ""}</p></div><button type="button" className="dp-icon-button" aria-label="Refresh discovery program" onClick={() => void load()} disabled={loading || Boolean(busy)}><RefreshCw size={14} className={loading ? "dp-spinner" : ""} aria-hidden /></button></div><div className="dp-totals"><Metric count={report.foundCount} label="New prospects in this run" /><Metric count={prepared} label={`Demos in this run / ${requested}`} /><Metric count={emailReady} label="Sourced drafts in this run" /><Metric count={shortfall} label="This run’s shortfall" /></div>{shortfall > 0 && !running && <p className="dp-daily-shortfall">This {report.day} run prepared {emailReady} of {requested} prospects with a demo and sourced email draft, {shortfall} below its target. Ready emails from other preparation are shown in the queue above. Missing businesses and email addresses have not been filled with guesses.</p>}<p className="dp-spoken-summary">{report.fixture && <strong>Fictional test. </strong>}{report.spokenSummary}</p>{report.errors.length > 0 && <details className="dp-report-errors"><summary>Research details to review</summary><ul>{report.errors.map((detail, index) => <li key={index}>{detail}</li>)}</ul></details>}<div className="dp-report-actions"><button type="button" className="dp-button dp-button--quiet" onClick={speaking ? stopSpeech : speak} disabled={!supported || !report.spokenSummary || RUNNING.has(report.state)}>{speaking ? <Square size={13} aria-hidden /> : <Volume2 size={14} aria-hidden />}{speaking ? "Stop report" : "Read report aloud"}</button><button type="button" className="dp-button dp-button--text" onClick={downloadReport}><ArrowDownToLine size={13} aria-hidden />Save report</button><span>Installed device voice · No AI credits</span></div></div>}
    <details className="dp-settings"><summary><span><Settings2 size={13} aria-hidden />Daily research settings<span className="dp-settings-sub">{form.templateId === "simple" ? "Simple, business-specific demos" : form.templateId === "immersive" ? "Photo showcase" : "Clarity design"}</span></span><ChevronDown size={14} aria-hidden /></summary><form onSubmit={save} className="dp-settings-form"><div className="dp-form-grid"><label className="dp-field dp-field--wide">Find businesses in<input value={form.area} maxLength={160} required onChange={event => change("area", event.target.value)} disabled={Boolean(busy)} placeholder="Melbourne and south-east Melbourne, Victoria" /></label><label className="dp-field">Business type<input value={form.industry} maxLength={100} onChange={event => change("industry", event.target.value)} disabled={Boolean(busy)} placeholder="Any local business, or e.g. trades" /></label><label className="dp-field">Businesses per day<select aria-label="Businesses per day" value={form.count} onChange={event => change("count", Number(event.target.value))} disabled={Boolean(busy)}>{Array.from({ length: 20 }, (_, index) => index + 1).map(count => <option key={count} value={count}>{count}</option>)}</select></label><label className="dp-field dp-field--wide">Design direction<select aria-label="Design direction" value={form.templateId} onChange={event => change("templateId", event.target.value as DiscoveryProgramSettings["templateId"])} disabled={Boolean(busy)}><option value="simple">Simple · Clear, tailored business demo</option><option value="immersive">Photo showcase · Business-specific layouts</option><option value="clarity">Clarity · Apple-inspired restraint</option></select></label><label className="dp-field">Company name<input value={form.companyName} maxLength={160} required onChange={event => change("companyName", event.target.value)} disabled={Boolean(busy)} /></label><label className="dp-field">Company website<input value={form.companyWebsite} type="url" maxLength={2000} required onChange={event => change("companyWebsite", event.target.value)} disabled={Boolean(busy)} /></label></div><div className="dp-design-note"><p><strong>{form.templateId === "simple" ? "A clear, practical first impression." : form.templateId === "immersive" ? "Photo-led, sector-specific layouts." : "Clarity, with restrained typography."}</strong>{form.templateId === "simple" ? "A focused page shaped around the business’s services, imagery and location. The review queue pairs relevant previews or live examples with short email sequences; internal estimates stay in the pricing sheet." : "Genuine business assets and licensed illustrative photography are recorded separately. Existing demos are kept until you choose a new revision."}</p></div><div className="dp-settings-footer"><p>Up to 20 prospects per Melbourne day, targeting businesses with no own website recorded. One dated run continues through worker checks; saving settings does not reset its daily limit.</p><button type="submit" className="dp-button" disabled={Boolean(busy) || (!dirty && Boolean(snapshot?.configured))}>{busy === "save" ? <Loader2 size={13} className="dp-spinner" aria-hidden /> : <Check size={13} aria-hidden />}Save daily settings</button></div></form></details>
    <footer className="dp-footer"><div><ShieldCheck size={13} aria-hidden /><p>Private research and drafts for you to send. Preparing the list does not send email or publish demos.</p></div><p>Built from reusable code. No Lovable, AI model or ElevenLabs request. Hosting and search limits still apply.</p></footer>
    </details>
  </section>;
}

function Metric({ count, label }: { count: number; label: string }) { return <div><strong>{String(count).padStart(2, "0")}</strong><span>{label}</span></div>; }

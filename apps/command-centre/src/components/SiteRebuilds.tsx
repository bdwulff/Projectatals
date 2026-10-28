import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BellRing, Check, CheckCheck, ChevronDown, CircleAlert, Eye, Fingerprint, Globe2, Layers3, Loader2, MapPin, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { siteRebuilds, siteReviewPath, type SiteRebuildBusiness, type SiteRebuildCandidate, type SiteRebuildSnapshot } from "../site-rebuilds-client";
import type { AcquisitionRecord } from "../acquisition-client";
import { demoMedia } from "../design-media";
import "./site-rebuilds.css";
import "./concept-media.css";

const ACTIVE = new Set(["queued", "running"]);
const localPreview = (path?: string) => path && /^\/api\/acquisition\/demos\/[A-Za-z0-9_-]+\/preview$/.test(path) ? path : null;
const localSource = (path?: string) => path && /^\/api\/acquisition\/leads\/[A-Za-z0-9_-]+\/source\.zip$/.test(path) ? path : null;
function sourceLink(value?: string): string | null { try { const url = new URL(value ?? ""); return /^(?:https:|http:)$/.test(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } }
function when(value: string): string { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" }).format(date) : "—"; }
function direction(design?: Record<string, unknown>): string | null {
  if (!design) return null;
  for (const key of ["direction", "name", "artDirection", "familyName", "family", "title", "layout"]) if (typeof design[key] === "string" && design[key]) return String(design[key]).slice(0, 160);
  return null;
}
function stateLabel(business: SiteRebuildCandidate | SiteRebuildBusiness): string {
  if (!("state" in business)) return "Ready to build";
  return { pending: "In the queue", building: "Creating a new direction", ready: "Ready for your review", skipped: "Kept for reference", failed: "Needs attention" }[business.state];
}

/** This creates private designs for existing prospects. It never contacts a business or publishes a concept. */
export function SiteRebuilds({ onSelectLead, onReportChanged, records = [] }: { onSelectLead?: (id: string) => void; onReportChanged?: () => void; records?: readonly AcquisitionRecord[] }) {
  const [snapshot, setSnapshot] = useState<SiteRebuildSnapshot | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false), fetching = useRef(false), serial = useRef(0), mutating = useRef(false);
  const reportKey = useRef<string | null>(null), reportLoaded = useRef(false), callback = useRef(onReportChanged);
  callback.current = onReportChanged;
  const apply = useCallback((value: SiteRebuildSnapshot) => {
    setSnapshot(value);
    const key = value.latestReport ? `${value.latestReport.id}:${value.latestReport.state}:${value.latestReport.rebuiltCount}:${value.latestReport.finishedAt ?? ""}` : null;
    if (reportLoaded.current && key !== reportKey.current) callback.current?.();
    reportLoaded.current = true; reportKey.current = key;
  }, []);
  const load = useCallback(async () => {
    if (fetching.current || mutating.current || document.visibilityState === "hidden") return;
    fetching.current = true; const version = serial.current;
    try { const value = await siteRebuilds.snapshot(); if (alive.current && version === serial.current) { apply(value); setError(null); } }
    catch (reason) { if (alive.current && version === serial.current) setError(reason instanceof Error ? reason.message : "Your website review list is unavailable."); }
    finally { fetching.current = false; if (alive.current && version === serial.current) setLoading(false); }
  }, [apply]);
  useEffect(() => {
    alive.current = true; void load();
    const timer = window.setInterval(() => { void load(); }, 5000);
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { alive.current = false; serial.current++; window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [load]);
  const run = async () => {
    if (mutating.current) return;
    mutating.current = true; serial.current++; setBusy(true); setError(null);
    try { const value = await siteRebuilds.run(); if (alive.current) apply(value); }
    catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : "The private rebuild could not start."); }
    finally { mutating.current = false; if (alive.current) { setBusy(false); setLoading(false); } }
  };
  const report = snapshot?.latestReport;
  const running = Boolean(snapshot && ACTIVE.has(snapshot.run.state));
  const rows: Array<SiteRebuildCandidate | SiteRebuildBusiness> = report?.businesses.length ? report.businesses : snapshot?.candidates ?? [];
  const ready = report?.businesses.filter(row => row.state === "ready" && row.demoReady).length ?? 0;
  const title = running ? "A new direction is taking shape." : ready ? "Your next first impressions." : "Good businesses.\nTheir own place on the web.";
  const select = (row: SiteRebuildCandidate | SiteRebuildBusiness) => {
    window.location.hash = siteReviewPath(row.leadId, report?.id).slice(1);
    if (row.leadId) onSelectLead?.(row.leadId);
  };
  return <section className="site-rebuilds" aria-labelledby="site-rebuilds-title" id="site-rebuild-review">
    <div className="sr-topline"><span><Fingerprint size={13} aria-hidden />Wulff Digital / Design review</span><span><span className={running ? "sr-live sr-live--active" : "sr-live"} />{running ? "Building private concepts" : "A direction for every business"}</span></div>
    <header className="sr-intro"><div><p className="sr-kicker">Distinct by design.</p><h2 id="site-rebuilds-title">{title}</h2><p>Business-specific layouts, colour and visual storytelling. A private review collection for prospects with no own website recorded.</p></div><div className="sr-intro-mark" aria-hidden><span>W<span>01</span></span><div className="sr-orbit sr-orbit--one" /><div className="sr-orbit sr-orbit--two" /></div></header>
    <div className="sr-command"><div><strong>{running ? snapshot?.run.detail : report ? `${ready} concept${ready === 1 ? "" : "s"} ready · ${report.targetCount} prospect${report.targetCount === 1 ? "" : "s"} reviewed` : `${snapshot?.candidates.length ?? "—"} existing prospect${snapshot?.candidates.length === 1 ? "" : "s"} in this collection`}</strong><p>{report?.finishedAt ? `Updated ${when(report.finishedAt)} · private owner review` : "Rebuild existing research with individual creative directions."}</p></div><div className="sr-command-actions"><button type="button" className="sr-button sr-button--quiet" onClick={() => void load()} disabled={loading || busy} aria-label="Refresh website review list"><RefreshCw size={14} className={loading ? "sr-spin" : ""} aria-hidden /></button><button type="button" className="sr-button" onClick={() => void run()} disabled={busy || running || !snapshot?.candidates.length}>{busy || running ? <Loader2 size={14} className="sr-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />}{busy || running ? "Preparing concepts…" : report ? "Rebuild eligible prospects" : "Build the review collection"}</button></div></div>
    {snapshot?.mode === "fake" && <div className="sr-notice" role="status"><CircleAlert size={15} aria-hidden />Fictional test records. These are not live businesses or customer results.</div>}
    {error && <div className="sr-notice sr-notice--error" role="alert"><CircleAlert size={15} aria-hidden />{error}</div>}
    {running && report && <div className="sr-progress" aria-live="polite"><div><span>{report.rebuiltCount} of {report.targetCount} concepts prepared</span><span>{report.skippedCount ? `${report.skippedCount} skipped` : "No outreach"}</span></div><progress max={Math.max(1, report.targetCount)} value={report.rebuiltCount + report.skippedCount} aria-label="Private concept rebuild progress" /></div>}
    {report && !running && <div className="sr-ready-note"><BellRing size={16} aria-hidden /><p><strong>{report.notificationId ? "Jarvis has added your review notification." : "Your private review report is available here."}</strong> {report.spokenSummary}</p></div>}
    {rows.length > 0 ? <div className="sr-grid" aria-label="Potential clients for website review">{rows.map((row, index) => {
      const built = "state" in row ? row : null;
      const preview = built?.demoReady ? localPreview(built.previewPath) : null;
      const source = built?.demoReady ? localSource(built.sourcePath) : null;
      const creative = direction(built?.design);
      const record = row.leadId ? records.find(item => item.id === row.leadId) : null;
      const media = demoMedia(record, built?.design);
      const evidence = row.evidence.filter(item => Boolean(item.observation || item.sourceUrl)).slice(0, 4);
      return <article className={`sr-card sr-card--${index % 4}`} key={row.prospectId}>
        <div className="sr-card-art" aria-hidden><div className="sr-art-lines" /><span className="sr-card-number">{String(index + 1).padStart(2, "0")}</span><div className="sr-card-monogram">{row.name.trim().charAt(0).toLocaleUpperCase("en-AU") || "W"}<span>Concept direction</span></div><span className="sr-card-state">{built?.state === "ready" ? <Check size={11} /> : built?.state === "building" ? <Loader2 size={11} className="sr-spin" /> : <Layers3 size={11} />}{stateLabel(row)}</span></div>
        <div className="sr-card-body"><p className="sr-card-industry">{row.industry || "Local business"}</p><h3>{row.name}</h3><p className="sr-location"><MapPin size={11} aria-hidden />{row.location}</p>{creative && <p className="sr-direction"><Fingerprint size={12} aria-hidden />{creative}</p>}
          <span className="sr-classification"><Globe2 size={11} aria-hidden />{row.classification === "social_only" ? "Only social / directory links recorded" : "No own website recorded"}</span>
          <p className="sr-uncertainty">{row.uncertainty || "Recorded research does not prove that a website does not exist. Review the evidence before contacting this business."}</p>
          {built?.demoReady && <><p className="sr-asset-note"><strong>{media.summary}</strong>{record && !record.contact?.email ? " · Recipient not recorded" : ""}</p>{media.hasPlaceholders && <p className="sr-media-caption">Illustrative photos and concept branding show a proposed direction. They do not represent verified business premises, staff or existing branding.</p>}</>}
          {built?.error && <p className="sr-row-error"><CircleAlert size={12} aria-hidden />{built.error}</p>}
          <div className="sr-card-actions">{preview && <a href={preview} className="sr-button sr-button--preview" target="_blank" rel="noreferrer"><Eye size={13} aria-hidden />Preview site<ArrowUpRight size={12} aria-hidden /></a>}{row.leadId && (!built || built.state === "ready") && <button type="button" className="sr-button sr-button--quiet" onClick={() => select(row)}>Review<ArrowRight size={13} aria-hidden /></button>}{source && <a href={source} className="sr-code-link" download aria-label={`Download code for ${row.name}`}><ArrowDownToLine size={14} aria-hidden /></a>}</div>
          <details className="sr-evidence"><summary>Research & design notes<ChevronDown size={12} aria-hidden /></summary>{evidence.length ? evidence.map((item, itemIndex) => <div key={itemIndex}><p>{item.observation}</p>{item.uncertainty && <small>{item.uncertainty}</small>}{sourceLink(item.sourceUrl) && <a href={sourceLink(item.sourceUrl)!} target="_blank" rel="noreferrer">View recorded source<ArrowUpRight size={10} aria-hidden /></a>}</div>) : <p>No supporting source is recorded yet. Verify this prospect before outreach.</p>}{media.references.map(reference => <div className="sr-template-reference" key={reference.sourceUrl}><span>Design reference: </span><a href={reference.sourceUrl} target="_blank" rel="noreferrer">{reference.name}<ArrowUpRight size={10} aria-hidden /></a>{reference.previewUrl && <a href={reference.previewUrl} target="_blank" rel="noreferrer">View template preview<ArrowUpRight size={10} aria-hidden /></a>}</div>)}<p>Business source material and illustrative stock are recorded separately. Contact details remain sourced facts; concept logos and placeholder photographs are proposed design material.</p></details>
        </div></article>;
    })}</div> : <div className="sr-empty" role="status">{loading ? <><Loader2 size={24} className="sr-spin" aria-hidden /><h3>Opening the review collection.</h3></> : <><ShieldCheck size={25} aria-hidden /><h3>No eligible prospects in this collection yet.</h3><p>{snapshot?.excludedCount ? `${snapshot.excludedCount} existing record${snapshot.excludedCount === 1 ? " was" : "s were"} excluded from this rebuild.` : "The queue is checked for existing websites and records that should not be changed."} New eligible prospects appear here with their research evidence.</p></>}</div>}
    {report?.errors.length ? <details className="sr-errors"><summary><CircleAlert size={13} aria-hidden />{report.errors.length} item{report.errors.length === 1 ? " needs" : "s need"} attention<ChevronDown size={13} aria-hidden /></summary><ul>{report.errors.map((message, index) => <li key={index}>{message}</li>)}</ul></details> : null}
    <footer className="sr-footer"><ShieldCheck size={14} aria-hidden /><p>Private concepts for your review. Potential clients remain prospects. Rebuilding creates no public website, email delivery or contact approval.</p><span><CheckCheck size={12} aria-hidden />Built from code</span></footer>
  </section>;
}

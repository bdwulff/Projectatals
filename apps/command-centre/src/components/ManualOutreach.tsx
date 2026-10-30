import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, Check, CheckCheck, ChevronDown, CircleAlert, Clock3, Copy, Eye, Loader2, Mail, MessageCircle, Pause, RefreshCw } from "lucide-react";
import { manualOutreach, type ManualOutreachRow, type ManualOutreachSnapshot, type OutreachAction, type OutreachStage, type OutreachStageId } from "../manual-outreach-client";
import { copyEmailBody, copyFullEmail, downloadEmail, emailComposeUrl } from "../email-export";
import "./manual-outreach.css";

type QueueView = "ready" | "followups" | "review";
const STAGE_LABELS: Record<OutreachStageId, string> = { initial: "First email", follow_up_1: "Follow-up 1", follow_up_2: "Follow-up 2" };
const STATUS_LABELS: Record<ManualOutreachRow["status"], string> = { active: "Active", hold: "On hold", replied: "Replied", do_not_contact: "Do not contact", closed: "Closed" };
function publicLink(value: string | null | undefined): string | null {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
function dateLabel(value: string | null, includeTime = false): string {
  if (!value) return "Not yet checked";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", ...(includeTime ? { hour: "numeric", minute: "2-digit" } as const : {}), timeZone: "Australia/Melbourne" }).format(date) : "Date unavailable";
}
const pending = (row: ManualOutreachRow) => row.stages.find(stage => stage.ready && !stage.sentAt) ?? row.stages.find(stage => !stage.sentAt) ?? row.stages[0];
const OPEN_READY_EMAILS_EVENT = "atlas:open-ready-emails";
export function focusManualOutreachQueue() {
  const section = document.getElementById("manual-outreach");
  const heading = document.getElementById("manual-outreach-title");
  if (!section) return;
  window.dispatchEvent(new Event(OPEN_READY_EMAILS_EVENT));
  heading?.focus({ preventScroll: true });
  section.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
function inView(row: ManualOutreachRow, view: QueueView): boolean {
  if (view === "review") return !row.eligible || row.status !== "active";
  if (!row.eligible || row.status !== "active") return false;
  if (view === "ready") return Boolean(row.stages.find(stage => stage.id === "initial" && !stage.sentAt));
  return Boolean(row.stages.find(stage => stage.id === "initial" && stage.sentAt)) && row.stages.some(stage => stage.id !== "initial" && !stage.sentAt);
}

/** This queue only prepares local email-app drafts. Sending remains in the owner's mail app. */
export function ManualOutreach({ refreshKey }: { refreshKey?: string }) {
  const [snapshot, setSnapshot] = useState<ManualOutreachSnapshot | null>(null);
  const [view, setView] = useState<QueueView>("ready");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const mounted = useRef(false), fetching = useRef(false), mutating = useRef(false), serial = useRef(0);
  const load = useCallback(async () => {
    if (fetching.current || mutating.current || document.visibilityState === "hidden") return;
    fetching.current = true; const version = serial.current;
    try { const value = await manualOutreach.snapshot(); if (mounted.current && version === serial.current) { setSnapshot(value); setError(null); } }
    catch (reason) { if (mounted.current && version === serial.current) setError(reason instanceof Error ? reason.message : "Your daily outreach queue is unavailable."); }
    finally { fetching.current = false; if (mounted.current && version === serial.current) setLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true; void load();
    const timer = window.setInterval(() => void load(), 30_000);
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { mounted.current = false; serial.current++; window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [load]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => {
    const showReady = () => setView("ready");
    const openFromLink = () => {
      const query = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
      if (query.get("outreach") === "ready") window.requestAnimationFrame(focusManualOutreachQueue);
    };
    window.addEventListener(OPEN_READY_EMAILS_EVENT, showReady);
    openFromLink(); window.addEventListener("hashchange", openFromLink);
    return () => { window.removeEventListener("hashchange", openFromLink); window.removeEventListener(OPEN_READY_EMAILS_EVENT, showReady); };
  }, []);
  const update = async (row: ManualOutreachRow, action: OutreachAction, stage?: OutreachStageId) => {
    if (mutating.current) return;
    mutating.current = true; serial.current++; setBusy(row.leadId); setError(null);
    try {
      const selectedDraft = row.stages.find(item => item.id === stage);
      const value = await manualOutreach.update(row.leadId, { expectedRevision: row.revision, action, ...(stage ? { stage } : {}), ...((action === "reviewed" || action === "sent") && selectedDraft ? { expectedDraftHash: selectedDraft.contentHash } : {}) });
      if (mounted.current) {
        setSnapshot(value);
        setNotice(action === "sent" ? "Saved as sent by you. Opening an email alone never marks it sent." : action === "reviewed" ? "Review saved. Open the draft in your email app when you’re ready." : action === "replied" ? "Reply recorded. Further follow-ups for this business have stopped." : action === "resume" ? "Business returned to your review queue." : "Outreach stopped for this business. No follow-ups will be prepared for sending while this status applies.");
      }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "The outreach record could not be updated."); }
    finally { mutating.current = false; if (mounted.current) setBusy(null); }
  };
  const rows = snapshot?.rows ?? [], shown = rows.filter(row => inView(row, view));
  const readyCount = rows.filter(row => inView(row, "ready")).length, followCount = rows.filter(row => inView(row, "followups")).length, reviewCount = rows.filter(row => inView(row, "review")).length;

  return <section className="mo-workspace" aria-labelledby="manual-outreach-title" id="manual-outreach">
    <header className="mo-heading"><div><p className="mo-eyebrow">YOUR NEXT CONVERSATIONS</p><h3 id="manual-outreach-title" tabIndex={-1}>Review it. Open it. Make it yours.</h3><p>Your researched businesses, website previews and three email drafts in one place.</p></div><button type="button" className="mo-icon-button" aria-label="Refresh daily email queue" disabled={loading || Boolean(busy)} onClick={() => void load()}><RefreshCw size={17} aria-hidden /></button></header>
    <div className="mo-summary"><div><strong>{snapshot?.counts.ready ?? 0}</strong><span>first emails ready</span></div><div><strong>{snapshot?.counts.due ?? 0}</strong><span>follow-ups due</span></div><div><strong>{snapshot?.counts.newToday ?? 0}<small> / {snapshot?.schedule.target ?? 20}</small></strong><span>lined up today</span></div></div>
    <p className="mo-schedule"><Clock3 size={14} aria-hidden /><span>{snapshot?.schedule.enabled ? `Daily preparation runs after ${String(snapshot.schedule.startHour).padStart(2, "0")}:00 Melbourne time.` : "Daily preparation is paused. Open Daily research settings and previous runs below to enable it."} {snapshot && snapshot.counts.shortfall > 0 ? `${snapshot.counts.shortfall} below today’s target; earlier unsent prospects remain available.` : ""}</span></p>
    <div className="mo-how"><Mail size={18} aria-hidden /><p><strong>One tap opens your email app.</strong> Check a draft, save your review, then open it with the recipient, subject, message and link filled in. You choose the sending account and tap Send in your email app.</p></div>
    {snapshot?.mode === "fake" && <p className="mo-message mo-message--warning"><CircleAlert size={16} aria-hidden />Fictional test queue. These businesses and drafts are test records.</p>}
    {error && <p className="mo-message mo-message--error" role="alert"><CircleAlert size={16} aria-hidden /><span>{error} <button type="button" onClick={() => void load()}>Refresh queue</button></span></p>}
    {notice && <p className="mo-message" role="status"><CheckCheck size={16} aria-hidden /><span>{notice}</span></p>}
    <div className="mo-tabs" aria-label="Email queue views">{([
      ["ready", "First emails", readyCount], ["followups", "Follow-ups", followCount], ["review", "Review & stopped", reviewCount],
    ] as const).map(([id, label, count]) => <button type="button" key={id} aria-pressed={view === id} onClick={() => setView(id)}>{label}<span>{count}</span></button>)}</div>
    <div className="mo-list">{shown.map((row, index) => <OutreachCard key={row.leadId} row={row} defaultOpen={index === 0} busy={Boolean(busy)} onUpdate={update} onNotice={setNotice} />)}</div>
    {!shown.length && <p className="mo-empty" role="status">{loading && !snapshot ? <><Loader2 size={19} className="mo-spin" aria-hidden />Loading your reviewed email queue…</> : view === "followups" ? "Your follow-ups will appear here after you log a first email as sent. Nothing sends automatically." : view === "review" ? "No businesses are currently held or stopped." : "No first emails are ready yet. Newly researched businesses will appear after preparation and evidence checks."}</p>}
    {snapshot && snapshot.notes.length > 0 && <details className="mo-notes"><summary>Queue and research details<ChevronDown size={15} aria-hidden /></summary><ul>{snapshot.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></details>}
    <p className="mo-footnote">On iPhone, “Open in email app” uses your default mail app. If a draft opens without all its text, use Copy message or Download .eml below it. Opening, copying and downloading do not send or mark an email as sent.</p>
  </section>;
}

function OutreachCard({ row, defaultOpen, busy, onUpdate, onNotice }: { row: ManualOutreachRow; defaultOpen: boolean; busy: boolean; onUpdate: (row: ManualOutreachRow, action: OutreachAction, stage?: OutreachStageId) => Promise<void>; onNotice: (value: string) => void }) {
  const [selected, setSelected] = useState<OutreachStageId>(() => pending(row)?.id ?? "initial");
  const stage = row.stages.find(item => item.id === selected) ?? pending(row);
  const evidence = publicLink(row.sourceUrl), concept = row.previewReady ? publicLink(row.previewUrl) : null, proof = publicLink(row.proofUrl);
  const compose = stage ? emailComposeUrl(stage) : null;
  const active = row.eligible && row.status === "active";
  const currentDraft = stage && /^[a-f0-9]{64}$/i.test(stage.contentHash);
  const canOpen = active && Boolean(currentDraft && stage?.reviewed && stage.ready && !stage.sentAt && compose);
  const canReview = active && Boolean(currentDraft && stage && !stage.sentAt && !stage.reviewed);
  const stageTiming = (item: OutreachStage): string => item.sentAt ? `Sent ${dateLabel(item.sentAt)}` : item.ready ? item.reviewed ? "Reviewed · ready" : "Ready to review" : item.dueAt ? `Due ${dateLabel(item.dueAt)}` : item.id === "initial" ? "Needs review" : "After previous email";
  if (!stage) return null;

  return <article className={`mo-card${!active ? " mo-card--held" : ""}`} aria-labelledby={`mo-title-${row.leadId}`}>
    <div className="mo-card-top"><div><p className="mo-card-location">{row.location} <span>· {row.industry}</span></p><h4 id={`mo-title-${row.leadId}`}>{row.businessName}</h4></div><span className={`mo-status mo-status--${row.status}`}>{row.status === "active" && !row.eligible ? "Needs review" : STATUS_LABELS[row.status]}</span></div>
    <p className="mo-observation">{row.observation}</p>
    {row.opportunity && <p className="mo-opportunity"><strong>The opportunity</strong> {row.opportunity}</p>}
    <div className="mo-proof-links">{concept ? <a href={concept} target="_blank" rel="noreferrer"><Eye size={15} aria-hidden />Website preview<ArrowUpRight size={13} aria-hidden /></a> : proof ? <a href={proof} target="_blank" rel="noreferrer"><Eye size={15} aria-hidden />Relevant live example<ArrowUpRight size={13} aria-hidden /></a> : null}{evidence && <a href={evidence} target="_blank" rel="noreferrer">Research source<ArrowUpRight size={13} aria-hidden /></a>}<span>Checked {dateLabel(row.checkedAt)}</span></div>
    {!concept && <p className="mo-small">This draft uses a relevant live example. A personalised public preview is not ready for sharing yet.</p>}
    {row.holdReason && <p className="mo-hold"><CircleAlert size={15} aria-hidden /><span>{row.holdReason}</span></p>}
    {row.reviewFlags && row.reviewFlags.length > 0 && <details className="mo-review-flags"><summary>Details to check before sending<ChevronDown size={14} aria-hidden /></summary><ul>{row.reviewFlags.map((flag, index) => <li key={index}>{flag}</li>)}</ul></details>}
    <details className="mo-draft" open={defaultOpen}>
      <summary><span><Mail size={17} aria-hidden />Email drafts<span className="mo-draft-count">{row.stages.filter(item => item.sentAt).length} of {row.stages.length} sent by you</span></span><ChevronDown size={17} aria-hidden /></summary>
      <div className="mo-stages" aria-label={`Email stages for ${row.businessName}`}>{row.stages.map(item => <button key={item.id} type="button" aria-pressed={stage.id === item.id} onClick={() => setSelected(item.id)}><span>{item.sentAt && <Check size={13} aria-hidden />}{STAGE_LABELS[item.id]}</span><small>{stageTiming(item)}</small></button>)}</div>
      <dl className="mo-email-meta"><dt>To</dt><dd>{stage.to || "No verified address"}</dd><dt>Subject</dt><dd>{stage.subject}</dd></dl>
      <pre className="mo-email-text" tabIndex={0} aria-label={`${STAGE_LABELS[stage.id]} message for ${row.businessName}`}>{stage.text}</pre>
      {stage.sentAt ? <p className="mo-reviewed"><CheckCheck size={16} aria-hidden />You recorded this as sent on {dateLabel(stage.sentAt, true)}.</p> : stage.reviewed ? <p className="mo-reviewed"><CheckCheck size={16} aria-hidden />Draft reviewed by you.{!stage.ready && stage.dueAt ? ` Available to send from ${dateLabel(stage.dueAt)}.` : ""}</p> : <button type="button" className="mo-review-button" onClick={() => void onUpdate(row, "reviewed", stage.id)} disabled={!canReview || busy}><Check size={16} aria-hidden />I’ve checked this recipient, message and link</button>}
      <div className="mo-compose-actions">{canOpen ? <a className="mo-button mo-button--primary" href={compose!} onClick={() => onNotice("Draft requested in your email app. Choose the sending account there. Nothing has been sent or marked sent.")}><Mail size={18} aria-hidden />Open in email app<ArrowUpRight size={16} aria-hidden /></a> : <button type="button" className="mo-button mo-button--primary" disabled><Mail size={18} aria-hidden />{stage.sentAt ? "Already recorded as sent" : !active ? row.status === "active" ? "Details need checking" : "Sending stopped" : !stage.ready && stage.dueAt ? `Available ${dateLabel(stage.dueAt)}` : !stage.ready && stage.id !== "initial" ? "Send the previous email first" : !compose ? "Check recipient details" : "Review to open email"}</button>}{!stage.sentAt && <button type="button" className="mo-button mo-button--quiet" disabled={!canOpen || busy} onClick={() => void onUpdate(row, "sent", stage.id)}><CheckCheck size={17} aria-hidden />I sent this</button>}</div>
      <div className="mo-export-actions"><button type="button" onClick={() => void copyFullEmail(stage, onNotice)}><Copy size={14} aria-hidden />Copy full email</button><button type="button" onClick={() => void copyEmailBody(stage.text, onNotice)}>Copy message</button><button type="button" onClick={() => downloadEmail(`${row.businessName}-${stage.id}`, { from: "", ...stage })}><ArrowDownToLine size={14} aria-hidden />Download .eml</button></div>
      {!stage.sentAt && <p className="mo-small">After sending from your email app, return here and choose “I sent this” to start the follow-up timing.</p>}
    </details>
    <div className="mo-stop-actions">{row.status === "hold" ? <button type="button" disabled={busy} onClick={() => void onUpdate(row, "resume")}>Return to queue</button> : row.status === "active" ? <><button type="button" disabled={busy} onClick={() => void onUpdate(row, "replied")}><MessageCircle size={14} aria-hidden />They replied</button><button type="button" disabled={busy} onClick={() => void onUpdate(row, "hold")}><Pause size={14} aria-hidden />Put on hold</button><details><summary>More</summary><button type="button" disabled={busy} onClick={() => void onUpdate(row, "closed")}>Close this prospect</button><button type="button" disabled={busy} onClick={() => void onUpdate(row, "do_not_contact")}>Do not contact</button></details></> : <span>Further follow-ups stopped.</span>}{busy && <span className="mo-saving" role="status"><Loader2 size={14} className="mo-spin" aria-hidden />Saving…</span>}</div>
  </article>;
}

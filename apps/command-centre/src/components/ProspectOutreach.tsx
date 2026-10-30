import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDownToLine, ArrowUpRight, CheckCheck, ChevronDown, CircleAlert, Copy, Eye, FileSpreadsheet, Loader2, Mail, MapPin, RefreshCw } from "lucide-react";
import { prospectPricing, type ManualEmailStatus, type ProspectPricingRow, type ProspectPricingSnapshot } from "../prospect-pricing-client";
import { copyEmail, downloadEmail } from "../email-export";
import "./prospect-outreach.css";
import { ManualOutreach } from "./ManualOutreach";

const STATUS: Record<ManualEmailStatus, string> = { not_sent: "Not sent", sent: "Sent manually", replied: "Replied", follow_up: "Follow up", closed: "Closed", do_not_contact: "Do not contact" };
const validDay = (value: string | undefined): string | null => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
const preview = (value: string | null): string | null => value && /^\/api\/acquisition\/demos\/[A-Za-z0-9_-]+\/preview$/.test(value) ? value : null;
function source(value: string | null): string | null { try { const url = new URL(value ?? ""); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } }
function reviewPath(leadId: string): string | null { return /^[A-Za-z0-9_-]{1,200}$/.test(leadId) ? `/#pipeline?review=${encodeURIComponent(leadId)}` : null; }
const aud = (value: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(value);

/** Owner-only research, draft downloads and internal notes. There is no sending transport here. */
export function ProspectOutreach({ reportDay, reportLeadIds, refreshKey, onSelectLead }: { reportDay?: string; reportLeadIds?: readonly string[]; refreshKey?: string; onSelectLead?: (id: string) => void }) {
  const [snapshot, setSnapshot] = useState<ProspectPricingSnapshot | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [scope, setScope] = useState<"daily" | "all">("daily");
  const alive = useRef(false), fetching = useRef(false), serial = useRef(0);
  const load = useCallback(async () => {
    if (fetching.current || document.visibilityState === "hidden") return;
    fetching.current = true; const version = ++serial.current; setLoading(true);
    try { const value = await prospectPricing.snapshot(); if (alive.current && serial.current === version) { setSnapshot(value); setError(null); } }
    catch (reason) { if (alive.current && serial.current === version) setError(reason instanceof Error ? reason.message : "Your manual outreach list is unavailable."); }
    finally { fetching.current = false; if (alive.current && serial.current === version) setLoading(false); }
  }, []);
  useEffect(() => {
    alive.current = true; void load();
    const timer = window.setInterval(() => { void load(); }, 30_000);
    return () => { alive.current = false; serial.current++; window.clearInterval(timer); };
  }, [load]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  const day = validDay(reportDay), all = snapshot?.rows ?? [];
  const daily = reportLeadIds ? all.filter(row => reportLeadIds.includes(row.leadId)) : day ? all.filter(row => row.discoveryDays.includes(day)) : all;
  const rows = (scope === "daily" ? daily : all).filter(row => row.noWebsite);
  const select = (row: ProspectPricingRow) => {
    const path = reviewPath(row.leadId); if (!path) return;
    window.location.hash = path.slice(1); onSelectLead?.(row.leadId);
  };
  const updated = (value: ProspectPricingSnapshot) => { serial.current++; setSnapshot(value); setNotice("Internal spreadsheet updated. Your email draft has not changed."); };

  return <><ManualOutreach refreshKey={refreshKey} /><details className="po-legacy-tools"><summary><span><FileSpreadsheet size={16} aria-hidden />Spreadsheet & saved research</span><ChevronDown size={16} aria-hidden /></summary><div className="po-workspace">
    <div className="po-toolbar"><div><h3>Saved research & pricing</h3><p>{day ? `Latest run · ${day} · Melbourne time` : "Existing research · your first daily report will appear here"}</p></div><div className="po-downloads"><a className="dp-button dp-button--primary" href="/api/prospect-pricing/export.xlsx" download><FileSpreadsheet size={14} aria-hidden />Download spreadsheet</a><a className="po-text-link" href="/api/prospect-pricing/export.csv" download>CSV<ArrowDownToLine size={11} aria-hidden /></a><button type="button" className="dp-icon-button" onClick={() => void load()} disabled={loading} aria-label="Refresh saved research and pricing"><RefreshCw size={14} className={loading ? "dp-spinner" : ""} aria-hidden /></button></div></div>
    <p className="po-note">Use the three-stage email queue above for your current outreach. This panel keeps your saved business research, previous drafts and internal pricing. The workbook separates business details and prices onto their own sheets.</p>
    <div className="po-filters" aria-label="Outreach list filter"><button type="button" aria-pressed={scope === "daily"} onClick={() => setScope("daily")}>{day ? "Latest daily list" : "Existing prospects"}<span>{daily.filter(row => row.noWebsite).length}</span></button><button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>All prospects<span>{all.filter(row => row.noWebsite).length}</span></button></div>
    {error && <p className="po-message po-message--error" role="alert"><CircleAlert size={14} aria-hidden />{error}</p>}
    {notice && <p className="po-message" role="status"><CheckCheck size={14} aria-hidden />{notice}</p>}
    {snapshot?.mode === "fake" && <p className="po-note">Fictional test list. These records and drafts are not real businesses or delivery.</p>}
    <div className="po-list" aria-label="Prospects for manual email">{rows.map(row => <article className="po-row" key={row.leadId} aria-label={row.businessName}>
      <div className="po-business"><h4>{row.businessName}</h4><p><MapPin size={11} aria-hidden />{row.location}</p><small>{row.industry} · {row.websiteStatus === "social_only" ? "Social / directory only recorded" : "No own website recorded"}</small>{source(row.sourceUrl) && <a href={source(row.sourceUrl)!} target="_blank" rel="noreferrer">Research source<ArrowUpRight size={10} aria-hidden /></a>}</div>
      <div className="po-contact"><span className="po-label">Business email</span><strong>{row.contactEmail || "Email not found"}</strong>{row.contactEmail && source(row.contactSourceUrl) && <a href={source(row.contactSourceUrl)!} target="_blank" rel="noreferrer">Contact source<ArrowUpRight size={10} aria-hidden /></a>}{row.contactReviewRequired && <small>Contact review required</small>}<span className={`po-status${row.price.manualEmailStatus === "do_not_contact" ? " po-status--hold" : ""}`}>{STATUS[row.price.manualEmailStatus]}</span></div>
      <div className="po-actions">{row.demoReady && preview(row.previewPath) && <a className="dp-button dp-button--quiet" href={preview(row.previewPath)!} target="_blank" rel="noreferrer"><Eye size={12} aria-hidden />Preview demo</a>}<button type="button" className="dp-button dp-button--quiet" onClick={() => select(row)} disabled={!reviewPath(row.leadId)}>Review<ArrowUpRight size={12} aria-hidden /></button></div>
      <details className="po-email"><summary><Mail size={12} aria-hidden />{row.draft ? "Review & copy email draft" : "Email draft not prepared"}<ChevronDown size={12} aria-hidden /></summary>{row.draft ? <><dl><dt>To</dt><dd>{row.draft.to || "No recipient recorded"}</dd><dt>Subject</dt><dd>{row.draft.subject}</dd></dl><pre>{row.draft.text}</pre><div className="po-email-actions"><button type="button" className="dp-button dp-button--quiet" onClick={() => void copyEmail(row.draft!.subject, row.draft!.text, setNotice)}><Copy size={12} aria-hidden />Copy email</button><button type="button" className="dp-button dp-button--quiet" onClick={() => { downloadEmail(row.businessName, row.draft!); setNotice("Email draft downloaded. Review it in your mail app and send it yourself when ready."); }}><ArrowDownToLine size={12} aria-hidden />Download .eml</button></div><p className="po-note">Review the recipient, contact basis and every link before sending. Preview demos require your private sign-in; shareable publication needs your separate review in the business workspace.</p></> : <p className="po-note">Open Review to prepare a private demo and introduction.</p>}</details>
    </article>)}</div>
    {!rows.length && <p className="po-empty" role="status">{loading && !snapshot ? <><Loader2 size={17} className="dp-spinner" aria-hidden />Loading your list…</> : day && scope === "daily" ? "No matching prospects in this daily report. Any search shortfall is reported above; earlier research is available under All prospects." : "No eligible prospects recorded yet. Run daily research or add a sourced business below."}</p>}
    <p className="po-note">A missing website is a research finding, not proof that one does not exist. Email addresses are saved with their sources; Jarvis does not guess them.</p>
    <details className="po-pricing" id="prospect-pricing"><summary><span><FileSpreadsheet size={14} aria-hidden />Internal pricing & manual email tracking<span>{all.length} records</span></span><ChevronDown size={14} aria-hidden /></summary><p className="po-note">Editable starting estimates in AUD for your own planning. These are separate from email text and are not approved quotes. Recording “Sent manually” is your note, not a provider delivery receipt.</p>{all.map(row => <PricingEditor key={`${row.leadId}:${row.price.revision}`} row={row} onUpdated={updated} onStale={() => void load()} />)}{!all.length && <p className="po-note">Pricing appears when a prospect is saved.</p>}</details>
  </div></details></>;
}

function PricingEditor({ row, onUpdated, onStale }: { row: ProspectPricingRow; onUpdated: (value: ProspectPricingSnapshot) => void; onStale: () => void }) {
  const [amount, setAmount] = useState(String(row.price.suggestedQuoteAud)), [status, setStatus] = useState(row.price.manualEmailStatus), [scope, setScope] = useState(row.price.proposedScope), [notes, setNotes] = useState(row.price.notes), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const saving = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (saving.current) return;
    saving.current = true; setBusy(true); setError(null);
    try { const value = await prospectPricing.update(row.leadId, { expectedRevision: row.price.revision, suggestedQuoteAud: Number(amount), proposedScope: scope, manualEmailStatus: status, notes }); if (alive.current) onUpdated(value); }
    catch (reason) { if (alive.current) { setError(reason instanceof Error ? reason.message : "The internal record could not be saved."); if (reason && typeof reason === "object" && "status" in reason && reason.status === 409) onStale(); } }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  };
  return <details className="po-price-row"><summary><span><strong>{row.businessName}</strong><small>{STATUS[row.price.manualEmailStatus]}</small></span><span>{aud(row.price.suggestedQuoteAud)}<ChevronDown size={12} aria-hidden /></span></summary><form onSubmit={event => void save(event)}><p className="po-note">{{ existing_internal_recommendation: "Existing internal recommendation", services_heuristic: "Starting estimate from recorded services", owner_edited: "Owner-edited estimate" }[row.price.quoteBasis] ?? "Internal starting estimate"} · GST status unconfirmed · Revision {row.price.revision}</p><div className="po-form-grid"><label className="dp-field">Internal starting estimate (AUD)<input type="number" min="0" max="1000000" step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} disabled={busy} /></label><label className="dp-field">Manual email status<select aria-label="Manual email status" value={status} onChange={event => setStatus(event.target.value as ManualEmailStatus)} disabled={busy}>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="dp-field po-wide">Proposed scope<textarea value={scope} onChange={event => setScope(event.target.value)} maxLength={1500} required disabled={busy} /></label><label className="dp-field po-wide">Internal notes<textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={2000} disabled={busy} /></label></div>{row.price.exclusions.length > 0 && <p className="po-note">Excludes: {row.price.exclusions.join(" · ")}</p>}{error && <p className="po-message po-message--error" role="alert">{error}</p>}<button type="submit" className="dp-button" disabled={busy}>{busy ? <Loader2 size={12} className="dp-spinner" aria-hidden /> : <CheckCheck size={12} aria-hidden />}Save internal record</button></form></details>;
}

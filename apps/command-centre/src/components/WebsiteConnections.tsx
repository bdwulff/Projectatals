import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, CheckCheck, ExternalLink, FolderGit2, Globe2, KeyRound, Link2, Loader2, Mail, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { ApiError, SESSION_EXPIRED_EVENT, relTime } from "../api";
import { acquisition, type AcquisitionMailProviders } from "../acquisition-client";
import { Card, Chip, ErrorBanner } from "./ui";
import "./website-connections.css";

type ConnectionState = "connected" | "not_connected" | "error" | "fake";
interface WebsiteProject { id: string; name: string; editorUrl: string; isPublished: boolean; lastEditedAt?: string }
interface WebsiteRecord {
  id: string; name: string; url: string; lovableProjectId?: string; repoUrl?: string; createdAt: string; updatedAt: string;
  check: { state: "unchecked" | "reachable" | "unreachable" | "error" | "fake"; detail: string; checkedAt?: string; status?: number; title?: string };
}
interface WebsiteSnapshot {
  mode: "live" | "fake";
  lovable: { state: ConnectionState; detail: string; workspaceId?: string; workspaceName?: string; verifiedAt?: string; lastAttemptAt?: string; truncated: boolean; projects: WebsiteProject[]; capabilities: { readProjects: true; editCode: false; publish: false } };
  sites: WebsiteRecord[];
}
const PROJECT_ID = /^[A-Za-z0-9_-]{3,128}$/;
function websiteUrl(value: string | undefined, allowFictional = false): string | null {
  if (!value) return null;
  try {
    const u = new URL(value), host = u.hostname.toLowerCase().replace(/\.$/, "");
    const fictional = allowFictional && host.endsWith(".example.test");
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || (u.port && u.port !== "443") || !host.includes(".") || host.includes(":") || /^[\d.]+$/.test(host) || (!fictional && /(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|example|onion)$/.test(host)) || u.href.length > 2000) return null;
    return u.href;
  } catch { return null; }
}
function editorUrl(id: string | undefined): string | null { return id && PROJECT_ID.test(id) ? `https://lovable.dev/projects/${id}` : null; }
function repositoryUrl(value: string | undefined): string | null {
  const safe = websiteUrl(value); if (!safe) return null;
  const u = new URL(safe);
  return u.hostname === "github.com" && !u.search && !u.hash && /^\/[A-Za-z0-9][A-Za-z0-9_-]{0,38}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/?$/.test(u.pathname) ? u.href : null;
}
function age(value: string | undefined): string { return value && Number.isFinite(Date.parse(value)) ? relTime(value) : "Not checked"; }
function connectionLabel(state: ConnectionState | undefined): string { return state === "connected" ? "Read-only connected" : state === "fake" ? "Fictional test" : state === "error" ? "Needs attention" : state === "not_connected" ? "Not connected" : "Checking"; }
async function websiteRequest(path: string, body?: unknown): Promise<WebsiteSnapshot> {
  const response = await fetch(`/api/websites${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let value: unknown; try { value = await response.json(); } catch { value = null; }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    // An authentication provider must never echo a pasted key into the page.
    const detail = path === "/lovable/connect" ? "Lovable could not be verified. Check the key’s read permission and workspace, then try again. Your previous connection has not been replaced by an unverified key." : value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "The website connection could not be updated.";
    throw new ApiError(response.status, detail);
  }
  if (!value || typeof value !== "object" || !("lovable" in value) || !value.lovable || typeof value.lovable !== "object" || !("projects" in value.lovable) || !Array.isArray(value.lovable.projects) || !("sites" in value) || !Array.isArray(value.sites)) throw new Error("The saved website connections could not be read. Refresh to try again.");
  return value as WebsiteSnapshot;
}

export function WebsiteConnections() {
  const [snapshot, setSnapshot] = useState<WebsiteSnapshot | null>(null);
  const [email, setEmail] = useState<AcquisitionMailProviders | null>(null);
  const [mailError, setMailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [siteName, setSiteName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [projectId, setProjectId] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const mounted = useRef(true);
  const lock = useRef(false);
  const serial = useRef(0);

  async function refreshSaved() {
    if (lock.current) return;
    const version = ++serial.current; setLoading(true);
    const results = await Promise.allSettled([websiteRequest(""), acquisition.mailProviders()]);
    if (!mounted.current || version !== serial.current) return;
    const sites = results[0], mail = results[1];
    if (sites.status === "fulfilled") { setSnapshot(sites.value); setError(null); } else setError(sites.reason instanceof Error ? sites.reason.message : "Website connections could not be loaded.");
    if (mail.status === "fulfilled") { setEmail(mail.value); setMailError(null); } else setMailError("Email connection status could not be checked. Open Studio to review the sender.");
    setLoading(false);
  }
  useEffect(() => { mounted.current = true; void refreshSaved(); return () => { mounted.current = false; serial.current++; }; }, []);
  async function mutate(label: string, path: string, body: unknown, detail: string): Promise<WebsiteSnapshot | null> {
    if (lock.current) return null;
    lock.current = true; serial.current++; setBusy(label); setError(null); setNotice(null);
    try { const next = await websiteRequest(path, body); if (mounted.current) { setSnapshot(next); setNotice(detail); } return next; }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "The website connection could not be updated."); return null; }
    finally { lock.current = false; if (mounted.current) { setBusy(null); setLoading(false); } }
  }
  async function connect(event: FormEvent) {
    event.preventDefault(); if (lock.current) return;
    const key = apiKey.trim(), workspace = workspaceId.trim();
    // Clear the secret from the visible field before waiting for the provider.
    setApiKey("");
    await mutate("connect", "/lovable/connect", { apiKey: key, ...(workspace ? { workspaceId: workspace } : {}) }, "Lovable workspace verified. Project status is available; this connection does not build or publish websites.");
  }
  async function addSite(event: FormEvent) {
    event.preventDefault();
    const url = websiteUrl(siteUrl.trim(), snapshot?.mode === "fake"), repo = repoUrl.trim(), project = projectId.trim();
    if (!url) { setError("Use a public HTTPS website address without sign-in details, tracking parameters or a private network address."); return; }
    if (repo && !repositoryUrl(repo)) { setError("Use the GitHub repository address in the form https://github.com/owner/repository."); return; }
    if (project && !PROJECT_ID.test(project)) { setError("Use the project ID from the end of its Lovable editor address."); return; }
    const next = await mutate("add", "/sites", { name: siteName.trim(), url, ...(project ? { lovableProjectId: project } : {}), ...(repo ? { repoUrl: repo } : {}) }, "Website saved. Use Check website to verify its public availability.");
    if (next && mounted.current) { setSiteName(""); setSiteUrl(""); setProjectId(""); setRepoUrl(""); }
  }
  const lovable = snapshot?.lovable;
  const selectedMail = email?.providers.find(item => item.id === email.selected);
  const linked = lovable?.state === "connected";

  return <section id="website-connections" className="wc-connections scroll-mt-24" aria-label="Email and website connections">
    <Card label="Connections" title={<span className="wc-title"><Link2 size={17} aria-hidden /> Email & websites</span>} action={<button type="button" className="btn-ghost !px-2.5 !py-1.5 text-xs" aria-label="Refresh saved connections" onClick={() => void refreshSaved()} disabled={loading || Boolean(busy)}><RefreshCw size={13} className={loading ? "wc-spinner" : ""} aria-hidden /></button>}>
      <p className="wc-intro">Link the accounts Jarvis can use from this private app. Connections in ChatGPT are separate from the accounts saved here.</p>
      <ErrorBanner message={error} />
      {notice && <p role="status" className="wc-notice"><CheckCheck size={15} aria-hidden />{notice}</p>}
      {snapshot?.mode === "fake" && <p className="wc-fixture">Fictional test mode. Connection and website results here are simulated; no real provider is contacted.</p>}
      <div className="wc-provider-grid">
        <article className="wc-provider wc-provider--email">
          <div className="wc-provider-heading"><div><span className="wc-icon"><Mail size={19} aria-hidden /></span><h3>Business email</h3></div><Chip tone={selectedMail?.status.state === "connected" ? "ok" : selectedMail?.status.state === "fake" ? "fake" : "neutral"}>{selectedMail?.status.state === "connected" ? "Sending connected" : selectedMail?.status.state === "fake" ? "Fictional test" : selectedMail?.status.state === "error" ? "Needs attention" : "Not connected"}</Chip></div>
          <p>Choose the mailbox or business-domain sender you want Jarvis to use.</p>
          {mailError && <p className="wc-inline-error" role="status">{mailError}</p>}
          {email && <div className="wc-mail-services">{email.providers.map(item => <div key={item.id}><span>{item.id === "resend" ? "Own domain · Resend" : "Gmail / Google Workspace"}{item.selected && <small>Selected</small>}</span><span className={`wc-service-state${item.status.state === "connected" ? " is-connected" : ""}`}>{item.status.state === "connected" ? "Connected" : item.status.state === "fake" ? "Fictional" : item.status.state === "error" ? "Needs attention" : "Not connected"}</span></div>)}</div>}
          <p className="wc-muted">{selectedMail?.status.detail ?? "Checking the configured sending services."}</p>
          <a href="#pipeline" className="wc-primary-link">Go to Studio email setup<ArrowUpRight size={14} aria-hidden /></a>
          <p className="wc-footnote">In Studio, open <strong>Sender settings</strong>. These connections send approved messages; inbox reading is a separate connection. Resend does not read your mailbox.</p>
        </article>
        <article className="wc-provider">
          <div className="wc-provider-heading"><div><span className="wc-icon"><FolderGit2 size={19} aria-hidden /></span><h3>Lovable workspace</h3></div><Chip tone={linked ? "ok" : lovable?.state === "fake" ? "fake" : lovable?.state === "error" ? "warn" : "neutral"}>{connectionLabel(lovable?.state)}</Chip></div>
          <p>Read your website project list and publishing status through a dedicated workspace key.</p>
          <p className="wc-muted">{lovable?.detail ?? "Loading the saved workspace connection."}</p>
          {lovable?.workspaceName && <p className="wc-workspace"><ShieldCheck size={13} aria-hidden /><span>{lovable.workspaceName}</span>{lovable.verifiedAt && <small>Verified {age(lovable.verifiedAt)}</small>}</p>}
          {linked && <div className="wc-actions"><button type="button" className="btn-ghost text-xs" onClick={() => void mutate("refresh", "/lovable/refresh", {}, "Lovable project status refreshed through a read-only request.")} disabled={Boolean(busy)}><RefreshCw size={13} className={busy === "refresh" ? "wc-spinner" : ""} aria-hidden />Refresh project list</button><button type="button" className="wc-disconnect" onClick={() => void mutate("disconnect", "/lovable/disconnect", {}, "Lovable disconnected from Jarvis. Your websites were not changed.")} disabled={Boolean(busy)}><Unplug size={12} aria-hidden />Disconnect Lovable</button></div>}
          <details className="wc-link-guide" open={!lovable || lovable.state !== "connected"}>
            <summary><KeyRound size={13} aria-hidden />{linked ? "Replace the workspace key" : "Link your Lovable workspace"}</summary>
            <ol><li>Open <a href="https://lovable.dev/settings/api-keys" target="_blank" rel="noreferrer">Lovable API settings<ExternalLink size={11} aria-hidden /></a>.</li><li>Create a dedicated workspace access key using the <strong>Read only</strong> preset. This feature requires an eligible Lovable plan.</li><li>Paste it below. Jarvis verifies the workspace and project list before saving the connection.</li></ol>
            <form onSubmit={event => void connect(event)} className="wc-form">
              <label>Lovable read-only API key<input type="password" className="input" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="new-password" spellCheck={false} maxLength={2048} disabled={Boolean(busy)} required placeholder="Paste the dedicated workspace key" /></label>
              <details className="wc-advanced"><summary>Choose a specific workspace</summary><label>Workspace ID (optional)<input className="input" value={workspaceId} onChange={event => setWorkspaceId(event.target.value)} maxLength={128} disabled={Boolean(busy)} placeholder="Only needed when a key can access several workspaces" /></label></details>
              <button type="submit" className="btn-accent wc-connect-button" disabled={Boolean(busy) || !apiKey.trim()}>{busy === "connect" ? <Loader2 size={14} className="wc-spinner" aria-hidden /> : <Link2 size={14} aria-hidden />}{busy === "connect" ? "Verifying workspace…" : "Verify & link Lovable"}</button>
            </form>
            <p className="wc-footnote"><ShieldCheck size={12} aria-hidden />The key is encrypted on the server. It is not stored in this browser or returned by this form.</p>
          </details>
          <p className="wc-capability"><ShieldCheck size={13} aria-hidden />Project list & status. Building, code editing and deployment need a separate authorised connection.</p>
        </article>
      </div>

      <div className="wc-sites-heading"><div><h3>Your websites</h3><p>Keep the public website and its project references together.</p></div><span>{snapshot?.sites.length ?? 0} saved</span></div>
      {loading && !snapshot ? <p role="status" className="wc-empty"><Loader2 size={16} className="wc-spinner" aria-hidden />Loading website connections…</p> : snapshot?.sites.length ? <div className="wc-site-grid">{snapshot.sites.map(site => {
        const url = websiteUrl(site.url, snapshot?.mode === "fake"), editor = editorUrl(site.lovableProjectId), repository = repositoryUrl(site.repoUrl);
        const project = linked && site.lovableProjectId ? lovable.projects.find(item => item.id === site.lovableProjectId) : undefined;
        const state = site.check.state, stateText = state === "reachable" ? "Public page reachable" : state === "unreachable" ? "Unreachable at last check" : state === "error" ? "Check needs attention" : state === "fake" ? "Fictional check" : "Not checked";
        return <article className="wc-site" key={site.id}><div className="wc-site-heading"><span className="wc-icon"><Globe2 size={18} aria-hidden /></span><div><h4>{site.name}</h4>{url ? <a href={url} target="_blank" rel="noreferrer">{new URL(url).hostname}<ArrowUpRight size={11} aria-hidden /></a> : <p>Website address needs review.</p>}</div></div><Chip tone={state === "reachable" ? "ok" : state === "unreachable" || state === "error" ? "warn" : state === "fake" ? "fake" : "neutral"}>{stateText}</Chip><p className="wc-site-detail">{site.check.detail}</p>{site.check.checkedAt && <p className="wc-footnote">Public check {age(site.check.checkedAt)}{site.check.status ? ` · HTTP ${site.check.status}` : ""}</p>}{project && <p className="wc-project-proof"><ShieldCheck size={12} aria-hidden />Workspace project: {project.name}</p>}<div className="wc-site-links">{url && <a href={url} target="_blank" rel="noreferrer">Open website<ArrowUpRight size={11} aria-hidden /></a>}{editor && <a href={editor} target="_blank" rel="noreferrer">Lovable project<ArrowUpRight size={11} aria-hidden /></a>}{repository && <a href={repository} target="_blank" rel="noreferrer">Repository<ArrowUpRight size={11} aria-hidden /></a>}</div><button type="button" className="btn-ghost wc-check-button" onClick={() => void mutate(`check:${site.id}`, `/sites/${encodeURIComponent(site.id)}/check`, {}, "Public website check finished. Review its reported result below.")} disabled={Boolean(busy) || !url}>{busy === `check:${site.id}` ? <Loader2 size={13} className="wc-spinner" aria-hidden /> : <RefreshCw size={13} aria-hidden />}Check website</button></article>;
      })}</div> : <p className="wc-empty"><Globe2 size={19} aria-hidden />No websites saved yet. Add your own website below; a saved address starts as unchecked.</p>}

      <details className="wc-projects"><summary><FolderGit2 size={14} aria-hidden />Lovable projects {lovable?.projects.length ? `(${lovable.projects.length})` : ""}</summary>{lovable?.projects.length ? <><p className="wc-footnote">{linked ? "Verified workspace metadata." : "Saved metadata; refresh a verified connection to check current status."} {lovable.truncated ? "The provider returned a limited list; more projects may exist." : ""}</p><ul>{lovable.projects.map(project => { const editor = editorUrl(project.id); return <li key={project.id}><div><strong>{project.name}</strong><span>{project.isPublished ? "Published according to Lovable" : "Not published according to Lovable"}{project.lastEditedAt ? ` · edited ${age(project.lastEditedAt)}` : ""}</span></div>{editor && <a href={editor} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} in Lovable`}><ArrowUpRight size={15} aria-hidden /></a>}</li>; })}</ul></> : <p className="wc-footnote">Connect a verified workspace to read its project list. Opening the editor is separate from allowing Jarvis to edit or publish.</p>}</details>

      <details className="wc-add-site"><summary><Link2 size={14} aria-hidden />Add your website</summary><form className="wc-form" onSubmit={event => void addSite(event)}><div className="wc-field-grid"><label>Website name<input className="input" value={siteName} onChange={event => setSiteName(event.target.value)} maxLength={160} disabled={Boolean(busy)} required placeholder="Your business name" /></label><label>Public website URL<input className="input" type="url" value={siteUrl} onChange={event => setSiteUrl(event.target.value)} maxLength={2000} disabled={Boolean(busy)} required placeholder="https://your-website.com.au" /></label></div><details className="wc-advanced"><summary>Add project or repository references</summary><div className="wc-field-grid"><label>Lovable project ID (optional)<input className="input" value={projectId} onChange={event => setProjectId(event.target.value)} maxLength={128} disabled={Boolean(busy)} placeholder="Project ID from its editor URL" /></label><label>GitHub repository URL (optional)<input className="input" type="url" value={repoUrl} onChange={event => setRepoUrl(event.target.value)} maxLength={2000} disabled={Boolean(busy)} placeholder="https://github.com/owner/repository" /></label></div></details><button type="submit" className="btn-ghost" disabled={Boolean(busy) || !siteName.trim() || !siteUrl.trim()}><Link2 size={13} aria-hidden />Save website</button><p className="wc-footnote">Saving references does not grant access to private repositories, customer records, website editing or deployment.</p></form></details>
    </Card>
  </section>;
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, CheckCheck, ChevronDown, Copy, FileJson, Inbox, KeyRound, Loader2, Mail, RefreshCw, Search, ShieldCheck, Unplug } from "lucide-react";
import { mail, safeGoogleLink, type InboxPage, type MailSnapshot, type ReadMailMessage } from "../mail-client";
import "./gmail-connection.css";

const READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,128}$/;
interface WebClientFile { clientId: string; clientSecret: string }
export function readGoogleClientJson(value: unknown, callback: string): WebClientFile {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("web" in value) || !value.web || typeof value.web !== "object" || Array.isArray(value.web)) throw new Error("Choose the JSON file for a Google Web application client. Desktop/installed app credentials cannot use this hosted callback.");
  const client = value.web as Record<string, unknown>;
  if (typeof client.client_id !== "string" || !client.client_id.endsWith(".apps.googleusercontent.com") || client.client_id.length > 512 || /\s/.test(client.client_id) || typeof client.client_secret !== "string" || !client.client_secret.trim() || client.client_secret.length > 1024 || /[\r\n]/.test(client.client_secret)) throw new Error("The selected file does not contain valid Google web client settings.");
  if (!Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(callback)) throw new Error("Add this Jarvis callback to the Google client's authorised redirect URIs, then download the updated JSON file.");
  return { clientId: client.client_id, clientSecret: client.client_secret.trim() };
}
function when(value: string | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Date unavailable";
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
export function GmailConnection({ onChanged }: { onChanged?: () => void }) {
  const [snapshot, setSnapshot] = useState<MailSnapshot | null>(null);
  const [email, setEmail] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(20);
  const [inbox, setInbox] = useState<InboxPage | null>(null);
  const [selected, setSelected] = useState<ReadMailMessage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const mounted = useRef(true), lock = useRef(false), serial = useRef(0);
  const current = useRef<MailSnapshot | null>(null);
  const changed = useRef(onChanged); changed.current = onChanged;
  const config = snapshot?.configuration;
  const inboxReady = Boolean(config?.inboxReady && snapshot?.status.state === "connected");
  const fake = snapshot?.mode === "fake";
  const callback = config?.redirectUri || `${window.location.origin}/integrations/google/callback`;
  const settingsDirty = Boolean(snapshot && email.trim().toLowerCase() !== (config?.expectedEmail ?? "").toLowerCase());
  function adopt(next: MailSnapshot) {
    const prior = current.current;
    if (next.status.state !== "connected" || !next.configuration.inboxReady || prior?.configuration.linkedEmail !== next.configuration.linkedEmail || prior?.configuration.expectedEmail !== next.configuration.expectedEmail) { setInbox(null); setSelected(null); }
    current.current = next; setSnapshot(next); setEmail(next.configuration.expectedEmail ?? "");
  }
  async function refreshStatus() {
    if (lock.current) return;
    const generation = ++serial.current; setError(null); setBusy("status");
    try { const next = await mail.snapshot(); if (mounted.current && generation === serial.current) adopt(next); }
    catch (e) { if (mounted.current && generation === serial.current) setError(e instanceof Error ? e.message : "The Gmail connection could not be checked."); }
    finally { if (mounted.current && generation === serial.current) setBusy(null); }
  }
  useEffect(() => { mounted.current = true; void refreshStatus(); return () => { mounted.current = false; serial.current++; }; }, []);
  async function mutate(label: string, action: () => Promise<MailSnapshot>, detail: string) {
    if (lock.current) return;
    lock.current = true; serial.current++; setBusy(label); setError(null); setNotice(null);
    try { const next = await action(); if (mounted.current) { adopt(next); setNotice(detail); changed.current?.(); } }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "The Gmail connection could not be updated."); }
    finally { lock.current = false; if (mounted.current) setBusy(null); }
  }
  async function saveSettings(event: FormEvent) {
    event.preventDefault(); await mutate("mailbox", () => mail.settings(email.trim()), "Mailbox saved. Google must verify this exact address before it can be used.");
  }
  async function readFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
    if (!file) return;
    setError(null); setFileNotice(null);
    if (file.size > 20 * 1024 || !file.size) { setError("Choose the Google web client JSON file smaller than 20 KB."); return; }
    try {
      const parsed = readGoogleClientJson(JSON.parse(await file.text()), callback);
      if (!mounted.current) return;
      setClientId(parsed.clientId); setClientSecret(parsed.clientSecret); setFileNotice("Google web client loaded on this device. Save Google app settings below to store it privately in Jarvis.");
    } catch (e) { if (mounted.current) { setClientId(""); setClientSecret(""); setError(e instanceof SyntaxError ? "That file is not valid JSON. Download the Web application client's JSON from Google Cloud." : e instanceof Error ? e.message : "The Google client file could not be read."); } }
  }
  async function saveConfig(event: FormEvent) {
    event.preventDefault(); if (lock.current) return;
    const id = clientId.trim(), secret = clientSecret.trim();
    setClientId(""); setClientSecret(""); setFileNotice(null);
    await mutate("config", () => mail.configure(id, secret), "Google app settings saved. Choose Connect Gmail and sign in to the selected mailbox.");
  }
  async function connect() {
    if (lock.current || !config?.configured || !config.expectedEmail || settingsDirty || fake) return;
    lock.current = true; serial.current++; setBusy("link"); setError(null); setNotice(null);
    try { const result = await mail.link(); const url = safeGoogleLink(result.url); if (!url) throw new Error("The sign-in link was not a verified Google authorisation address. Refresh and try again."); if (mounted.current) window.location.assign(url); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Google sign-in could not start."); }
    finally { lock.current = false; if (mounted.current) setBusy(null); }
  }
  async function readInbox(event?: FormEvent) {
    event?.preventDefault(); if (lock.current || !inboxReady || settingsDirty) return;
    lock.current = true; const generation = ++serial.current; setBusy("inbox"); setError(null); setNotice(null); setSelected(null);
    try { const next = await mail.inbox(limit, query); if (mounted.current && generation === serial.current) setInbox(next); }
    catch (e) { if (mounted.current && generation === serial.current) { setInbox(null); setError(e instanceof Error ? e.message : "The inbox could not be read."); } }
    finally { lock.current = false; if (mounted.current && generation === serial.current) setBusy(null); }
  }
  async function openMessage(id: string) {
    if (lock.current || !inboxReady || settingsDirty || !MESSAGE_ID.test(id)) return;
    lock.current = true; const generation = ++serial.current; setBusy(`message:${id}`); setError(null); setSelected(null);
    try { const next = await mail.message(id); if (mounted.current && generation === serial.current) setSelected(next); }
    catch (e) { if (mounted.current && generation === serial.current) setError(e instanceof Error ? e.message : "That message could not be read."); }
    finally { lock.current = false; if (mounted.current && generation === serial.current) setBusy(null); }
  }
  async function copyCallback() {
    try { await navigator.clipboard.writeText(callback); setCopied(true); } catch { setError("Copy was unavailable. Select the callback address and copy it manually."); }
  }
  const state = fake ? "Fictional test mode" : inboxReady ? "Inbox connected" : config?.requiresRelink ? "Reconnect for inbox access" : snapshot?.status.state === "error" ? "Needs attention" : config?.configured ? "Ready for Google sign-in" : "Google app setup needed";
  return <section className="gm-panel" id="gmail-connection" aria-label="Gmail sending and inbox connection">
    <header className="gm-heading"><div><span className="gm-icon"><Mail size={19} aria-hidden /></span><div><h3>Gmail for your business</h3><p>Connect one chosen mailbox for inbox reading and approved outgoing email.</p></div></div><span className={`gm-state${inboxReady ? " is-connected" : ""}`}>{state}</span></header>
    {error && <p className="gm-error" role="alert">{error}</p>}
    {notice && <p className="gm-notice" role="status"><CheckCheck size={15} aria-hidden />{notice}</p>}
    {fake && <p className="gm-fixture">Fictional test mode. Mail and connection results are not live email.</p>}
    <div className="gm-status"><p>{snapshot?.status.detail ?? "Checking saved Google connection settings."}</p>{config?.linkedEmail && <p><strong>Google verified:</strong> {config.linkedEmail}</p>}{config?.requiresRelink && <p>Your previous connection does not grant inbox reading. Reconnect and approve both requested Gmail permissions.</p>}</div>
    <form className="gm-mailbox-form" onSubmit={event => void saveSettings(event)}><label>Gmail address Jarvis should use<input type="email" className="input" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} autoComplete="email" required disabled={Boolean(busy) || !snapshot} placeholder="Your business Gmail address" /></label><button type="submit" className="btn-ghost" disabled={Boolean(busy) || !snapshot || !email.trim()}>{busy === "mailbox" ? <Loader2 size={14} className="gm-spinner" aria-hidden /> : <ShieldCheck size={14} aria-hidden />}Save mailbox</button></form>
    {settingsDirty && <p className="gm-note">Save the chosen mailbox before linking or reading messages.</p>}
    <div className="gm-connect-actions"><button type="button" className="btn-accent" disabled={Boolean(busy) || !config?.configured || !config.expectedEmail || settingsDirty || fake} onClick={() => void connect()}>{busy === "link" ? <Loader2 size={15} className="gm-spinner" aria-hidden /> : <Mail size={15} aria-hidden />}{config?.requiresRelink || config?.linkedEmail ? "Reconnect Gmail" : "Connect Gmail"}<ArrowUpRight size={13} aria-hidden /></button><button type="button" className="btn-ghost text-xs" disabled={Boolean(busy)} onClick={() => void refreshStatus()}><RefreshCw size={13} className={busy === "status" ? "gm-spinner" : ""} aria-hidden />Check connection</button>{config?.linkedEmail && <button type="button" className="gm-disconnect" disabled={Boolean(busy)} onClick={() => void mutate("disconnect", () => mail.disconnect(), "Gmail disconnected from Jarvis. Review Google account permissions separately to revoke the grant there.")}><Unplug size={13} aria-hidden />Disconnect</button>}</div>
    <p className="gm-note">Choose the saved address during Google sign-in. Jarvis rejects a different account. Linking sends no email.</p>
    <details className="gm-setup" open={snapshot ? !config?.configured : undefined}>
      <summary><KeyRound size={15} aria-hidden />One-time Google app setup<ChevronDown size={14} aria-hidden /></summary>
      <ol className="gm-steps"><li><strong>Enable the Gmail API in Google Cloud.</strong><p>Create or select a project while signed in to the account that will own this connection.</p><a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noreferrer">Open Gmail API setup<ArrowUpRight size={12} aria-hidden /></a></li><li><strong>Configure Google Auth Platform.</strong><p>For a personal Gmail account, use External / Testing, add the chosen mailbox as a test user, and request OpenID/email plus these Gmail scopes:</p><div className="gm-code-list"><code>{READ_SCOPE}</code><code>{SEND_SCOPE}</code></div>{config?.expectedEmail && <p className="gm-test-user">Test user: <strong>{config.expectedEmail}</strong></p>}<a href="https://console.cloud.google.com/auth/audience" target="_blank" rel="noreferrer">Open audience and test users<ArrowUpRight size={12} aria-hidden /></a></li><li><strong>Create a Web application OAuth client.</strong><p>Add this exact authorised redirect URI, then download its JSON file:</p><div className="gm-callback"><code>{callback}</code><button type="button" aria-label="Copy Gmail callback" onClick={() => void copyCallback()}><Copy size={13} aria-hidden />{copied ? "Copied" : "Copy"}</button></div><a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">Open Google OAuth clients<ArrowUpRight size={12} aria-hidden /></a></li><li><strong>Load the downloaded JSON here.</strong><p>The file is read on this device. Only its client ID and client secret are sent to your private Jarvis server when you choose Save.</p><label className="gm-file"><FileJson size={16} aria-hidden /><span>Choose Google web client JSON</span><input type="file" accept="application/json,.json" onChange={event => void readFile(event)} disabled={Boolean(busy)} aria-label="Choose Google web client JSON" /></label>{fileNotice && <p className="gm-note" role="status">{fileNotice}</p>}<form className="gm-config-form" onSubmit={event => void saveConfig(event)}><label>Google web client ID<input className="input" value={clientId} onChange={event => setClientId(event.target.value)} maxLength={512} autoComplete="off" spellCheck={false} required disabled={Boolean(busy)} placeholder="…apps.googleusercontent.com" /></label><label>Google client secret<input className="input" type="password" value={clientSecret} onChange={event => setClientSecret(event.target.value)} maxLength={1024} autoComplete="new-password" spellCheck={false} required disabled={Boolean(busy)} placeholder="Paste only into this private field" /></label><button type="submit" className="btn-ghost" disabled={Boolean(busy) || !clientId.trim() || !clientSecret.trim()}>{busy === "config" ? <Loader2 size={14} className="gm-spinner" aria-hidden /> : <ShieldCheck size={14} aria-hidden />}Save Google app settings</button></form></li><li><strong>Connect Gmail above.</strong><p>Choose the exact saved mailbox and approve reading email plus sending messages. Google handles your sign-in; no Google password belongs in Jarvis.</p></li></ol><p className="gm-note">Google apps in Testing may need reconnection after seven days. Google publication/verification requirements apply to lasting access. This setup does not purchase a subscription.</p>
    </details>
    <section className="gm-inbox" aria-label="Gmail inbox">
      <div className="gm-inbox-heading"><div><Inbox size={17} aria-hidden /><h4>Your inbox</h4></div><span>Read only</span></div>
      <p className="gm-note">Messages load when you ask. Opening a message does not change its Gmail labels. Images and attachments are not downloaded here.</p>
      <form className="gm-inbox-search" onSubmit={event => void readInbox(event)}><label>Filter inbox<input className="input" value={query} onChange={event => setQuery(event.target.value)} maxLength={200} disabled={Boolean(busy) || !inboxReady} placeholder="Optional Gmail search, e.g. newer_than:7d" /></label><label>Messages<select className="input" value={limit} onChange={event => setLimit(Number(event.target.value))} disabled={Boolean(busy) || !inboxReady}>{[5, 10, 20].map(value => <option key={value} value={value}>{value}</option>)}</select></label><button type="submit" className="btn-ghost" disabled={Boolean(busy) || !inboxReady || settingsDirty}>{busy === "inbox" ? <Loader2 size={14} className="gm-spinner" aria-hidden /> : <Search size={14} aria-hidden />}Refresh inbox</button></form>
      {!inboxReady && <p className="gm-empty">Connect the chosen Gmail account with inbox permission to read messages here.</p>}
      {inboxReady && !inbox && busy !== "inbox" && <p className="gm-empty">Your inbox has not been loaded. Choose Refresh inbox when you want Jarvis to read it.</p>}
      {inbox && <><p className="gm-note">{inbox.messages.length} message{inbox.messages.length === 1 ? "" : "s"} from {inbox.mailbox}.{inbox.nextPageAvailable ? " More matching messages are available in Gmail." : ""}</p><div className="gm-mail-view"><div className="gm-message-list" aria-label="Inbox messages">{inbox.messages.length ? inbox.messages.map(message => <button type="button" key={message.id} className={`gm-message-row${selected?.id === message.id ? " is-selected" : ""}${message.unread ? " is-unread" : ""}`} onClick={() => void openMessage(message.id)} disabled={Boolean(busy) || !MESSAGE_ID.test(message.id)} aria-pressed={selected?.id === message.id}><span className="gm-message-meta"><strong>{message.from || "Sender unavailable"}</strong><time>{when(message.date)}</time></span><span className="gm-subject">{message.subject || "(No subject)"}</span><span className="gm-snippet">{message.snippet}</span>{message.unread && <small>Unread in Gmail</small>}</button>) : <p className="gm-empty">No messages matched this inbox filter.</p>}</div><article className="gm-message-detail" aria-label="Selected email">{busy?.startsWith("message:") ? <p className="gm-empty" role="status"><Loader2 size={16} className="gm-spinner" aria-hidden />Reading message…</p> : selected ? <><h5>{selected.subject || "(No subject)"}</h5><dl><div><dt>From</dt><dd>{selected.from}</dd></div><div><dt>To</dt><dd>{selected.to}</dd></div><div><dt>Date</dt><dd>{when(selected.date)}</dd></div></dl><pre className="gm-message-body">{selected.text || selected.snippet || "No readable message text was returned."}</pre>{(selected.htmlOmitted || selected.attachmentsOmitted > 0 || selected.contentTruncated) && <p className="gm-note">{selected.htmlOmitted ? "HTML is shown as plain text. " : ""}{selected.attachmentsOmitted ? `${selected.attachmentsOmitted} attachment${selected.attachmentsOmitted === 1 ? "" : "s"} omitted. ` : ""}{selected.contentTruncated ? "Long message text was shortened." : ""}</p>}</> : <p className="gm-empty">Choose a message to read its plain text.</p>}</article></div></>}
      <p className="gm-inbox-footer">Outgoing messages are reviewed in <a href="#pipeline">Studio → Email preview</a>. This panel has no send, archive, delete or mark-read action.</p>
    </section>
  </section>;
}

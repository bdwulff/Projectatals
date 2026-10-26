import { useEffect, useRef, useState, type FormEvent } from "react";
import { BellRing, Mail, MessageCircle, Send, ShieldCheck } from "lucide-react";
import { ApiError, SESSION_EXPIRED_EVENT, relTime } from "../api";
import { Card, Chip, ErrorBanner } from "./ui";

interface Settings { email: string; emailEnabled: boolean; messageEnabled: boolean; dailyDigest: boolean }
interface Channel { state: "connected" | "not_connected" | "error" | "fake"; provider: string; detail: string; sender?: string; botUsername?: string; chatId?: string }
interface Snapshot { settings: Settings; email: Channel; message: Channel; schedule: string; recent: { id: string; channel: string; kind: string; state: string; at: string; detail: string }[] }
interface Delivery { accepted: boolean; simulated: boolean; detail: string }
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/owner-updates${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) { if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)); throw new ApiError(response.status, typeof result?.error === "string" ? result.error : "Owner updates could not be saved."); }
  return result as T;
}
const blank: Settings = { email: "", emailEnabled: false, messageEnabled: false, dailyDigest: false };
export function OwnerUpdates() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [settings, setSettings] = useState<Settings>(blank);
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);
  const lock = useRef(false);
  function adopt(next: Snapshot) { setSnapshot(next); setSettings(next.settings); }
  useEffect(() => { mounted.current = true; void request<Snapshot>("").then(next => { if (mounted.current) adopt(next); }).catch(e => { if (mounted.current) setError(e instanceof Error ? e.message : "Could not load owner updates."); }); return () => { mounted.current = false; }; }, []);
  async function run(action: () => Promise<{ snapshot: Snapshot; detail?: string }>) {
    if (lock.current) return; lock.current = true; setBusy(true); setError(null); setNotice(null);
    try { const next = await action(); if (mounted.current) { adopt(next.snapshot); if (next.detail) setNotice(next.detail); } }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "That owner update could not finish."); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const saved = Boolean(snapshot && JSON.stringify(settings) === JSON.stringify(snapshot.settings));
  const connected = (channel: Channel | undefined) => channel?.state === "connected" || channel?.state === "fake";
  const test = (channel: "email" | "message") => run(async () => { const result = await request<{ snapshot: Snapshot; result: Delivery }>("/test", { channel }); return { snapshot: result.snapshot, detail: `${result.result.simulated ? "Fictional test: " : ""}${result.result.detail}` }; });
  return <section id="owner-updates" className="space-y-4 scroll-mt-24">
    <Card label="Owner updates" title={<span className="inline-flex items-center gap-2"><BellRing className="h-4 w-4 text-accent-soft" aria-hidden /> Keep me informed</span>}>
      <p className="mb-4 text-sm leading-relaxed text-slate-300">Receive action alerts and a morning summary on your own email and phone. Connect the channels you want, save your preferences, then send yourself a test.</p>
      <ErrorBanner message={error} />
      {notice && <p role="status" className="mb-4 rounded-xl border border-accent/30 bg-accent/5 p-3 text-sm text-accent-soft">{notice}</p>}
      <form className="space-y-4" onSubmit={(event: FormEvent) => { event.preventDefault(); void run(async () => ({ snapshot: await request<Snapshot>("/settings", settings), detail: "Owner update preferences saved." })); }}>
        <label className="block text-sm text-slate-300">My email for updates<input className="input mt-1" type="email" value={settings.email} onChange={e => setSettings(s => ({ ...s, email: e.target.value }))} maxLength={254} disabled={busy || !snapshot} placeholder="Your own email address" autoComplete="email" required={settings.emailEnabled} /></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="flex gap-2 text-sm text-slate-300"><input type="checkbox" checked={settings.emailEnabled} onChange={e => setSettings(s => ({ ...s, emailEnabled: e.target.checked }))} disabled={busy || !snapshot} />Email me action alerts</label><label className="flex gap-2 text-sm text-slate-300"><input type="checkbox" checked={settings.messageEnabled} onChange={e => setSettings(s => ({ ...s, messageEnabled: e.target.checked }))} disabled={busy || !snapshot || !connected(snapshot.message)} />Message me action alerts</label></div>
        <label className="flex gap-2 text-sm text-slate-300"><input type="checkbox" checked={settings.dailyDigest} onChange={e => setSettings(s => ({ ...s, dailyDigest: e.target.checked }))} disabled={busy || !snapshot} />Include a daily summary after 9 am Melbourne time</label>
        <button className="btn-accent" type="submit" disabled={busy || !snapshot}>{busy ? "Working…" : "Save update preferences"}</button>
      </form>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.02] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="inline-flex items-center gap-2 text-sm text-slate-100"><Mail className="h-4 w-4" aria-hidden />Email</span><Chip tone={snapshot?.email.state === "connected" ? "ok" : "neutral"}>{snapshot?.email.state?.replaceAll("_", " ") ?? "Checking"}</Chip></div><p className="mt-2 break-words text-xs leading-relaxed text-slate-400">{snapshot?.email.detail ?? "Checking the sending connection."}</p><p className="mt-2 text-xs text-slate-400">Uses your selected sender in <a href="#pipeline" className="text-accent-soft underline">Studio → Sender settings</a>. Your update recipient can use any email provider.</p><button type="button" className="btn-ghost mt-3 text-xs" disabled={busy || !saved || !snapshot?.settings.emailEnabled || !connected(snapshot.email)} onClick={() => void test("email")}><Send className="h-3.5 w-3.5" aria-hidden />Send me a test email</button></div>
        <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.02] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="inline-flex items-center gap-2 text-sm text-slate-100"><MessageCircle className="h-4 w-4" aria-hidden />Telegram messages</span><Chip tone={snapshot?.message.state === "connected" ? "ok" : "neutral"}>{snapshot?.message.state?.replaceAll("_", " ") ?? "Checking"}</Chip></div><p className="mt-2 break-words text-xs leading-relaxed text-slate-400">{snapshot?.message.detail ?? "Checking the message connection."}</p>{snapshot?.message.botUsername && <p className="mt-2 break-all text-xs text-slate-300">@{snapshot.message.botUsername} · private chat {snapshot.message.chatId}</p>}<button type="button" className="btn-ghost mt-3 text-xs" disabled={busy || !saved || !snapshot?.settings.messageEnabled || !connected(snapshot.message)} onClick={() => void test("message")}><Send className="h-3.5 w-3.5" aria-hidden />Send me a test message</button></div>
      </div>
      <details className="mt-4 rounded-xl border border-white/10 p-4"><summary className="cursor-pointer text-sm text-slate-200">Connect free Telegram messages</summary><ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-slate-400"><li>In Telegram, open the verified <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-accent-soft underline">@BotFather</a>, send <code>/newbot</code> and follow its prompts. Copy the bot token into the private field below.</li><li>Open your new bot and press Start. In Telegram, <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="text-accent-soft underline">@userinfobot</a> can show your numeric user/chat ID. This is a third-party helper; do not send it your bot token. Use your own positive numeric private ID.</li><li>Connect here, enable message updates above, save preferences and send yourself a test. Telegram bot chats are cloud messages.</li></ol><form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); void run(async () => { const next = await request<Snapshot>("/telegram/connect", { token: token.trim(), chatId: chatId.trim() }); setToken(""); return { snapshot: next, detail: "Private chat verified. Enable message updates and save before sending a test." }; }); }}><label className="block text-sm text-slate-300">Bot token<input className="input mt-1" type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="new-password" maxLength={180} required disabled={busy} /></label><label className="block text-sm text-slate-300">My private chat ID<input className="input mt-1" value={chatId} onChange={e => setChatId(e.target.value)} inputMode="numeric" pattern="[1-9][0-9]{3,19}" maxLength={20} required disabled={busy} placeholder="Positive numeric ID" /></label><div className="flex flex-wrap gap-2"><button type="submit" className="btn-ghost" disabled={busy || !token.trim() || !chatId.trim()}>Verify private connection</button>{snapshot?.message.state === "connected" && <button type="button" className="btn-ghost" disabled={busy} onClick={() => void run(async () => ({ snapshot: await request<Snapshot>("/telegram/disconnect", {}), detail: "Telegram disconnected in Jarvis." }))}>Disconnect Telegram</button>}</div><p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />The token is encrypted on the server and never returned by this form. Do not paste it into chat.</p></form></details>
      <p className="mt-4 text-xs leading-relaxed text-slate-500">{snapshot?.schedule} SMS and phone calls need a connected paid telephony provider; they are not enabled by this Telegram setup.</p>
      {snapshot?.recent.length ? <details className="mt-4"><summary className="cursor-pointer text-sm text-slate-300">Recent owner updates</summary><ul className="mt-3 space-y-2">{snapshot.recent.map(item => <li key={item.id} className="rounded-lg border border-white/10 p-3"><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-slate-200">{item.channel} · {item.kind} · {item.state.replaceAll("_", " ")}</span><span className="text-slate-500">{relTime(item.at)}</span></div><p className="mt-1 break-words text-xs text-slate-400">{item.detail}</p></li>)}</ul></details> : null}
    </Card>
  </section>;
}

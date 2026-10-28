import { useEffect, useRef, useState } from "react";
import { Copy, Download, Globe2, Laptop, Link2, ShieldCheck, Unlink } from "lucide-react";
import { api, melbourneTime, relTime, type DeviceAction, type DevicePairing, type DeviceState, type DeviceTask, type PairedDevice } from "../api";
import { useNow, usePoll } from "../hooks";
import { Card, Chip, Empty, ErrorBanner, Loading, RefreshButton } from "../components/ui";
import { OwnerUpdates } from "../components/OwnerUpdates";
import { WebsiteConnections } from "../components/WebsiteConnections";

const ACTION_LABELS: Record<DeviceAction, string> = { "device.status": "Read Mac status", "browser.open": "Open a website", "apps.open": "Open an enabled app" };
const MAC_APPS = [{ id: "calculator", label: "Calculator" }, { id: "notes", label: "Notes" }, { id: "calendar", label: "Calendar" }];

function seenLabel(device: PairedDevice, now: Date) {
  if (!device.lastSeenAt || !Number.isFinite(Date.parse(device.lastSeenAt))) return "Companion has not checked in yet";
  const age = now.getTime() - Date.parse(device.lastSeenAt);
  return age < 90_000 ? "Companion checked in recently" : `Last check-in ${relTime(device.lastSeenAt)}`;
}

function taskDetail(task: DeviceTask) {
  if (task.status === "queued") return "Waiting for your Mac. Keep it awake with the Jarvis companion running.";
  if (task.status === "leased") return "Your Mac accepted this task. Its result is not confirmed yet.";
  if (task.status === "expired") return "No completed result was received before expiry. Check your Mac before requesting the action again.";
  if (task.status === "failed") return "Your Mac reported a failure. Review its local permissions and enabled actions before trying again.";
  return task.action === "device.status" ? "Your Mac returned a status result." : "Your Mac reported the launch request finished. Activity inside the opened page or app is not verified.";
}

function safeResult(result: unknown): string | null {
  if (typeof result === "string") return result.slice(0, 1200);
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    for (const key of ["detail", "message", "operatingSystem", "platform"]) {
      if (typeof r[key] === "string") return r[key].slice(0, 1200);
    }
  }
  return null;
}

export function Devices() {
  const devices = usePoll<DeviceState>(() => api.devices(), [], 5000);
  const now = useNow(1000);
  const [deviceName, setDeviceName] = useState("My Mac");
  const [allowBrowser, setAllowBrowser] = useState(true);
  const [allowApps, setAllowApps] = useState(false);
  const [pairing, setPairing] = useState<DevicePairing | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [url, setUrl] = useState("https://");
  const [appId, setAppId] = useState("calculator");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  // An ambiguous POST can be retried with the same ID instead of launching twice.
  const requestIds = useRef(new Map<string, string>());

  useEffect(() => {
    if (!selectedId && devices.data?.devices.length) setSelectedId(devices.data.devices.find(d => !d.revokedAt)?.id ?? devices.data.devices[0]!.id);
  }, [selectedId, devices.data]);
  useEffect(() => {
    if (pairing && Date.parse(pairing.expiresAt) <= now.getTime()) setPairing(null);
  }, [now, pairing]);

  const selected = devices.data?.devices.find(d => d.id === selectedId);
  const active = selected && !selected.revokedAt;
  const supports = (action: DeviceAction) => Boolean(active && selected.allowedActions.includes(action));
  const tasks = [...(devices.data?.tasks ?? [])].filter(t => !selectedId || t.deviceId === selectedId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);

  async function createPairing() {
    setError(null); setNotice(null); setBusy("pair"); setCopied(false); setPairing(null);
    try {
      const allowedActions: DeviceAction[] = ["device.status", ...(allowBrowser ? ["browser.open" as const] : []), ...(allowApps ? ["apps.open" as const] : [])];
      setPairing(await api.pairDevice(deviceName.trim(), allowedActions));
    } catch (e) { setError(e instanceof Error ? e.message : "Pairing could not be created."); }
    finally { setBusy(null); }
  }

  async function sendTask(action: DeviceAction, payload: Record<string, unknown>) {
    if (!selected || !supports(action)) return;
    setBusy(action); setError(null); setNotice(null);
    const key = JSON.stringify([selected.id, action, payload]);
    try {
      let requestId = requestIds.current.get(key);
      if (!requestId) { requestId = crypto.randomUUID(); requestIds.current.set(key, requestId); }
      const { task } = await api.deviceTask(selected.id, action, payload, requestId);
      requestIds.current.delete(key);
      setNotice(task.status === "queued" ? "Task queued for your Mac. Its result will appear below." : taskDetail(task));
      await devices.refresh();
    } catch (e) { setError(`${e instanceof Error ? e.message : "Task could not be confirmed."} Trying the same action again will reuse its request ID.`); }
    finally { setBusy(null); }
  }

  async function copyPairCode() {
    if (!pairing) return;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(pairing.pairCode); setCopied(true);
    } catch { setError("Copy was unavailable. Select the code and copy it manually."); }
  }

  async function downloadCompanion() {
    setBusy("download"); setError(null); setNotice(null);
    try {
      const blob = await api.downloadMacCompanion();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl; link.download = "Jarvis-Mac.zip";
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000);
      setNotice("Companion ZIP prepared. On your Mac, unzip it and open the Jarvis launcher before pairing.");
    } catch (e) { setError(e instanceof Error ? e.message : "Companion download could not be prepared."); }
    finally { setBusy(null); }
  }

  async function revoke(device: PairedDevice) {
    setBusy(`revoke:${device.id}`); setError(null); setNotice(null);
    try {
      await api.revokeDevice(device.id); setRevokeId(null);
      setNotice(`${device.name} access revoked. It can no longer receive new tasks.`);
      await devices.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Revocation was not confirmed."); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <WebsiteConnections />
      <OwnerUpdates />
      <header className="flex items-end justify-between gap-3">
        <div><div className="label">Your devices</div><h1 className="mt-0.5 text-xl font-medium text-slate-50">Jarvis on your Mac</h1></div>
        <RefreshButton onClick={() => void devices.refresh()} loading={devices.loading} updatedAt={devices.updatedAt} />
      </header>
      <p className="text-sm leading-relaxed text-slate-300">Pair the Jarvis companion on your Mac to request specific actions from this private app. The companion needs to be running; an internet connection to this dashboard alone does not give access to your laptop.</p>
      <ErrorBanner message={error ?? devices.error} />
      {notice && <p role="status" className="rounded-xl border border-accent/30 bg-accent/5 p-3 text-sm text-accent-soft">{notice}</p>}

      <Card label="Set up your Mac" title={<span className="inline-flex items-center gap-2"><Link2 className="h-4 w-4 text-accent-soft" aria-hidden /> Pair a companion</span>}>
        <ol className="mb-4 list-decimal space-y-3 rounded-xl border border-white/10 bg-white/[0.02] py-4 pl-8 pr-4 text-sm leading-relaxed text-slate-300">
          <li><span className="block">On your Mac, download the companion.</span><button type="button" className="btn-ghost mt-2" disabled={Boolean(busy)} onClick={() => void downloadCompanion()}><Download className="h-4 w-4" aria-hidden />{busy === "download" ? "Preparing ZIP…" : "Download Mac companion"}</button></li>
          <li>Unzip it, then open <strong className="font-medium text-slate-100">Jarvis.app</strong> or <strong className="font-medium text-slate-100">Start Jarvis.command</strong> from the package. It needs Node.js 22.13 or newer. If the launcher reports Node is missing, install the current LTS release from <a className="text-accent-soft underline" href="https://nodejs.org/en/download" target="_blank" rel="noreferrer">nodejs.org</a>, then open the launcher again.</li>
          <li>Create a code below. In the Mac companion's pairing form, enter this dashboard address and the code:<code className="mt-2 block select-all break-all rounded-lg bg-black/20 p-2 text-xs text-accent-soft">{window.location.origin}</code></li>
        </ol>
        <form onSubmit={e => { e.preventDefault(); void createPairing(); }} className="space-y-3">
          <label className="block text-sm text-slate-300">Device name<input className="input mt-1" value={deviceName} onChange={e => setDeviceName(e.target.value)} maxLength={80} required autoComplete="off" /></label>
          <fieldset className="space-y-2 text-sm text-slate-300"><legend className="label mb-2">Allow this device to</legend>
            <div className="flex items-center gap-2 text-slate-400"><ShieldCheck className="h-4 w-4" aria-hidden /> Report its status</div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={allowBrowser} onChange={e => setAllowBrowser(e.target.checked)} /> Open public websites in the default browser</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={allowApps} onChange={e => setAllowApps(e.target.checked)} /> Open apps enabled in the Mac companion</label>
          </fieldset>
          <button type="submit" className="btn-accent" disabled={Boolean(busy) || !deviceName.trim()}>{busy === "pair" ? "Creating code…" : "Create pairing code"}</button>
        </form>
        {pairing && <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-4" aria-live="polite">
          <div className="label">Enter this once in your Mac companion</div>
          <div className="mt-2 flex flex-wrap items-center gap-3"><code className="select-all break-all font-mono text-2xl tracking-widest text-accent-soft">{pairing.pairCode}</code>
            <button type="button" className="btn-ghost text-xs" onClick={() => void copyPairCode()}><Copy className="h-3.5 w-3.5" aria-hidden />{copied ? "Copied" : "Copy code"}</button></div>
          <p className="mt-2 text-xs text-slate-400">Expires at {melbourneTime(pairing.expiresAt)} Melbourne time. Share only with the companion on your own Mac. This code is not saved in browser storage.</p>
          <button type="button" className="mt-2 text-xs text-slate-400 underline" onClick={() => setPairing(null)}>Hide code</button>
        </div>}
      </Card>

      <Card label="Paired devices" title="Access you control">
        {!devices.data && !devices.error && <Loading label="Loading paired devices" />}
        {devices.data?.devices.length === 0 && <Empty>No Mac is paired yet. Create a code, then enter it in the Mac companion.</Empty>}
        <ul className="space-y-2">{devices.data?.devices.map(device => <li key={device.id} className={`rounded-xl border p-3 ${device.id === selectedId ? "border-accent/40 bg-accent/5" : "border-white/10 bg-white/[0.02]"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3"><button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setSelectedId(device.id); setRevokeId(null); }}><span className="inline-flex items-center gap-2 text-sm text-slate-100"><Laptop className="h-4 w-4" aria-hidden />{device.name}</span><span className="mt-1 block text-xs text-slate-400">{device.revokedAt ? "Access revoked" : seenLabel(device, now)}</span></button>
            <Chip tone={device.revokedAt ? "danger" : "neutral"}>{device.revokedAt ? "Revoked" : "Paired"}</Chip>
            {!device.revokedAt && (revokeId === device.id ? <div className="flex gap-2"><button type="button" className="btn-ghost border-danger/40 text-xs text-danger-soft" disabled={Boolean(busy)} onClick={() => void revoke(device)}>Confirm revoke</button><button type="button" className="btn-ghost text-xs" onClick={() => setRevokeId(null)}>Keep</button></div> : <button type="button" className="btn-ghost !px-2.5 text-xs" disabled={Boolean(busy)} onClick={() => setRevokeId(device.id)}><Unlink className="h-3.5 w-3.5" aria-hidden />Revoke</button>)}
          </div>
          <p className="mt-2 text-xs text-slate-500">{device.allowedActions.map(a => ACTION_LABELS[a] ?? a).join(" · ")}</p>
        </li>)}</ul>
      </Card>

      <Card label="Ask your Mac" title={selected?.name ?? "Choose a paired device"}>
        <div className="space-y-4">
          <button type="button" className="btn-ghost" disabled={Boolean(busy) || !supports("device.status")} onClick={() => void sendTask("device.status", {})}>{busy === "device.status" ? "Queuing…" : "Check Mac status"}</button>
          <form onSubmit={e => { e.preventDefault(); void sendTask("browser.open", { url: url.trim() }); }} className="space-y-2">
            <label className="block text-sm text-slate-300" htmlFor="device-browser-url">Open a public website</label><div className="flex gap-2"><input id="device-browser-url" type="url" className="input min-w-0" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com" required /><button type="submit" className="btn-accent shrink-0" disabled={Boolean(busy) || !supports("browser.open") || !/^https?:\/\//i.test(url.trim())}><Globe2 className="h-4 w-4" aria-hidden />Open</button></div>
          </form>
          <form onSubmit={e => { e.preventDefault(); void sendTask("apps.open", { appId }); }} className="space-y-2">
            <label className="block text-sm text-slate-300" htmlFor="device-app">Open an app</label><div className="flex gap-2"><select id="device-app" className="input min-w-0" value={appId} onChange={e => setAppId(e.target.value)}>{MAC_APPS.map(app => <option key={app.id} value={app.id}>{app.label}</option>)}</select><button type="submit" className="btn-ghost shrink-0" disabled={Boolean(busy) || !supports("apps.open")}>Open app</button></div>
            <p className="text-xs text-slate-500">Only apps you enabled in the Mac companion can launch. Opening Notes or Calendar does not read or change their contents.</p>
          </form>
          {!active && <p className="text-xs text-slate-400">Pair and choose an active Mac to enable these controls.</p>}
        </div>
      </Card>

      <Card label="Activity" title="Requests and reported results">
        {!tasks.length ? <Empty>No device tasks to show.</Empty> : <ol className="space-y-3">{tasks.map(task => <li key={task.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <div className="flex items-center justify-between gap-2"><span className="text-sm text-slate-100">{ACTION_LABELS[task.action] ?? task.action}</span><Chip tone={task.status === "failed" || task.status === "expired" ? "warn" : task.status === "completed" ? "ok" : "neutral"}>{task.status === "leased" ? "Accepted by Mac" : task.status.replace(/^./, c => c.toUpperCase())}</Chip></div>
          {typeof task.payload?.url === "string" && <p className="mt-1 break-all text-xs text-slate-400">{task.payload.url}</p>}
          {typeof task.payload?.appId === "string" && <p className="mt-1 text-xs text-slate-400">{MAC_APPS.find(app => app.id === task.payload.appId)?.label ?? "Enabled app"}</p>}
          <p className="mt-2 text-xs leading-relaxed text-slate-300">{taskDetail(task)}</p>
          {safeResult(task.result) && <p className="mt-1 break-words text-xs text-slate-400">{safeResult(task.result)}</p>}
          <p className="mt-2 text-[10px] text-slate-500">Requested {relTime(task.createdAt)}</p>
        </li>)}</ol>}
      </Card>
      <p className="text-xs leading-relaxed text-slate-500">This page controls a paired Mac. iPhone actions use supported Shortcuts and app integrations; pairing does not provide unrestricted access to other iPhone apps.</p>
    </div>
  );
}

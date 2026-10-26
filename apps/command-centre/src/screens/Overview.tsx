import { useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Bell, CheckCheck, ChevronDown, Clock3, FlaskConical, Layers3, Play, PlugZap, ShieldCheck } from "lucide-react";
import { api, melbourneDate, melbourneTime, type BackgroundTaskState, type Briefing, type Notification, type Status } from "../api";
import { useNow, usePoll } from "../hooks";
import { AlertList } from "../components/Alerts";
import { CommandBar } from "../components/CommandBar";
import { Card, Chip, Done, ErrorBanner, FakeBadge, Loading, RefreshButton, StateDot, stateLabel } from "../components/ui";
import type { Tab } from "../components/Nav";

const CONNECTION_NAMES: Record<string, string> = {
  "BoxSafe (Supabase)": "BoxSafe", "Mailer (Resend)": "Email", "Owner calls (Twilio)": "Phone calls",
  "Website checker": "Website checks", "Research (Brave Search)": "Web research", "Owner push (ntfy)": "Push notifications",
};

export function Overview({ status, approvalCount, onNavigate, onDataChanged }: { status: Status | null; approvalCount: number | null; onNavigate: (t: Tab) => void; onDataChanged: () => void }) {
  const now = useNow();
  const briefing = usePoll<Briefing>(() => api.briefing(), [], 60_000);
  const alerts = usePoll<Notification[]>(() => api.alerts(), [], 30_000);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const refreshAll = () => { void briefing.refresh(); void alerts.refresh(); onDataChanged(); };
  const runChecks = async () => {
    setRunning(true); setRunMsg(null); setRunError(null);
    try {
      const r = await api.runChecks();
      setRunMsg(`Checks returned: ${r.ran.join(", ") || "no checks ran"}. ${r.notifications} new notification${r.notifications === 1 ? "" : "s"}.`);
      refreshAll();
    } catch (e) { setRunError(`Checks could not finish: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setRunning(false); }
  };
  const seed = async () => {
    setSeeding(true); setRunError(null);
    try { await api.seed(); refreshAll(); }
    catch (e) { setRunError(e instanceof Error ? e.message : "Fictional demo could not be loaded."); }
    finally { setSeeding(false); }
  };
  const connected = status?.connections.filter((c) => c.state === "connected").length ?? null;
  const openAlerts = alerts.data?.filter((a) => !a.acknowledgedAt).length ?? null;
  const hour = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", hourCycle: "h23" }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const approvalAction = briefing.data?.structure.needsApproval.find((l) => !/nothing needs/i.test(l));
  const nextAction = approvalAction ?? briefing.data?.structure.recommend[0];
  const nextTab: Tab = approvalAction ? "approvals" : nextAction ? "boxsafe" : "devices";

  return (
    <div className="jarvis-overview">
      <header className="jarvis-overview-heading">
        <div><p className="hud-eyebrow"><span className="hud-tick" /> YOUR COMMAND CENTRE</p><h1>{greeting}, <span>Brandon.</span></h1><p className="jarvis-heading-subtitle">A little more clarity. A lot less to manage.</p></div>
        <div className="jarvis-clock"><time dateTime={now.toISOString()}>{melbourneTime(now)}</time><span>{melbourneDate(now)} <span className="jarvis-clock-zone">MELBOURNE</span></span><FakeBadge mode={status?.atlas.mode} /></div>
      </header>
      <div className="jarvis-mission-strip">
        <button type="button" className="jarvis-mission-stat" onClick={() => onNavigate("approvals")}><span className="jarvis-stat-icon"><ShieldCheck size={17} aria-hidden /></span><span><span className="jarvis-stat-label">Awaiting your approval</span><span className="jarvis-stat-description">Your decisions, in one place</span></span><strong className={approvalCount ? "text-warn-soft" : ""}>{approvalCount === null ? "—" : String(approvalCount).padStart(2, "0")}</strong><ArrowUpRight size={14} aria-hidden /></button>
        <button type="button" className="jarvis-mission-stat" onClick={() => document.getElementById("jarvis-alerts")?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })}><span className="jarvis-stat-icon"><Bell size={17} aria-hidden /></span><span><span className="jarvis-stat-label">Open notifications</span><span className="jarvis-stat-description">What needs your attention</span></span><strong className={openAlerts ? "text-warn-soft" : ""}>{openAlerts === null ? "—" : String(openAlerts).padStart(2, "0")}</strong><ArrowDown size={14} aria-hidden /></button>
        <div className="jarvis-mission-stat"><span className="jarvis-stat-icon"><PlugZap size={17} aria-hidden /></span><span><span className="jarvis-stat-label">Business connections</span><span className="jarvis-stat-description">Services reporting connected</span></span><strong>{connected === null ? "—" : String(connected).padStart(2, "0")}<small>/{status?.connections.length ?? "—"}</small></strong></div>
      </div>
      <div className="jarvis-hero-grid">
        <div className="jarvis-command-panel"><CommandBar onResult={refreshAll} /></div>
        <aside className="jarvis-systems-column">
          <Card className="jarvis-systems-card" label="01 / System connections" title="Your connected world" action={<RefreshButton onClick={onDataChanged} />}>
            {!status && <Loading label="Checking connections" />}
            {status && <div className="jarvis-system-list">{status.connections.map((c) => <details className="jarvis-system-detail" key={c.name}><summary><StateDot state={c.state} /><span>{CONNECTION_NAMES[c.name] ?? c.name}</span><span className={`jarvis-connection-state state-${c.state}`}>{stateLabel(c.state)}</span><ChevronDown size={11} aria-hidden /></summary><p>{c.detail}</p></details>)}</div>}
            <p className="jarvis-systems-note">Connect a service to bring its real information into Jarvis.</p>
          </Card>
          <div className="jarvis-decision-panel">
            <div className="hud-eyebrow"><Layers3 size={13} aria-hidden /> UP NEXT</div>
            <h2>{nextAction ? "Your next move." : "Make room for more."}</h2>
            <p>{nextAction ?? "Your Mac, your businesses, your day. Choose what you want Jarvis to help with next."}</p>
            <button type="button" onClick={() => onNavigate(nextTab)}>{approvalAction ? "Review approvals" : nextAction ? "Open BoxSafe" : "Connect your Mac"}<ArrowRight size={15} aria-hidden /></button>
          </div>
        </aside>
      </div>
      {runMsg && <Done>{runMsg}</Done>}
      <ErrorBanner message={runError} />
      <div className="jarvis-operations-grid">
        <Card label="02 / Daily intelligence" title="Your briefing" action={<RefreshButton onClick={() => void briefing.refresh()} loading={briefing.loading} updatedAt={briefing.updatedAt} />}>
          <ErrorBanner message={briefing.error} />
          {!briefing.data && !briefing.error && <Loading label="Preparing your briefing" />}
          {briefing.data && <><p className="jarvis-briefing-spoken">{briefing.data.spoken}</p><p className="jarvis-data-notice">{briefing.data.dataNotice}</p><details className="jarvis-full-briefing"><summary>Full operations briefing <ChevronDown size={13} aria-hidden /></summary><dl>{briefing.data.sections.map((s) => <div key={s.heading}><dt className="label">{s.heading}</dt><dd>{s.lines.map((l, i) => <p key={i}>{l}</p>)}</dd></div>)}</dl></details></>}
        </Card>
        <Card label="03 / Background activity" title={status?.background?.state === "running" ? "Checks in progress" : "Behind the scenes"} action={<Clock3 size={15} className="text-slate-500" aria-hidden />}>
          {!status ? <Loading label="Checking background work" /> : !status.background ? <p className="text-sm leading-relaxed text-slate-400">No background run has been reported yet. Run checks to see what is available.</p> : <><p className="jarvis-background-time">Last reported attempt · {melbourneTime(status.background.finishedAt ?? status.background.startedAt)} Melbourne · {melbourneDate(status.background.finishedAt ?? status.background.startedAt)}</p><div className="jarvis-task-list"><BackgroundTask label="Business checks" task={status.background.checks} /><BackgroundTask label="Daily research" task={status.background.research} /></div></>}
          <div className="jarvis-background-actions"><button type="button" className="btn-ghost text-xs" onClick={() => void runChecks()} disabled={running}><Play size={12} aria-hidden />{running ? "Running checks…" : "Run checks"}</button>{status?.atlas.mode === "fake" && <button type="button" className="btn-ghost text-xs" onClick={() => void seed()} disabled={seeding}><FlaskConical size={12} aria-hidden />{seeding ? "Loading…" : "Fictional demo"}</button>}<span>Only connected services can run.</span></div>
        </Card>
      </div>
      <div id="jarvis-alerts" className="jarvis-alerts-section"><Card label="04 / Notifications" title="On your radar" action={<RefreshButton onClick={() => void alerts.refresh()} loading={alerts.loading} updatedAt={alerts.updatedAt} />}><ErrorBanner message={alerts.error} />{!alerts.data && !alerts.error && <Loading label="Loading notifications" />}{alerts.data && alerts.data.length === 0 ? <div className="jarvis-clear-alerts"><CheckCheck size={20} aria-hidden /><span><strong>You’re all caught up.</strong><span>New notifications will appear here.</span></span></div> : alerts.data && <AlertList alerts={alerts.data} onChanged={refreshAll} onOpenApproval={() => onNavigate("approvals")} />}</Card></div>
    </div>
  );
}

function BackgroundTask({ label, task }: { label: string; task: BackgroundTaskState }) {
  const labels: Record<BackgroundTaskState["state"], string> = { completed: "Completed", partial: "Partial", failed: "Failed", skipped: "Skipped", blocked: "Blocked", already_ran: "Already completed", queued: "Queued", running: "Running" };
  const tone = task.state === "failed" ? "danger" : task.state === "blocked" || task.state === "partial" ? "warn" : task.state === "completed" || task.state === "already_ran" ? "ok" : task.state === "queued" || task.state === "running" ? "accent" : "neutral";
  return <details className="jarvis-background-task"><summary><span className={`jarvis-task-dot task-${task.state}`} /><span>{label}</span><Chip tone={tone}>{labels[task.state]}</Chip><ChevronDown size={11} aria-hidden /></summary><p>{task.detail}</p>{task.candidateCount !== undefined && <p>{task.candidateCount} discovery candidate{task.candidateCount === 1 ? "" : "s"} recorded.</p>}</details>;
}

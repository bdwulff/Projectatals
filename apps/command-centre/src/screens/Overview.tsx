import { useState } from "react";
import { Activity, ArrowRight, FlaskConical, Play } from "lucide-react";
import { api, melbourneDate, melbourneTime, type Briefing, type Notification, type Status } from "../api";
import { useNow, usePoll } from "../hooks";
import { AlertList } from "../components/Alerts";
import { CommandBar } from "../components/CommandBar";
import { Card, Done, Empty, ErrorBanner, FakeBadge, Loading, RefreshButton, StateDot, stateLabel } from "../components/ui";
import type { Tab } from "../components/Nav";

export function Overview({ status, onNavigate, onDataChanged }: { status: Status | null; onNavigate: (t: Tab) => void; onDataChanged: () => void }) {
  const now = useNow();
  const briefing = usePoll<Briefing>(() => api.briefing(), [], 60_000);
  const alerts = usePoll<Notification[]>(() => api.alerts(), [], 30_000);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const refreshAll = () => {
    void briefing.refresh();
    void alerts.refresh();
    onDataChanged();
  };

  const runChecks = async () => {
    setRunning(true);
    setRunMsg(null);
    try {
      const r = await api.runChecks();
      setRunMsg(`Ran ${r.ran.join(", ")}. ${r.notifications} new notification${r.notifications === 1 ? "" : "s"}.`);
      refreshAll();
    } catch (e) {
      setRunMsg(`Run failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  const seed = async () => {
    setSeeding(true);
    try {
      await api.seed();
      refreshAll();
    } finally {
      setSeeding(false);
    }
  };

  const nextAction = briefing.data?.structure.recommend[0] ?? briefing.data?.structure.needsApproval.find((l) => !/nothing needs/i.test(l)) ?? briefing.data?.structure.next[0] ?? null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-[0.3em] text-slate-50">ATLAS</h1>
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className={`inline-block h-2 w-2 rounded-full ${status?.atlas.online ? "bg-ok pulse-dot" : "bg-slate-500"}`} aria-hidden />
              {status ? (status.atlas.online ? "Online" : "Offline") : "Connecting…"}
            </span>
            <FakeBadge mode={status?.atlas.mode} />
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {melbourneDate(now)} · <span className="numeral text-sm text-slate-200">{melbourneTime(now)}</span> Melbourne
            {status?.atlas.version ? ` · v${status.atlas.version}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status?.atlas.mode === "fake" && (
            <button type="button" className="btn-ghost text-xs" onClick={() => void seed()} disabled={seeding}>
              <FlaskConical className="h-3.5 w-3.5" aria-hidden /> {seeding ? "Loading…" : "Load fictional demo data"}
            </button>
          )}
          <button type="button" className="btn-ghost text-xs" onClick={() => void runChecks()} disabled={running}>
            <Play className="h-3.5 w-3.5" aria-hidden /> {running ? "Running…" : "Run checks now"}
          </button>
        </div>
      </header>
      {runMsg && <Done>{runMsg}</Done>}

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Briefing */}
        <Card strong className="lg:col-span-3" label="Atlas briefing" title={briefing.data?.greeting ?? "Briefing"} action={<RefreshButton onClick={() => void briefing.refresh()} loading={briefing.loading} updatedAt={briefing.updatedAt} />}>
          <ErrorBanner message={briefing.error} />
          {!briefing.data && !briefing.error && <Loading label="Preparing briefing" />}
          {briefing.data && (
            <>
              <p className="text-lg font-light leading-relaxed text-slate-50 sm:text-xl">{briefing.data.spoken}</p>
              <p className="mt-2 text-[11px] text-slate-500">{briefing.data.dataNotice}</p>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                {briefing.data.sections.map((s) => (
                  <div key={s.heading} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <dt className="label">{s.heading}</dt>
                    <dd className="mt-1 space-y-1 text-sm text-slate-300">
                      {s.lines.map((l, i) => <p key={i}>{l}</p>)}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </Card>

        <div className="space-y-4 lg:col-span-2">
          {/* Next action */}
          <Card label="Next recommended action" className="border-accent/30 shadow-glow">
            {nextAction ? (
              <div className="flex items-start gap-3">
                <ArrowRight className="mt-0.5 h-5 w-5 shrink-0 text-accent-soft" aria-hidden />
                <p className="text-sm text-slate-100">{nextAction}</p>
              </div>
            ) : <Empty>Nothing recommended yet.</Empty>}
            {briefing.data && briefing.data.structure.needsApproval.some((l) => !/nothing needs/i.test(l)) && (
              <button type="button" className="btn-warn mt-3 w-full text-xs" onClick={() => onNavigate("approvals")}>Open approvals</button>
            )}
          </Card>

          {/* Connections */}
          <Card label="Connections" title="Live state">
            {!status && <Loading label="Checking connections" />}
            {status && (
              <ul className="space-y-1.5">
                {status.connections.map((c) => (
                  <li key={c.name} className="flex items-start gap-2 text-sm" title={c.detail}>
                    <span className="mt-1.5"><StateDot state={c.state} /></span>
                    <span className="flex-1 text-slate-200">{c.name}</span>
                    <span className={`text-xs ${c.state === "connected" ? "text-ok-soft" : c.state === "fake" ? "text-fuchsia-200" : c.state === "error" ? "text-danger-soft" : "text-slate-500"}`}>{stateLabel(c.state)}</span>
                  </li>
                ))}
              </ul>
            )}
            {status && status.connections.some((c) => c.state !== "connected") && (
              <p className="mt-3 text-[11px] text-slate-500">Figures from fake or disconnected sources are not real business data.</p>
            )}
          </Card>
        </div>
      </div>

      {/* Command */}
      <Card label="Talk to Atlas" title="Command" action={<Activity className="h-4 w-4 text-accent-soft" aria-hidden />}>
        <CommandBar onResult={() => refreshAll()} />
      </Card>

      {/* Alerts */}
      <Card label="Alerts" title={`Open alerts${alerts.data ? ` · ${alerts.data.length}` : ""}`} action={<RefreshButton onClick={() => void alerts.refresh()} loading={alerts.loading} updatedAt={alerts.updatedAt} />}>
        <ErrorBanner message={alerts.error} />
        {!alerts.data && !alerts.error && <Loading label="Loading alerts" />}
        {alerts.data && <AlertList alerts={alerts.data} onChanged={refreshAll} onOpenApproval={() => onNavigate("approvals")} />}
      </Card>
    </div>
  );
}

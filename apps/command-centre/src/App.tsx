import { useCallback, useEffect, useState } from "react";
import { api, type ApprovalRequest, type Notification, type Status } from "./api";
import { usePoll } from "./hooks";
import { BottomTabs, SideRail, type Tab } from "./components/Nav";
import { Overview } from "./screens/Overview";
import { Approvals } from "./screens/Approvals";
import { Pipeline } from "./screens/Pipeline";
import { BoxSafe } from "./screens/BoxSafe";
import { Finance } from "./screens/Finance";

const TAB_KEY = "atlas.tab";

function readTab(): Tab {
  try {
    const h = window.location.hash.replace("#", "") as Tab;
    if (["overview", "approvals", "pipeline", "boxsafe", "finance"].includes(h)) return h;
    const s = window.localStorage.getItem(TAB_KEY) as Tab | null;
    if (s && ["overview", "approvals", "pipeline", "boxsafe", "finance"].includes(s)) return s;
  } catch {
    /* storage unavailable */
  }
  return "overview";
}

export default function App() {
  const [tab, setTab] = useState<Tab>(readTab);
  const status = usePoll<Status>(() => api.status(), [], 30_000);
  const pendingApprovals = usePoll<ApprovalRequest[]>(() => api.approvals(), [], 30_000);
  const alerts = usePoll<Notification[]>(() => api.alerts(), [], 30_000);

  const navigate = useCallback((t: Tab) => {
    setTab(t);
    try {
      window.location.hash = t;
      window.localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const onHash = () => setTab(readTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const onDataChanged = useCallback(() => {
    void pendingApprovals.refresh();
    void alerts.refresh();
    void status.refresh();
  }, [pendingApprovals, alerts, status]);

  const critical = (alerts.data ?? []).filter((a) => a.priority === "critical").length;
  const badges: Partial<Record<Tab, number>> = {
    approvals: pendingApprovals.data?.length || undefined,
    overview: critical || undefined,
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-7xl gap-6 px-4 pb-24 pt-4 sm:px-6 md:pb-8 md:pt-6">
      <aside className="hidden md:block">
        <div className="sticky top-6 space-y-6">
          <div className="px-3">
            <div className="text-lg font-semibold tracking-[0.35em] text-slate-50">ATLAS</div>
            <div className="label mt-0.5">Command centre</div>
          </div>
          <SideRail tab={tab} onChange={navigate} badges={badges} />
          {status.error && <p className="px-3 text-[11px] text-danger-soft">API unreachable: {status.error}</p>}
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {status.error && tab !== "overview" && (
          <div role="alert" className="glass mb-4 border-danger/40 bg-danger/10 p-3 text-sm text-danger-soft">Atlas API unreachable: {status.error}</div>
        )}
        {tab === "overview" && <Overview status={status.data} onNavigate={navigate} onDataChanged={onDataChanged} />}
        {tab === "approvals" && <Approvals onDataChanged={onDataChanged} />}
        {tab === "pipeline" && <Pipeline />}
        {tab === "boxsafe" && <BoxSafe />}
        {tab === "finance" && <Finance />}
      </main>
      <BottomTabs tab={tab} onChange={navigate} badges={badges} />
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { api, SESSION_EXPIRED_EVENT, type OwnerSession, type ApprovalRequest, type Notification, type Status } from "./api";
import { usePoll } from "./hooks";
import { BottomTabs, SideRail, type Tab } from "./components/Nav";
import { Overview } from "./screens/Overview";
import { Approvals } from "./screens/Approvals";
import { Pipeline } from "./screens/Pipeline";
import { BoxSafe } from "./screens/BoxSafe";
import { Finance } from "./screens/Finance";
import { OwnerLogin } from "./components/OwnerLogin";
import { Devices } from "./screens/Devices";

const TAB_KEY = "atlas.tab";

function readTab(): Tab {
  try {
    const h = window.location.hash.replace("#", "") as Tab;
    if (["overview", "approvals", "pipeline", "boxsafe", "finance", "devices"].includes(h)) return h;
    const s = window.localStorage.getItem(TAB_KEY) as Tab | null;
    if (s && ["overview", "approvals", "pipeline", "boxsafe", "finance", "devices"].includes(s)) return s;
  } catch {
    /* storage unavailable */
  }
  return "overview";
}

export default function App() {
  const [session, setSession] = useState<OwnerSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const refreshSession = useCallback(async () => {
    setChecking(true);
    setSessionError(null);
    try {
      setSession(await api.session());
    } catch (e) {
      setSession(null);
      setSessionError(e instanceof Error ? e.message : "Atlas could not check your session.");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
    const expired = () => {
      setSession((current) => ({ configured: current?.configured ?? true, authenticated: false }));
      setSessionError("Your session has expired. Sign in again to continue.");
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  }, [refreshSession]);

  const logout = useCallback(async () => {
    setSigningOut(true);
    setSessionError(null);
    try {
      await api.logout();
      setSession({ configured: true, authenticated: false });
    } catch (e) {
      setSessionError(e instanceof Error ? `Sign-out was not confirmed: ${e.message}` : "Sign-out was not confirmed. Try again.");
    } finally {
      setSigningOut(false);
    }
  }, []);

  if (checking || !session?.authenticated) {
    return <OwnerLogin configured={session?.configured ?? false} loading={checking} error={sessionError} onRetry={() => void refreshSession()} onSignedIn={refreshSession} />;
  }
  return <CommandCentre onLogout={() => void logout()} signingOut={signingOut} sessionError={sessionError} developmentBypass={session.developmentBypass ?? false} />;
}

function CommandCentre({ onLogout, signingOut, sessionError, developmentBypass }: { onLogout: () => void; signingOut: boolean; sessionError: string | null; developmentBypass: boolean }) {
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
            <div className="text-lg font-semibold tracking-[0.35em] text-slate-50">JARVIS</div>
            <div className="label mt-0.5">Command centre</div>
          </div>
          <SideRail tab={tab} onChange={navigate} badges={badges} />
          {status.error && <p className="px-3 text-[11px] text-danger-soft">API unreachable: {status.error}</p>}
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="label">{developmentBypass ? "Local development" : "Private workspace"}</span>
          <button type="button" className="btn-ghost !py-2 text-xs" onClick={onLogout} disabled={signingOut}><LogOut className="h-3.5 w-3.5" aria-hidden />{signingOut ? "Signing out…" : "Sign out"}</button>
        </div>
        {sessionError && <div role="alert" className="glass mb-4 border-danger/40 bg-danger/10 p-3 text-sm text-danger-soft">{sessionError}</div>}
        {status.error && tab !== "overview" && (
          <div role="alert" className="glass mb-4 border-danger/40 bg-danger/10 p-3 text-sm text-danger-soft">Atlas API unreachable: {status.error}</div>
        )}
        {tab === "overview" && <Overview status={status.data} onNavigate={navigate} onDataChanged={onDataChanged} />}
        {tab === "approvals" && <Approvals onDataChanged={onDataChanged} />}
        {tab === "pipeline" && <Pipeline />}
        {tab === "boxsafe" && <BoxSafe />}
        {tab === "finance" && <Finance />}
        {tab === "devices" && <Devices />}
      </main>
      <BottomTabs tab={tab} onChange={navigate} badges={badges} />
    </div>
  );
}

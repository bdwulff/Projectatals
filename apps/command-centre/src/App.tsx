import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, LockKeyhole, LogOut, Radio } from "lucide-react";
import { api, SESSION_EXPIRED_EVENT, type OwnerSession, type ApprovalRequest, type Notification, type Status } from "./api";
import { usePoll } from "./hooks";
import { BottomTabs, JarvisMark, SideRail, TABS, type Tab } from "./components/Nav";
import { Overview } from "./screens/Overview";
import { Approvals } from "./screens/Approvals";
import { Acquisition } from "./screens/Acquisition";
import { BoxSafe } from "./screens/BoxSafe";
import { Finance } from "./screens/Finance";
import { OwnerLogin } from "./components/OwnerLogin";
import { Devices } from "./screens/Devices";
import { AutomaticGreeting } from "./components/AutomaticGreeting";
import { resetGreetingSession } from "./voice";
import { VoiceConversation } from "./components/VoiceConversation";
import { DiscoveryReportVoice } from "./components/DiscoveryReportVoice";

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
      const current = await api.session();
      if (!current.authenticated) resetGreetingSession();
      setSession(current);
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
      resetGreetingSession();
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
      resetGreetingSession();
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
  return <CommandCentre onLogout={() => void logout()} signingOut={signingOut} sessionError={sessionError} developmentBypass={session.developmentBypass ?? false} sessionId={session.expiresAt ?? "owner-session"} />;
}

function CommandCentre({ onLogout, signingOut, sessionError, developmentBypass, sessionId }: { onLogout: () => void; signingOut: boolean; sessionError: string | null; developmentBypass: boolean; sessionId: string }) {
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

  const critical = (alerts.data ?? []).filter((a) => a.priority === "critical" && !a.acknowledgedAt).length;
  const badges: Partial<Record<Tab, number>> = {
    approvals: pendingApprovals.data?.length || undefined,
    overview: critical || undefined,
  };

  return (
    <div className="jarvis-shell">
      <a href="#main-content" className="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById("main-content")?.focus(); }}>Skip to content</a>
      <aside className="jarvis-sidebar">
        <button type="button" className="jarvis-brand" onClick={() => navigate("overview")} aria-label="Jarvis home">
          <JarvisMark />
          <span><span className="jarvis-wordmark">J.A.R.V.I.S</span><span className="jarvis-brand-caption">Personal operating system</span></span>
        </button>
        <div className="jarvis-nav-heading">WORKSPACE <span>01—06</span></div>
        <SideRail tab={tab} onChange={navigate} badges={badges} />
        <div className="jarvis-sidebar-bottom">
          <div className="jarvis-owner"><span className="jarvis-owner-avatar">BW</span><div><strong>Brandon Wulff</strong><span>Workspace owner</span></div><LockKeyhole size={13} aria-hidden /></div>
          <button type="button" className="jarvis-sidebar-link" onClick={() => navigate("devices")}><span>Connect your devices</span><ArrowUpRight size={14} aria-hidden /></button>
          <div className="jarvis-sidebar-meta"><span>ATLAS ENGINE</span><span>{status.data?.atlas.version ? `V${status.data.atlas.version}` : "—"}</span></div>
        </div>
      </aside>
      <div className="jarvis-workspace">
        <header className="jarvis-topbar">
          <div className="jarvis-breadcrumb"><span className="jarvis-mobile-brand"><JarvisMark /></span><span className="jarvis-desktop-label">COMMAND CENTRE</span><span className="jarvis-breadcrumb-slash">/</span><span>{TABS.find((t) => t.id === tab)?.label}</span></div>
          <div className="jarvis-topbar-actions">
            <span className={`jarvis-server-status ${status.error ? "is-unavailable" : status.data?.atlas.online ? "is-online" : ""}`} title={status.error ?? "Jarvis server connection"}><Radio size={12} aria-hidden /><span>{status.error ? "Connection interrupted" : status.data?.atlas.online ? "Server online" : "Connecting"}</span></span>
            <span className="jarvis-private-label"><LockKeyhole size={11} aria-hidden />{developmentBypass ? "Local development" : "Private access"}</span>
            <button type="button" className="jarvis-signout" onClick={onLogout} disabled={signingOut} aria-label={signingOut ? "Signing out" : "Sign out"} title="Sign out"><LogOut size={15} aria-hidden /><span>{signingOut ? "Signing out…" : "Sign out"}</span></button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="jarvis-main">
        <AutomaticGreeting sessionId={sessionId} />
        <DiscoveryReportVoice sessionId={sessionId} />
        {sessionError && <div role="alert" className="glass mb-4 border-danger/40 bg-danger/10 p-3 text-sm text-danger-soft">{sessionError}</div>}
        {status.error && (
          <div role="alert" className="glass mb-4 border-danger/40 bg-danger/10 p-3 text-sm text-danger-soft">Jarvis cannot reach the server. Displayed information may be out of date. {status.error}</div>
        )}
        {tab === "overview" && <Overview status={status.data} approvalCount={pendingApprovals.data?.length ?? null} onNavigate={navigate} onDataChanged={onDataChanged} />}
        {tab === "approvals" && <Approvals onDataChanged={onDataChanged} />}
        {tab === "pipeline" && <Acquisition onDataChanged={onDataChanged} />}
        {tab === "boxsafe" && <BoxSafe />}
        {tab === "finance" && <Finance />}
        {tab === "devices" && <Devices />}
        <footer className="jarvis-footer"><span>J.A.R.V.I.S <span className="jarvis-footer-divider">/</span> Built around you.</span><span>WULFF DIGITAL <span className="jarvis-footer-divider">×</span> BOXSAFE</span></footer>
        </main>
      </div>
      <BottomTabs tab={tab} onChange={navigate} badges={badges} />
      <VoiceConversation onResult={onDataChanged} />
    </div>
  );
}

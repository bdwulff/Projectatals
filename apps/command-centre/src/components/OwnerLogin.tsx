import { useState, type FormEvent } from "react";
import { ArrowRight, KeyRound, LockKeyhole, Loader2 } from "lucide-react";
import { api } from "../api";
import "./jarvis-login.css";

export function OwnerLogin({ configured, loading, error, onRetry, onSignedIn }: {
  configured: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSignedIn: () => Promise<void>;
}) {
  const [accessKey, setAccessKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || !accessKey) return;
    setSubmitting(true);
    setLoginError(null);
    try {
      await api.login(accessKey);
      await onSignedIn();
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : "Sign-in failed. Try again.");
    } finally {
      setAccessKey("");
      setSubmitting(false);
    }
  }

  return (
    <main className="jl-shell">
      <header className="jl-header">
        <div className="jl-wordmark"><span className="jl-mark" aria-hidden>J.</span><span>ATLAS<span className="jl-header-divider">/</span>PRIVATE WORKSPACE</span></div>
        <span className="jl-location">MELBOURNE, AUSTRALIA</span>
      </header>

      <div className="jl-main">
        <section className="jl-intro" aria-label="Jarvis command centre">
          <div className="jl-eyebrow"><span className="jl-small-rule" /> YOUR PRIVATE COMMAND CENTRE</div>
          <div className="jl-brand">J.A.R.V.I.S</div>
          <p className="jl-intro-copy">Your businesses.<span>One clear view.</span></p>
          <div className="jl-core" aria-hidden>
            <div className="jl-core-grid" />
            <div className="jl-ring jl-ring-outer" />
            <div className="jl-ring jl-ring-ticks" />
            <div className="jl-ring jl-ring-orbit" />
            <div className="jl-ring jl-ring-inner" />
            <div className="jl-core-cross jl-core-cross-horizontal" />
            <div className="jl-core-cross jl-core-cross-vertical" />
            <div className="jl-nucleus"><span className="jl-nucleus-mark">J</span><span className="jl-nucleus-dot" /></div>
            <span className="jl-orbit-point jl-orbit-point-one" /><span className="jl-orbit-point jl-orbit-point-two" />
          </div>
          <div className="jl-businesses"><span>WULFF STUDIO</span><span className="jl-business-divider" /><span>BOXSAFE</span></div>
        </section>

        <section className="jl-access" aria-labelledby="owner-login-title">
          <div className="jl-access-topline"><span>OWNER ACCESS</span><LockKeyhole size={15} strokeWidth={1.4} aria-hidden /></div>
          <div className="jl-access-content">
            <div className={`jl-state${!loading && !configured ? " jl-state-amber" : ""}`}><span className="jl-state-dot" />{loading ? "CHECKING SESSION" : configured ? "AWAITING SIGN-IN" : "CONFIGURATION NEEDED"}</div>
            <h1 id="owner-login-title" className="jl-heading">{loading ? "A moment, please." : configured ? "Welcome back." : "Access is not ready."}</h1>
            <p className="jl-description">
              {loading ? "Connecting to your private workspace." : configured ? "Enter your owner access key to open your command centre." : "Owner sign-in needs to be configured before you can enter."}
            </p>
            {(error || loginError) && <p role="alert" className="jl-error">{loginError ?? error}</p>}
            {loading ? <div role="status" className="jl-wait"><Loader2 className="jl-spinner" size={17} aria-hidden /> Checking your session…</div> : configured ? (
              <form onSubmit={(e) => void submit(e)} className="jl-form">
                <label htmlFor="owner-access-key" className="jl-input-label">Owner access key</label>
                <div className="jl-input-wrap">
                  <KeyRound size={17} strokeWidth={1.5} aria-hidden />
                  <input id="owner-access-key" name="accessKey" type="password" autoComplete="current-password" autoCapitalize="none" spellCheck={false} required className="jl-input" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} disabled={submitting} placeholder="Enter your access key" />
                </div>
                <button type="submit" className="jl-enter" disabled={submitting || !accessKey}>
                  <span>{submitting ? "Signing in…" : "Enter command centre"}</span>
                  {submitting ? <Loader2 className="jl-spinner" size={18} aria-hidden /> : <ArrowRight size={18} strokeWidth={1.6} aria-hidden />}
                </button>
                <p className="jl-form-note">Your key is cleared after each sign-in attempt.</p>
              </form>
            ) : <button type="button" className="jl-enter jl-retry" onClick={onRetry}><span>Check again</span><ArrowRight size={18} strokeWidth={1.6} aria-hidden /></button>}
          </div>
          <div className="jl-access-footer"><span className="jl-small-rule" /> A WORKSPACE FOR WHAT COMES NEXT</div>
        </section>
      </div>

      <footer className="jl-footer">
        <span>JARVIS<span className="jl-footer-slash">/</span>BUILT ON ATLAS</span>
        <div className="jl-footer-line" />
        <span>PRIVATE OWNER WORKSPACE</span>
      </footer>
    </main>
  );
}

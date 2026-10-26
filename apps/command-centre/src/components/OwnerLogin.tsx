import { useState, type FormEvent } from "react";
import { LockKeyhole, Loader2 } from "lucide-react";
import { api } from "../api";

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
    <main className="flex min-h-full items-center justify-center px-5 py-12">
      <section className="glass-strong w-full max-w-sm p-6 sm:p-8" aria-labelledby="owner-login-title">
        <div className="mb-7 flex items-center gap-3">
          <div className="rounded-xl border border-accent/25 bg-accent/10 p-2.5 text-accent-soft"><LockKeyhole className="h-5 w-5" aria-hidden /></div>
          <div><div className="text-lg font-semibold tracking-[0.35em] text-slate-50">ATLAS</div><div className="label mt-0.5">Private command centre</div></div>
        </div>
        <h1 id="owner-login-title" className="text-xl font-medium text-slate-50">{loading ? "Checking your session" : configured ? "Owner sign-in" : "Owner sign-in is not ready"}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          {loading ? "Connecting to your private workspace." : configured ? "Enter your owner access key to open Atlas." : "Atlas is locked until owner sign-in is configured on the server."}
        </p>
        {(error || loginError) && <p role="alert" className="mt-4 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger-soft">{loginError ?? error}</p>}
        {loading ? <div role="status" className="mt-6 flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Please wait…</div> : configured ? (
          <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4">
            <div>
              <label htmlFor="owner-access-key" className="mb-2 block text-sm text-slate-300">Owner access key</label>
              <input id="owner-access-key" name="accessKey" type="password" autoComplete="current-password" autoCapitalize="none" spellCheck={false} required className="input !py-3 text-base" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} disabled={submitting} />
            </div>
            <button type="submit" className="btn-accent w-full !py-3" disabled={submitting || !accessKey}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{submitting ? "Signing in…" : "Open Atlas"}
            </button>
          </form>
        ) : <button type="button" className="btn-ghost mt-6 w-full !py-3" onClick={onRetry}>Try again</button>}
      </section>
    </main>
  );
}

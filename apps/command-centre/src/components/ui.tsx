import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, FlaskConical, Loader2, RefreshCw, XCircle } from "lucide-react";
import type { ConnectionState, Priority } from "../api";

export function Card({ children, className = "", strong = false, title, action, label }: { children: ReactNode; className?: string; strong?: boolean; title?: ReactNode; action?: ReactNode; label?: string }) {
  return (
    <section className={`${strong ? "glass-strong" : "glass"} p-4 sm:p-5 ${className}`}>
      {(title || label || action) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {label && <div className="label">{label}</div>}
            {title && <h2 className="mt-0.5 text-base font-medium text-slate-100">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatTile({ label, value, sub, tone = "neutral", hint }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "neutral" | "accent" | "warn" | "danger" | "ok"; hint?: string }) {
  const ring = tone === "accent" ? "shadow-glow border-accent/30" : tone === "warn" ? "border-warn/30" : tone === "danger" ? "border-danger/30" : tone === "ok" ? "border-ok/30" : "";
  return (
    <div className={`glass p-4 ${ring}`} title={hint}>
      <div className="label">{label}</div>
      <div className="numeral mt-1 text-3xl sm:text-4xl">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export function Chip({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" | "danger" | "ok" | "fake"; className?: string }) {
  const map: Record<string, string> = {
    neutral: "border-white/10 bg-white/5 text-slate-300",
    accent: "border-accent/40 bg-accent/10 text-accent-soft",
    warn: "border-warn/40 bg-warn/10 text-warn-soft",
    danger: "border-danger/40 bg-danger/10 text-danger-soft",
    ok: "border-ok/40 bg-ok/10 text-ok-soft",
    fake: "border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-200",
  };
  return <span className={`chip ${map[tone]} ${className}`}>{children}</span>;
}

/** Visible whenever figures are fictional. The API decides; the UI only reports it. */
export function FakeBadge({ mode, label = "Fictional data" }: { mode: "live" | "fake" | "mixed" | undefined | null; label?: string }) {
  if (mode !== "fake" && mode !== "mixed") return null;
  return (
    <Chip tone="fake" className="uppercase tracking-wider">
      <FlaskConical className="h-3 w-3" aria-hidden /> {mode === "mixed" ? "Partly fictional" : label}
    </Chip>
  );
}

export function PriorityChip({ priority }: { priority: Priority }) {
  if (priority === "critical") return <Chip tone="danger"><AlertTriangle className="h-3 w-3" aria-hidden /> Critical</Chip>;
  if (priority === "action_needed") return <Chip tone="warn">Action needed</Chip>;
  return <Chip>Routine</Chip>;
}

export function StateDot({ state }: { state: ConnectionState }) {
  const cls = state === "connected" ? "bg-ok pulse-dot" : state === "fake" ? "bg-fuchsia-400" : state === "error" ? "bg-danger" : "bg-slate-500";
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} aria-hidden />;
}

export function stateLabel(state: ConnectionState) {
  return state === "connected" ? "Connected" : state === "fake" ? "Fake" : state === "error" ? "Error" : "Not connected";
}

export function RefreshButton({ onClick, loading, updatedAt }: { onClick: () => void; loading?: boolean; updatedAt?: Date | null }) {
  return (
    <button type="button" onClick={onClick} className="btn-ghost !px-2.5 !py-1.5 text-xs" aria-label="Refresh" disabled={loading}>
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
      {updatedAt ? <span className="hidden sm:inline text-slate-400">{updatedAt.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}</span> : null}
    </button>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="glass flex items-center gap-2 border-danger/40 bg-danger/10 p-3 text-sm text-danger-soft">
      <XCircle className="h-4 w-4 shrink-0" aria-hidden /> {message}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
      <CircleDashed className="h-4 w-4 shrink-0" aria-hidden /> {children}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-4 text-sm text-slate-400" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}…
    </div>
  );
}

export function Done({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-ok/30 bg-ok/10 p-3 text-sm text-ok-soft">
      <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> {children}
    </div>
  );
}

export function Bar({ value, max, tone = "accent" }: { value: number; max: number; tone?: "accent" | "warn" | "danger" }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const color = tone === "warn" ? "bg-warn" : tone === "danger" ? "bg-danger" : "bg-accent";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 py-1.5 text-sm sm:grid-cols-[9rem_1fr]">
      <dt className="label pt-0.5">{k}</dt>
      <dd className="text-slate-200">{v}</dd>
    </div>
  );
}

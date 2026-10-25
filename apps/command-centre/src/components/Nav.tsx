import { BadgeCheck, Building2, GitBranch, LayoutDashboard, PiggyBank } from "lucide-react";
import type { ReactNode } from "react";

export type Tab = "overview" | "approvals" | "pipeline" | "boxsafe" | "finance";

export const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard className="h-5 w-5" aria-hidden /> },
  { id: "approvals", label: "Approvals", icon: <BadgeCheck className="h-5 w-5" aria-hidden /> },
  { id: "pipeline", label: "Pipeline", icon: <GitBranch className="h-5 w-5" aria-hidden /> },
  { id: "boxsafe", label: "BoxSafe", icon: <Building2 className="h-5 w-5" aria-hidden /> },
  { id: "finance", label: "Finance", icon: <PiggyBank className="h-5 w-5" aria-hidden /> },
];

export function BottomTabs({ tab, onChange, badges }: { tab: Tab; onChange: (t: Tab) => void; badges: Partial<Record<Tab, number>> }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-ink-950/80 backdrop-blur-xl md:hidden" style={{ paddingBottom: "var(--safe-bottom)" }} aria-label="Primary">
      <ul className="grid grid-cols-5">
        {TABS.map((t) => {
          const active = t.id === tab;
          const badge = badges[t.id];
          return (
            <li key={t.id}>
              <button type="button" onClick={() => onChange(t.id)} aria-current={active ? "page" : undefined} aria-label={t.label}
                className={`relative flex w-full flex-col items-center gap-1 py-2.5 text-[10px] font-medium uppercase tracking-wider transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${active ? "text-accent-soft" : "text-slate-400 hover:text-slate-200"}`}>
                {t.icon}
                {t.label}
                {badge ? <span className="absolute right-[18%] top-1.5 min-w-[1.1rem] rounded-full bg-warn px-1 text-center text-[10px] font-bold leading-4 text-ink-950">{badge}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SideRail({ tab, onChange, badges }: { tab: Tab; onChange: (t: Tab) => void; badges: Partial<Record<Tab, number>> }) {
  return (
    <nav className="hidden md:flex md:w-56 md:shrink-0 md:flex-col md:gap-1" aria-label="Primary">
      {TABS.map((t) => {
        const active = t.id === tab;
        const badge = badges[t.id];
        return (
          <button key={t.id} type="button" onClick={() => onChange(t.id)} aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${active ? "bg-accent/10 text-accent-soft shadow-glow" : "text-slate-400 hover:bg-white/5 hover:text-slate-100"}`}>
            {t.icon}
            <span className="flex-1 text-left">{t.label}</span>
            {badge ? <span className="rounded-full bg-warn px-1.5 text-[10px] font-bold leading-4 text-ink-950">{badge}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}

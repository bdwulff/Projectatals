import { BadgeCheck, Building2, GitBranch, Laptop, LayoutDashboard, PiggyBank } from "lucide-react";
import type { ReactNode } from "react";

export type Tab = "overview" | "approvals" | "pipeline" | "boxsafe" | "finance" | "devices";

export const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard className="h-5 w-5" aria-hidden /> },
  { id: "approvals", label: "Approvals", icon: <BadgeCheck className="h-5 w-5" aria-hidden /> },
  { id: "pipeline", label: "Studio", icon: <GitBranch className="h-5 w-5" aria-hidden /> },
  { id: "boxsafe", label: "BoxSafe", icon: <Building2 className="h-5 w-5" aria-hidden /> },
  { id: "finance", label: "Finance", icon: <PiggyBank className="h-5 w-5" aria-hidden /> },
  { id: "devices", label: "Devices", icon: <Laptop className="h-5 w-5" aria-hidden /> },
];

export function JarvisMark() {
  return <svg className="jarvis-mark" width="36" height="36" viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 2.5 35.2 11.25v17.5L20 37.5 4.8 28.75v-17.5L20 2.5Z" stroke="currentColor" strokeWidth="1" /><path d="m20 8 10.4 6v12L20 32 9.6 26V14L20 8Z" stroke="currentColor" strokeOpacity=".3" /><path d="M13 17.5h14L20 28l-7-10.5Z" fill="currentColor" fillOpacity=".15" stroke="currentColor" strokeWidth="1.2" /><path d="M20 8v6M9.6 26l5-3m10.8 0 5 3" stroke="currentColor" strokeWidth="1.2" /></svg>;
}

export function BottomTabs({ tab, onChange, badges }: { tab: Tab; onChange: (t: Tab) => void; badges: Partial<Record<Tab, number>> }) {
  return (
    <nav className="jarvis-bottom-nav" style={{ paddingBottom: "var(--safe-bottom)" }} aria-label="Primary">
      <ul className="grid grid-cols-6">
        {TABS.map((t) => {
          const active = t.id === tab;
          const badge = badges[t.id];
          return (
            <li key={t.id}>
              <button type="button" onClick={() => onChange(t.id)} aria-current={active ? "page" : undefined} aria-label={t.label}
                className={`jarvis-bottom-tab ${active ? "is-active" : ""}`}>
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
    <nav className="jarvis-side-nav" aria-label="Primary">
      {TABS.map((t, i) => {
        const active = t.id === tab;
        const badge = badges[t.id];
        return (
          <button key={t.id} type="button" onClick={() => onChange(t.id)} aria-current={active ? "page" : undefined}
            className={`jarvis-side-tab ${active ? "is-active" : ""}`}>
            {t.icon}
            <span className="flex-1 text-left">{t.label}</span>
            {badge ? <span className="rounded-full bg-warn px-1.5 text-[10px] font-bold leading-4 text-ink-950">{badge}</span> : null}
            {!badge && <span className="jarvis-tab-number">0{i + 1}</span>}
          </button>
        );
      })}
    </nav>
  );
}

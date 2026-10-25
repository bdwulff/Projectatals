import { ExternalLink } from "lucide-react";
import { api, aud, type Evidence, type Project, type Prospect, type Quote } from "../api";
import { usePoll } from "../hooks";
import { Card, Chip, Empty, ErrorBanner, Loading, RefreshButton } from "../components/ui";

const STAGES = ["research", "qualified", "contact_eligible", "contacted", "replied", "discovery", "draft_quote", "approval_pending", "quote_sent", "accepted", "deposit_confirmed", "in_development", "quality_review", "client_acceptance", "live", "maintenance"];

function EvidenceChip({ e }: { e: Evidence }) {
  const tone = e.status === "confirmed" ? "ok" : e.status === "hypothesis" ? "warn" : "neutral";
  return (
    <Chip tone={tone} className="max-w-full">
      <span className="truncate" title={`${e.observation}${e.uncertainty ? ` — ${e.uncertainty}` : ""} (${e.method})`}>{e.observation}</span>
    </Chip>
  );
}

function ProspectCard({ p }: { p: Prospect }) {
  return (
    <div className={`glass p-3 ${p.contactEligibility.suppressed ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-100">{p.businessName}</div>
          <div className="text-xs text-slate-400">{p.industry} · {p.location}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {p.fixture && <Chip tone="fake">Fictional</Chip>}
          <Chip tone={p.qualification === "qualified" ? "accent" : p.qualification === "disqualified" ? "danger" : "neutral"}>{p.qualification}</Chip>
        </div>
      </div>
      {p.website && (
        <a href={p.website} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-accent-soft hover:underline">
          {p.website.replace(/^https?:\/\//, "")} <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      )}
      {p.evidence.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">{p.evidence.map((e, i) => <EvidenceChip key={i} e={e} />)}</div>
      )}
      <p className="mt-2 text-xs text-slate-400">{p.commercialOpportunity}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>Scope: {p.recommendedScope}</span>
        {p.internalRecommendedPriceAud != null && <span className="numeral text-xs text-slate-300">{aud(p.internalRecommendedPriceAud)} <span className="text-slate-500">internal</span></span>}
      </div>
      <div className="mt-1 text-[10px] text-slate-500">
        Contact: {p.contactEligibility.suppressed ? "suppressed" : p.contactEligibility.lawfulBasis.replace(/_/g, " ")}{p.outreach.length ? ` · ${p.outreach.length} message${p.outreach.length === 1 ? "" : "s"} sent` : ""}
      </div>
    </div>
  );
}

const quoteTone = (s: string) => s === "sent" ? "accent" : s === "accepted" ? "ok" : s === "approval_pending" ? "warn" : s === "rejected" ? "danger" : "neutral";

export function Pipeline() {
  const prospects = usePoll<Prospect[]>(() => api.prospects(), [], 30_000);
  const quotes = usePoll<Quote[]>(() => api.quotes(), [], 30_000);
  const projects = usePoll<Project[]>(() => api.projects(), [], 30_000);

  const refresh = () => { void prospects.refresh(); void quotes.refresh(); void projects.refresh(); };
  const byStage = new Map<string, Prospect[]>();
  for (const p of prospects.data ?? []) byStage.set(p.stage, [...(byStage.get(p.stage) ?? []), p]);
  const stages = STAGES.filter((s) => byStage.has(s));
  const customers = (prospects.data ?? []).filter((p) => STAGES.indexOf(p.stage) >= STAGES.indexOf("accepted")).length;

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="label">Wulff Studio</div>
          <h1 className="text-xl font-medium text-slate-50">Research pipeline & production</h1>
          {prospects.data && <p className="text-xs text-slate-400">{prospects.data.length} researched · {prospects.data.filter((p) => p.qualification === "qualified").length} qualified · {customers} customer{customers === 1 ? "" : "s"}</p>}
        </div>
        <RefreshButton onClick={refresh} loading={prospects.loading || quotes.loading} updatedAt={prospects.updatedAt} />
      </header>

      <Card label="Prospects" title="By stage">
        <ErrorBanner message={prospects.error} />
        {!prospects.data && !prospects.error && <Loading label="Loading prospects" />}
        {prospects.data && prospects.data.length === 0 && <Empty>No prospects yet. Ask Atlas to “find five businesses around Berwick”.</Empty>}
        {stages.length > 0 && (
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 snap-x">
            {stages.map((s) => (
              <div key={s} className="w-[85vw] shrink-0 snap-start sm:w-80">
                <div className="label mb-2 flex items-center justify-between">
                  <span>{s.replace(/_/g, " ")}</span>
                  <span className="rounded-full bg-white/10 px-1.5 text-[10px] text-slate-300">{byStage.get(s)!.length}</span>
                </div>
                <div className="space-y-2">{byStage.get(s)!.map((p) => <ProspectCard key={p.id} p={p} />)}</div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-ok" aria-hidden /> confirmed</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warn" aria-hidden /> hypothesis</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-500" aria-hidden /> unverified</span>
        </div>
      </Card>

      <Card label="Quotes" title="Versions & status">
        <ErrorBanner message={quotes.error} />
        {!quotes.data && !quotes.error && <Loading label="Loading quotes" />}
        {quotes.data && quotes.data.length === 0 && <Empty>No quotes drafted.</Empty>}
        {quotes.data && quotes.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="text-left">
                  {["Customer", "Ver", "Price ex GST", "Status", "Deliverables", "Note"].map((h) => <th key={h} className="label pb-2 pr-3 font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {[...quotes.data].sort((a, b) => a.customerName.localeCompare(b.customerName) || b.version - a.version).map((q) => (
                  <tr key={q.id} className="align-top">
                    <td className="py-2 pr-3 text-slate-100">{q.customerName}</td>
                    <td className="py-2 pr-3 text-slate-400">v{q.version}</td>
                    <td className="numeral py-2 pr-3 text-base">{aud(q.priceExGstAud)}{q.recommendation.gstAud ? <span className="text-xs text-slate-500"> +GST</span> : null}</td>
                    <td className="py-2 pr-3"><Chip tone={quoteTone(q.status)}>{q.status.replace("_", " ")}</Chip></td>
                    <td className="py-2 pr-3 text-xs text-slate-400">{q.deliverables.length} item{q.deliverables.length === 1 ? "" : "s"}{q.recommendation.dependencies.length ? ` · ${q.recommendation.dependencies.length} dependency` : ""}</td>
                    <td className="py-2 text-xs text-slate-500">{q.changeReason ?? (q.sentAt ? `sent ${new Date(q.sentAt).toLocaleDateString("en-AU")}` : "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card label="Production" title="Projects">
        <ErrorBanner message={projects.error} />
        {!projects.data && !projects.error && <Loading label="Loading projects" />}
        {projects.data && projects.data.length === 0 && <Empty>No active projects. Projects are created when a sent quote is accepted.</Empty>}
        <div className="grid gap-3 md:grid-cols-2">
          {projects.data?.map((p) => (
            <div key={p.id} className="glass p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium text-slate-100">{p.name}</div>
                <Chip tone="accent">{p.stage.replace(/_/g, " ")}</Chip>
              </div>
              <ul className="mt-2 space-y-1 text-xs">
                {p.tasks.map((t, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className={t.status === "done" ? "text-slate-500 line-through" : t.status === "blocked" ? "text-danger-soft" : "text-slate-300"}>{t.title}</span>
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">{t.owner} · {t.status}</span>
                  </li>
                ))}
              </ul>
              {p.blockers.length > 0 && <p className="mt-2 text-xs text-warn-soft">Blocked: {p.blockers.join("; ")}</p>}
              <p className="mt-1 text-xs text-slate-400">Next: {p.nextAction}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

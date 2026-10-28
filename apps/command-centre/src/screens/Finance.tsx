import { api, aud, type Finance as FinanceData, type FinanceRange } from "../api";
import { usePoll } from "../hooks";
import { Bar, Card, Chip, ErrorBanner, FakeBadge, Loading, RefreshButton, StatTile } from "../components/ui";

function RangeCol({ label, r }: { label: string; r: FinanceRange }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <div className="label">{label}</div>
      <div className="numeral mt-1 text-2xl sm:text-3xl">{aud(r.verifiedRevenueAud, { cents: true })}</div>
      <div className="mt-1 text-xs text-slate-400">{r.paidOrders} paid · {aud(r.refundsAud, { cents: true })} refunded</div>
      <div className="text-[11px] text-slate-500">{r.pendingOrders} pending excluded · {r.needsDispatch.length} to dispatch</div>
    </div>
  );
}

export function Finance() {
  const fin = usePoll<FinanceData>(() => api.finance(), [], 60_000);
  const f = fin.data;
  const budgetTone = f ? (f.budget.spentAud / Math.max(1, f.budget.limitAud) > 0.9 ? "danger" : f.budget.spentAud / Math.max(1, f.budget.limitAud) > 0.6 ? "warn" : "accent") : "accent";

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="label">Financial overview</div>
          <h1 className="text-xl font-medium text-slate-50">Verified money only</h1>
          <p className="text-xs text-slate-400">Quotes, pending orders and unpaid invoices are never shown as income.</p>
        </div>
        <RefreshButton onClick={() => void fin.refresh()} loading={fin.loading} updatedAt={fin.updatedAt} />
      </header>
      {fin.error && !f ? <Card label="Financial data" title="Waiting for verified figures."><p className="text-sm leading-relaxed text-slate-400">Jarvis couldn’t retrieve the records needed for this report. Check your business connections, then refresh this page.</p><a href="#overview" className="mt-4 inline-block text-xs text-accent-soft hover:underline">Review connections on Overview →</a></Card> : <ErrorBanner message={fin.error} />}
      {!f && !fin.error && <Loading label="Loading finance" />}
      {f && (
        <>
          <Card label="BoxSafe" title={<span className="inline-flex items-center gap-2">Verified collected payments <FakeBadge mode={f.boxsafe.mode} /></span>}>
            <div className="grid gap-3 sm:grid-cols-3">
              <RangeCol label="Today" r={f.boxsafe.today} />
              <RangeCol label="This week" r={f.boxsafe.week} />
              <RangeCol label="This month" r={f.boxsafe.month} />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Before Stripe fees. Refunds already deducted.</p>
          </Card>

          <Card label="Wulff Studio" title="Collected vs quoted">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatTile label="Verified collected" value={aud(f.wulffStudio.verifiedCollectedAud, { cents: true })} tone="ok" sub="Actual income" />
              <StatTile label="Quotes sent" value={aud(f.wulffStudio.quotesSentAud)} sub={<Chip tone="warn">Quoted, not income</Chip>} />
              <StatTile label="Awaiting approval" value={aud(f.wulffStudio.quotesPendingApprovalAud)} sub={<Chip>Not yet offered</Chip>} />
            </div>
            {f.wulffStudio.note && <p className="mt-3 text-xs text-slate-400">{f.wulffStudio.note}</p>}
          </Card>

          <Card label="Experimentation budget" title="Recorded costs against authorised limit" className={budgetTone === "danger" ? "border-danger/40" : ""}>
            <div className="flex items-end justify-between gap-3">
              <div className="numeral text-3xl">{aud(f.budget.spentAud, { cents: true })} <span className="text-base text-slate-500">of {aud(f.budget.limitAud)}</span></div>
              <div className="text-xs text-slate-400">{aud(f.budget.remainingAud, { cents: true })} remaining in records</div>
            </div>
            <div className="mt-3"><Bar value={f.budget.spentAud} max={f.budget.limitAud} tone={budgetTone} /></div>
            <p className="mt-2 text-xs text-slate-400">Recorded costs only; hosting/provider billing is not connected.</p>
            <p className="mt-2 text-[11px] text-slate-500">Atlas never raises this limit on its own. Further spend needs your separate authorisation.</p>
          </Card>
        </>
      )}
    </div>
  );
}

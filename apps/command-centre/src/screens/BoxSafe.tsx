import { useState } from "react";
import { PackageCheck, Truck } from "lucide-react";
import { api, aud, relTime, type BoxSafeOrders, type Dispatch, type Order, type Range, type Reconciliation } from "../api";
import { usePoll } from "../hooks";
import { Card, Chip, Empty, ErrorBanner, FakeBadge, Loading, RefreshButton, StatTile } from "../components/ui";

const RANGES: { id: Range; label: string }[] = [{ id: "today", label: "Today" }, { id: "week", label: "This week" }, { id: "month", label: "This month" }];
const CATS: { key: keyof BoxSafeOrders["summary"]["byCategory"]; label: string }[] = [
  { key: "registration", label: "Registrations" }, { key: "course", label: "Courses" }, { key: "merchandise", label: "Merchandise" }, { key: "ticket", label: "Tickets" }, { key: "ppv", label: "PPV" }, { key: "other", label: "Other" },
];

function OrderRow({ o }: { o: Order }) {
  const tone = o.status === "paid" ? "ok" : o.status === "pending" ? "warn" : o.status.includes("refund") ? "danger" : "neutral";
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <div className="min-w-0">
        <div className="text-slate-100">{o.customerName} <span className="text-xs text-slate-500">{o.id}</span></div>
        <div className="truncate text-xs text-slate-400">{o.items.map((i) => `${i.quantity}× ${i.productName}${i.variantLabel ? ` (${i.variantLabel})` : ""}`).join(", ")}</div>
      </div>
      <div className="flex items-center gap-2">
        <Chip tone={tone}>{o.status.replace("_", " ")}</Chip>
        {o.items.some((i) => i.requiresShipping) && <Chip>{o.fulfillmentStatus.replace("_", " ")}</Chip>}
        <span className="numeral text-base">{aud(o.total, { cents: true })}</span>
        <span className="text-[10px] text-slate-500">{relTime(o.paidAt ?? o.createdAt)}</span>
      </div>
    </li>
  );
}

export function BoxSafe() {
  const [range, setRange] = useState<Range>("today");
  const orders = usePoll<BoxSafeOrders>(() => api.boxsafeOrders(range), [range], 30_000);
  const dispatch = usePoll<Dispatch>(() => api.boxsafeDispatch(), [], 60_000);
  const recon = usePoll<Reconciliation>(() => api.boxsafeReconcile(range), [range], 60_000);
  const s = orders.data?.summary;
  const mode = orders.data?.mode;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label">BoxSafe</div>
          <h1 className="flex items-center gap-2 text-xl font-medium text-slate-50">Orders, fulfilment & payments <FakeBadge mode={mode} /></h1>
        </div>
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Range" className="glass flex p-1">
            {RANGES.map((r) => (
              <button key={r.id} role="tab" type="button" aria-selected={range === r.id} onClick={() => setRange(r.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${range === r.id ? "bg-accent/20 text-accent-soft" : "text-slate-400 hover:text-slate-100"}`}>{r.label}</button>
            ))}
          </div>
          <RefreshButton onClick={() => { void orders.refresh(); void dispatch.refresh(); void recon.refresh(); }} loading={orders.loading} updatedAt={orders.updatedAt} />
        </div>
      </header>
      {orders.error && !orders.data ? <Card label="BoxSafe data" title="Orders aren’t available yet."><p className="text-sm leading-relaxed text-slate-400">Jarvis couldn’t retrieve your orders. Check the BoxSafe connection, then refresh this page.</p><a href="#overview" className="mt-4 inline-block text-xs text-accent-soft hover:underline">Review connections on Overview →</a></Card> : <ErrorBanner message={orders.error} />}
      {!orders.data && !orders.error && <Loading label="Loading orders" />}

      {s && (
        <>
          <p className="text-sm font-light leading-relaxed text-slate-200 sm:text-base">{orders.data?.spoken}</p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={`Paid orders · ${s.range.label}`} value={s.paidOrders} tone="accent" />
            <StatTile label="Verified revenue" value={aud(s.verifiedRevenueAud, { cents: true })} sub="Collected payments, before Stripe fees" tone="ok" />
            <StatTile label="Refunds" value={aud(s.refundsAud, { cents: true })} tone={s.refundsAud > 0 ? "warn" : "neutral"} />
            <StatTile label="Pending (excluded)" value={s.pendingOrders} sub={`${s.failedOrders} failed`} hint="Unpaid orders are never counted as revenue" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card label="Breakdown" title="Paid orders by category">
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {CATS.map((c) => (
                  <li key={c.key} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <div className="label">{c.label}</div>
                    <div className="numeral mt-1 text-2xl">{s.byCategory[c.key]}</div>
                  </li>
                ))}
              </ul>
              {Object.keys(s.byLeague).length > 0 && (
                <div className="mt-3">
                  <div className="label mb-1">By league (A$)</div>
                  <ul className="flex flex-wrap gap-2">
                    {Object.entries(s.byLeague).map(([k, v]) => <li key={k}><Chip tone="accent">{k} · {aud(v, { cents: true })}</Chip></li>)}
                  </ul>
                </div>
              )}
            </Card>

            <Card label="Fulfilment" title={<span className="inline-flex items-center gap-2"><Truck className="h-4 w-4 text-accent-soft" aria-hidden /> Awaiting dispatch{dispatch.data ? ` · ${dispatch.data.orders.length}` : ""}</span>}>
              <ErrorBanner message={dispatch.error} />
              {dispatch.data && dispatch.data.orders.length === 0 && <Empty>No merchandise orders waiting for dispatch.</Empty>}
              {dispatch.data && dispatch.data.packingSummary.length > 0 && (
                <ul className="space-y-1.5 text-sm">
                  {dispatch.data.packingSummary.map((line, i) => (
                    <li key={i} className="flex items-start gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-2 text-slate-200">
                      <PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden /> <span className="text-xs sm:text-sm">{line}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-slate-500">Orders are only marked dispatched once verified tracking details are entered.</p>
            </Card>
          </div>

          <Card label="Needs attention" title={`Flagged orders · ${s.attention.length}`} className={s.attention.length ? "border-warn/30" : ""}>
            {s.attention.length === 0 ? <Empty>No orders flagged.</Empty> : (
              <ul className="space-y-1.5 text-sm">
                {s.attention.map((a, i) => <li key={i} className="flex gap-2 text-warn-soft"><span className="shrink-0 text-slate-400">{a.orderId}</span><span className="text-slate-200">{a.reason}</span></li>)}
              </ul>
            )}
          </Card>

          <Card label="Reconciliation" title={<span className="inline-flex items-center gap-2">Orders vs Stripe <FakeBadge mode={recon.data?.mode} /></span>}>
            <ErrorBanner message={recon.error} />
            {!recon.data && !recon.error && <Loading label="Reconciling" />}
            {recon.data && (
              <>
                <p className="text-sm text-slate-200">{recon.data.summary}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {[
                    { label: "Paid orders without Stripe payment", items: recon.data.ordersWithoutPayment.map((x) => `${x.orderId}: ${x.reason}`) },
                    { label: "Stripe payments without an order", items: recon.data.paymentsWithoutOrder.map((x) => `${x.paymentIntentId}: ${aud(x.amountAud, { cents: true })}`) },
                    { label: "Amount mismatches", items: recon.data.amountMismatches.map((x) => `${x.orderId}: order ${aud(x.orderTotal, { cents: true })} vs Stripe ${aud(x.paymentAmount, { cents: true })}`) },
                    { label: "Pending orders already paid in Stripe", items: recon.data.pendingOrdersWithSucceededPayment.map((x) => `${x.orderId} ← ${x.paymentIntentId}`) },
                  ].map((g) => (
                    <div key={g.label} className={`rounded-xl border p-3 ${g.items.length ? "border-warn/30 bg-warn/5" : "border-white/5 bg-white/[0.02]"}`}>
                      <div className="label flex items-center justify-between">{g.label} <span className="numeral text-base">{g.items.length}</span></div>
                      {g.items.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-slate-300">{g.items.map((t, i) => <li key={i}>{t}</li>)}</ul>}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">{recon.data.matched.length} matched. Read-only check; nothing is changed without approval.</p>
              </>
            )}
          </Card>

          <Card label="Orders" title={`Recent · ${orders.data?.orders.length ?? 0}`}>
            {orders.data && orders.data.orders.length === 0 && <Empty>No orders in this range.</Empty>}
            <ul className="divide-y divide-white/5">
              {[...(orders.data?.orders ?? [])].sort((a, b) => (b.paidAt ?? b.createdAt).localeCompare(a.paidAt ?? a.createdAt)).map((o) => <OrderRow key={o.id} o={o} />)}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

import { useState } from "react";
import { Check, History, PenLine, X } from "lucide-react";
import { api, ApiError, aud, relTime, type ApprovalRequest, type Quote } from "../api";
import { usePoll } from "../hooks";
import { Card, Done, Empty, ErrorBanner, KV, Loading, RefreshButton } from "../components/ui";

type Decision = "approve" | "reject" | "revise";

function ApprovalCard({ a, onDone }: { a: ApprovalRequest; onDone: () => void }) {
  const [mode, setMode] = useState<"idle" | "revise">("idle");
  const [price, setPrice] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Decision | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (decision: Decision, body: { note?: string; priceAud?: number | null }) => {
    setBusy(decision);
    setError(null);
    try {
      const r = await api.decide(a.id, { decision, ...body });
      const q = r.quote as Quote | undefined;
      const sentRef = (r.result as { quote?: { sentProviderRef?: string; status?: string }; revised?: { quote?: { sentProviderRef?: string; priceExGstAud?: number; status?: string } } } | undefined);
      const revised = sentRef?.revised?.quote;
      const quote = revised ?? sentRef?.quote ?? q;
      if (decision === "approve") {
        setResult(quote?.status === "sent" ? `Approved${revised ? ` at ${aud(revised.priceExGstAud)}` : ""}. Sent (ref ${quote?.sentProviderRef ?? "pending"}).` : `Approved. ${quote?.status ? `Status: ${quote.status}.` : ""}`);
      } else if (decision === "reject") setResult("Rejected. Nothing was sent.");
      else setResult("Sent back to Atlas for revision.");
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message} (HTTP ${e.status})` : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const submitRevise = () => {
    const p = price.trim() ? Number(price) : null;
    if (p != null && (Number.isNaN(p) || p <= 0)) {
      setError("Enter a valid price in AUD, or leave it blank to send a note only.");
      return;
    }
    if (p != null) void send("approve", { priceAud: p, note: note || undefined });
    else void send("revise", { note: note || "Please revise." });
  };

  return (
    <Card strong className={a.card.risk ? "border-warn/30" : ""}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip border-accent/40 bg-accent/10 text-accent-soft">v{a.version}</span>
            <span className="text-[10px] uppercase tracking-wider text-slate-500">{a.business.replace("_", " ")} · {a.action}</span>
            <span className="text-[10px] text-slate-500">{relTime(a.requestedAt)}</span>
          </div>
          <h3 className="mt-1 text-base font-medium text-slate-50">{a.title}</h3>
        </div>
      </div>
      <dl className="mt-3 divide-y divide-white/5">
        {a.card.lines.map((l) => <KV key={l.label} k={l.label} v={l.value} />)}
      </dl>
      {a.card.risk && <p className="mt-2 rounded-lg border border-warn/30 bg-warn/10 p-2 text-xs text-warn-soft">Risk: {a.card.risk}</p>}
      {a.summary && <p className="mt-3 text-xs leading-relaxed text-slate-400">{a.summary}</p>}
      <p className="mt-2 text-[10px] text-slate-600">Bound to content {a.contentHash.slice(0, 10)}… Any change needs a new approval.</p>

      {result && <div className="mt-3"><Done>{result}</Done></div>}
      {error && <div className="mt-3"><ErrorBanner message={error} /></div>}

      {!result && (
        <div className="mt-4 space-y-3">
          {mode === "revise" && (
            <div className="rounded-xl border border-white/10 bg-ink-900/60 p-3">
              <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
                <label className="text-xs text-slate-300">
                  <span className="label mb-1 block">New price (A$, ex GST)</span>
                  <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 2490" />
                </label>
                <label className="text-xs text-slate-300">
                  <span className="label mb-1 block">Note to Atlas</span>
                  <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should change?" />
                </label>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">A new price approves that exact revised version and sends it. A note alone sends the quote back to Atlas as a new draft.</p>
              <div className="mt-2 flex gap-2">
                <button type="button" className="btn-accent text-xs" onClick={submitRevise} disabled={busy !== null}>{busy ? "Working…" : "Submit revision"}</button>
                <button type="button" className="btn-ghost text-xs" onClick={() => setMode("idle")} disabled={busy !== null}>Cancel</button>
              </div>
            </div>
          )}
          {mode === "idle" && (
            <div className="grid grid-cols-3 gap-2">
              {a.card.actions.includes("approve") && (
                <button type="button" className="btn-accent" onClick={() => void send("approve", {})} disabled={busy !== null}>
                  <Check className="h-4 w-4" aria-hidden /> {busy === "approve" ? "Sending…" : "Approve"}
                </button>
              )}
              {a.card.actions.includes("revise") && (
                <button type="button" className="btn-warn" onClick={() => setMode("revise")} disabled={busy !== null}>
                  <PenLine className="h-4 w-4" aria-hidden /> Revise
                </button>
              )}
              {a.card.actions.includes("reject") && (
                <button type="button" className="btn-danger" onClick={() => void send("reject", {})} disabled={busy !== null}>
                  <X className="h-4 w-4" aria-hidden /> {busy === "reject" ? "…" : "Reject"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function Approvals({ onDataChanged }: { onDataChanged: () => void }) {
  const pending = usePoll<ApprovalRequest[]>(() => api.approvals(), [], 20_000);
  const [showHistory, setShowHistory] = useState(false);
  const history = usePoll<ApprovalRequest[]>(() => (showHistory ? api.approvals(true) : Promise.resolve([])), [showHistory], 60_000);

  const done = () => {
    void pending.refresh();
    if (showHistory) void history.refresh();
    onDataChanged();
  };

  const past = (history.data ?? []).filter((a) => a.status !== "pending").sort((a, b) => (b.decidedAt ?? b.requestedAt).localeCompare(a.decidedAt ?? a.requestedAt));

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="label">Approvals inbox</div>
          <h1 className="text-xl font-medium text-slate-50">{pending.data ? `${pending.data.length} awaiting your decision` : "Approvals"}</h1>
        </div>
        <RefreshButton onClick={() => void pending.refresh()} loading={pending.loading} updatedAt={pending.updatedAt} />
      </header>
      <ErrorBanner message={pending.error} />
      {!pending.data && !pending.error && <Loading label="Loading approvals" />}
      {pending.data && pending.data.length === 0 && <Empty>Nothing needs your approval right now.</Empty>}
      <div className="grid gap-4 xl:grid-cols-2">
        {pending.data?.map((a) => <ApprovalCard key={a.id} a={a} onDone={done} />)}
      </div>

      <button type="button" className="btn-ghost text-xs" onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory}>
        <History className="h-3.5 w-3.5" aria-hidden /> {showHistory ? "Hide history" : "Show decision history"}
      </button>
      {showHistory && (
        <Card label="History" title="Past decisions">
          <ErrorBanner message={history.error} />
          {past.length === 0 ? <Empty>No past decisions.</Empty> : (
            <ul className="divide-y divide-white/5 text-sm">
              {past.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-slate-200">{a.title} <span className="text-slate-500">v{a.version}</span></span>
                  <span className={`chip ${a.status === "approved" || a.status === "consumed" ? "border-ok/40 bg-ok/10 text-ok-soft" : a.status === "rejected" ? "border-danger/40 bg-danger/10 text-danger-soft" : "border-white/10 bg-white/5 text-slate-300"}`}>{a.status.replace("_", " ")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

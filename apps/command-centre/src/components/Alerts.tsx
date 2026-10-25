import { useState } from "react";
import { Check } from "lucide-react";
import { api, relTime, type Notification, type Priority } from "../api";
import { Empty, PriorityChip } from "./ui";

const ORDER: Priority[] = ["critical", "action_needed", "routine"];
const TITLE: Record<Priority, string> = { critical: "Critical", action_needed: "Action needed", routine: "Routine" };

export function AlertList({ alerts, onChanged, onOpenApproval }: { alerts: Notification[]; onChanged: () => void; onOpenApproval?: (id: string) => void }) {
  const [acking, setAcking] = useState<string | null>(null);
  if (alerts.length === 0) return <Empty>No open alerts.</Empty>;
  const ack = async (id: string) => {
    setAcking(id);
    try {
      await api.ackAlert(id);
      onChanged();
    } finally {
      setAcking(null);
    }
  };
  return (
    <div className="space-y-4">
      {ORDER.map((p) => {
        const group = alerts.filter((a) => a.priority === p);
        if (group.length === 0) return null;
        return (
          <div key={p}>
            <div className="label mb-2">{TITLE[p]} · {group.length}</div>
            <ul className="space-y-2">
              {group.map((a) => (
                <li key={a.id} className={`glass p-3 ${p === "critical" ? "border-danger/40" : p === "action_needed" ? "border-warn/30" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <PriorityChip priority={a.priority} />
                        <span className="text-[10px] uppercase tracking-wider text-slate-500">{a.business.replace("_", " ")}</span>
                        <span className="text-[10px] text-slate-500">{relTime(a.createdAt)}</span>
                      </div>
                      <div className="mt-1 text-sm font-medium text-slate-100">{a.title}</div>
                      {a.body && <div className="mt-0.5 whitespace-pre-line text-xs text-slate-400">{a.body}</div>}
                      {a.deliveries.length > 1 && (
                        <div className="mt-1 text-[10px] text-slate-500">Delivered via {a.deliveries.map((d) => d.channel).join(", ")}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      {a.link?.type === "approval" && onOpenApproval && (
                        <button type="button" className="btn-warn !px-2.5 !py-1 text-xs" onClick={() => onOpenApproval(a.link!.id)}>Review</button>
                      )}
                      <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => void ack(a.id)} disabled={acking === a.id} aria-label={`Acknowledge ${a.title}`}>
                        <Check className="h-3.5 w-3.5" aria-hidden /> Ack
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

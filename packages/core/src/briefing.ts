import type { ApprovalRequest } from "./approvals.js";
import type { Notification } from "./notifications.js";
import type { Prospect } from "./wulff/prospects.js";
import type { Quote } from "./wulff/quotes.js";
import type { OrderSummary } from "./boxsafe/orders.js";
import type { ConnectionStatus } from "./adapters/types.js";
import { spokenOrderSummary } from "./boxsafe/orders.js";

export interface BriefingInput {
  now: Date;
  connections: ConnectionStatus[];
  approvals: ApprovalRequest[];
  alerts: Notification[];
  prospects: Prospect[];
  quotes: Quote[];
  boxsafe: OrderSummary | null;
  boxsafeMode: "live" | "fake" | "unavailable";
  budget: { limitAud: number; spentAud: number };
}

export interface Briefing {
  generatedAt: string;
  greeting: string;
  spoken: string;
  sections: { heading: string; lines: string[] }[];
  /** The five questions every important update answers (section 3). */
  structure: { happened: string[]; completed: string[]; recommend: string[]; needsApproval: string[]; next: string[] };
  dataNotice: string;
}

function greetingFor(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", hourCycle: "h23" }).format(now));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export function composeBriefing(i: BriefingInput): Briefing {
  const pending = i.approvals.filter((a) => a.status === "pending");
  const critical = i.alerts.filter((a) => a.priority === "critical" && !a.acknowledgedAt);
  const actions = i.alerts.filter((a) => a.priority === "action_needed" && !a.acknowledgedAt);
  const qualified = i.prospects.filter((p) => p.qualification === "qualified");
  const sentQuotes = i.quotes.filter((q) => q.status === "sent");
  const drafts = i.quotes.filter((q) => q.status === "draft" || q.status === "approval_pending");
  const notConnected = i.connections.filter((c) => c.state !== "connected");

  const happened: string[] = [];
  const completed: string[] = [];
  const recommend: string[] = [];
  const needsApproval: string[] = [];
  const next: string[] = [];

  if (critical.length) happened.push(`${critical.length} critical issue${critical.length === 1 ? "" : "s"}: ${critical.map((c) => c.title).join("; ")}.`);
  if (i.boxsafe) happened.push(spokenOrderSummary(i.boxsafe));
  if (sentQuotes.length) happened.push(`${sentQuotes.length} Wulff Studio quote${sentQuotes.length === 1 ? " is" : "s are"} with customers awaiting a decision.`);
  if (qualified.length) completed.push(`${qualified.length} qualified prospect${qualified.length === 1 ? "" : "s"} on file with evidence.`);
  if (drafts.length) completed.push(`${drafts.length} quote draft${drafts.length === 1 ? "" : "s"} prepared.`);
  if (i.boxsafe?.needsDispatch.length) recommend.push(`Dispatch ${i.boxsafe.needsDispatch.length} merchandise order${i.boxsafe.needsDispatch.length === 1 ? "" : "s"}; I have the packing summary ready.`);
  if (i.boxsafe?.attention.length) recommend.push(`Review ${i.boxsafe.attention.length} BoxSafe order${i.boxsafe.attention.length === 1 ? "" : "s"} flagged for reconciliation.`);
  for (const a of pending) needsApproval.push(`${a.title} (v${a.version}).`);
  for (const a of actions) if (!a.link || a.link.type !== "approval") needsApproval.push(a.title + ".");
  if (pending.length === 0 && actions.length === 0) needsApproval.push("Nothing needs your approval right now.");
  next.push(pending.length ? "Once you decide on the approvals above I will send the approved versions and monitor replies." : "I will keep checking enquiries, orders and quotes on the scheduled runs.");
  if (notConnected.length) next.push(`Connections not live: ${notConnected.map((c) => c.name).join(", ")}. Figures from those sources are ${i.boxsafeMode === "fake" ? "fictional test data" : "unavailable"}.`);

  const greeting = greetingFor(i.now);
  const spokenParts = [greeting + ".", ...happened, ...needsApproval.slice(0, 2)];
  if (i.boxsafeMode === "fake") spokenParts.push("Note: BoxSafe figures are fictional until the live connection is authorised.");
  const spoken = spokenParts.join(" ");

  return {
    generatedAt: i.now.toISOString(),
    greeting,
    spoken,
    sections: [
      { heading: "What happened", lines: happened.length ? happened : ["No new activity."] },
      { heading: "Completed", lines: completed.length ? completed : ["No completed work to report."] },
      { heading: "Recommendations", lines: recommend.length ? recommend : ["No recommendations right now."] },
      { heading: "Needs your approval", lines: needsApproval },
      { heading: "What happens next", lines: next },
      { heading: "Budget", lines: [`A$${i.budget.spentAud.toFixed(2)} in recorded costs against the A$${i.budget.limitAud} authorised experimentation limit.`, "Recorded costs only; hosting/provider billing is not connected."] },
    ],
    structure: { happened, completed, recommend, needsApproval, next },
    dataNotice: i.boxsafeMode === "live" ? "BoxSafe figures are from the live connection." : i.boxsafeMode === "fake" ? "BoxSafe figures are FICTIONAL test data; no live connection." : "BoxSafe data unavailable.",
  };
}

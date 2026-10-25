/** Section 10 project stages. Evidence-based, forward-only except explicit regressions. */
export const STAGES = [
  "research",
  "qualified",
  "contact_eligible",
  "contacted",
  "replied",
  "discovery",
  "draft_quote",
  "approval_pending",
  "quote_sent",
  "accepted",
  "deposit_confirmed",
  "in_development",
  "quality_review",
  "client_acceptance",
  "live",
  "maintenance",
] as const;

export type Stage = (typeof STAGES)[number];

/** A researched business becomes a customer only from `accepted` onwards. */
export function isCustomerStage(stage: Stage): boolean {
  return STAGES.indexOf(stage) >= STAGES.indexOf("accepted");
}

const ALLOWED: Partial<Record<Stage, Stage[]>> = {
  research: ["qualified"],
  qualified: ["contact_eligible", "research", "draft_quote"],
  contact_eligible: ["contacted", "qualified", "draft_quote"],
  contacted: ["replied", "contact_eligible"],
  replied: ["discovery", "draft_quote"],
  discovery: ["draft_quote"],
  draft_quote: ["approval_pending"],
  approval_pending: ["quote_sent", "draft_quote"],
  quote_sent: ["accepted", "draft_quote", "replied"],
  accepted: ["deposit_confirmed"],
  deposit_confirmed: ["in_development"],
  in_development: ["quality_review"],
  quality_review: ["client_acceptance", "in_development"],
  client_acceptance: ["live", "in_development"],
  live: ["maintenance"],
  maintenance: ["in_development"],
};

export function canTransition(from: Stage, to: Stage): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

export class StageTransitionError extends Error {
  constructor(from: Stage, to: Stage) {
    super(`Cannot move from ${from} to ${to}`);
    this.name = "StageTransitionError";
  }
}

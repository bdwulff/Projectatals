/**
 * Permission levels from the Project Atlas brief (section 16).
 * Every action Atlas can take is registered here with the level it requires.
 */
export enum PermissionLevel {
  Read = 1,
  Prepare = 2,
  ExecuteRoutine = 3,
  OwnerApproval = 4,
  HumanControlled = 5,
}

export type ActionKind =
  // Level 1 — Read
  | "read.device.status"
  | "read.device.files"
  | "read.records"
  | "read.mail.inbox"
  | "read.mail.message"
  | "read.discovery.program"
  | "read.discovery.source"
  | "read.website"
  | "read.boxsafe.orders"
  | "read.boxsafe.members"
  | "read.stripe.payments"
  // Level 2 — Prepare
  | "prepare.owner_transcription"
  | "prepare.research"
  | "prepare.quote_draft"
  | "prepare.email_draft"
  | "prepare.design_concept"
  | "prepare.code_change"
  | "prepare.fulfilment_summary"
  // Level 3 — Execute approved routine actions
  | "execute.owner_speech"
  | "execute.discovery.configure"
  | "execute.discovery.run"
  | "execute.device.open_browser"
  | "execute.device.open_app"
  | "execute.internal_notification"
  | "execute.schedule_job"
  | "execute.record_update"
  | "execute.boxsafe.tracking_entry"
  // Level 4 — Owner approval required
  | "approve.quote_send"
  | "approve.scope_change"
  | "approve.spend"
  | "approve.customer_email"
  | "approve.production_deploy"
  | "approve.outreach_campaign"
  | "approve.boxsafe.admin_correction"
  // Level 5 — Human-controlled
  | "human.identity_verification"
  | "human.credential_change"
  | "human.legal_agreement"
  | "human.bank_operation"
  | "human.medical_or_eligibility_decision";

const LEVELS: Record<ActionKind, PermissionLevel> = {
  "read.device.status": PermissionLevel.Read,
  "read.device.files": PermissionLevel.Read,
  "read.records": PermissionLevel.Read,
  "read.mail.inbox": PermissionLevel.Read,
  "read.mail.message": PermissionLevel.Read,
  "read.discovery.program": PermissionLevel.Read,
  "read.discovery.source": PermissionLevel.Read,
  "read.website": PermissionLevel.Read,
  "read.boxsafe.orders": PermissionLevel.Read,
  "read.boxsafe.members": PermissionLevel.Read,
  "read.stripe.payments": PermissionLevel.Read,
  "prepare.owner_transcription": PermissionLevel.Prepare,
  "prepare.research": PermissionLevel.Prepare,
  "prepare.quote_draft": PermissionLevel.Prepare,
  "prepare.email_draft": PermissionLevel.Prepare,
  "prepare.design_concept": PermissionLevel.Prepare,
  "prepare.code_change": PermissionLevel.Prepare,
  "prepare.fulfilment_summary": PermissionLevel.Prepare,
  "execute.owner_speech": PermissionLevel.ExecuteRoutine,
  "execute.discovery.configure": PermissionLevel.ExecuteRoutine,
  "execute.discovery.run": PermissionLevel.ExecuteRoutine,
  "execute.device.open_browser": PermissionLevel.ExecuteRoutine,
  "execute.device.open_app": PermissionLevel.ExecuteRoutine,
  "execute.internal_notification": PermissionLevel.ExecuteRoutine,
  "execute.schedule_job": PermissionLevel.ExecuteRoutine,
  "execute.record_update": PermissionLevel.ExecuteRoutine,
  "execute.boxsafe.tracking_entry": PermissionLevel.ExecuteRoutine,
  "approve.quote_send": PermissionLevel.OwnerApproval,
  "approve.scope_change": PermissionLevel.OwnerApproval,
  "approve.spend": PermissionLevel.OwnerApproval,
  "approve.customer_email": PermissionLevel.OwnerApproval,
  "approve.production_deploy": PermissionLevel.OwnerApproval,
  "approve.outreach_campaign": PermissionLevel.OwnerApproval,
  "approve.boxsafe.admin_correction": PermissionLevel.OwnerApproval,
  "human.identity_verification": PermissionLevel.HumanControlled,
  "human.credential_change": PermissionLevel.HumanControlled,
  "human.legal_agreement": PermissionLevel.HumanControlled,
  "human.bank_operation": PermissionLevel.HumanControlled,
  "human.medical_or_eligibility_decision": PermissionLevel.HumanControlled,
};

export function requiredLevel(action: ActionKind): PermissionLevel {
  return LEVELS[action];
}

/** Atlas may execute Levels 1-3 autonomously. Level 4 needs an exact-version approval. Level 5 is never automated. */
export function canAutoExecute(action: ActionKind): boolean {
  return requiredLevel(action) <= PermissionLevel.ExecuteRoutine;
}

export function needsOwnerApproval(action: ActionKind): boolean {
  return requiredLevel(action) === PermissionLevel.OwnerApproval;
}

export function isHumanOnly(action: ActionKind): boolean {
  return requiredLevel(action) === PermissionLevel.HumanControlled;
}

export class PermissionDeniedError extends Error {
  constructor(public readonly action: ActionKind, public readonly reason: string) {
    super(`Permission denied for ${action}: ${reason}`);
    this.name = "PermissionDeniedError";
  }
}

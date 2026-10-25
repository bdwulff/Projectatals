import type { Store } from "./store.js";
import { newId, nowIso } from "./ids.js";

export type Actor = "atlas" | "owner" | "system" | `agent:${string}`;

export interface AuditEntry {
  id: string;
  at: string;
  actor: Actor;
  action: string;
  business: Business | "atlas";
  targetType?: string;
  targetId?: string;
  outcome: "completed" | "attempted" | "simulated" | "awaiting_approval" | "failed" | "denied";
  detail?: Record<string, unknown>;
}

export type Business = "wulff_studio" | "boxsafe";

export class AuditLog {
  constructor(private readonly store: Store) {}

  record(entry: Omit<AuditEntry, "id" | "at">): AuditEntry {
    const full: AuditEntry = { id: newId("aud"), at: nowIso(), ...entry };
    this.store.insertAudit(full);
    return full;
  }

  recent(limit = 100): AuditEntry[] {
    return this.store.listAudit(limit);
  }
}

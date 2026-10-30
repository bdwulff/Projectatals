import { ApiError, SESSION_EXPIRED_EVENT } from "./api";

export type OutreachStageId = "initial" | "follow_up_1" | "follow_up_2";
export type OutreachStatus = "active" | "hold" | "replied" | "do_not_contact" | "closed";
export type OutreachAction = "reviewed" | "sent" | "replied" | "hold" | "do_not_contact" | "closed" | "resume";
export interface OutreachStage {
  id: OutreachStageId; to: string; subject: string; text: string;
  contentHash: string; reviewed: boolean; sentAt: string | null; dueAt: string | null; ready: boolean;
}
export interface ManualOutreachRow {
  leadId: string; businessName: string; location: string; industry: string;
  sourceUrl: string; observation: string; opportunity?: string; reviewFlags?: string[]; checkedAt: string | null;
  previewUrl: string | null; previewReady: boolean; proofUrl: string;
  eligible: boolean; holdReason: string | null; revision: number; status: OutreachStatus;
  stages: OutreachStage[]; sourceKind: "reviewed_seed" | "daily_research";
}
export interface ManualOutreachSnapshot {
  mode: "live" | "fake"; generatedAt: string; day: string; timeZone: "Australia/Melbourne";
  schedule: { enabled: boolean; startHour: number; target: number };
  counts: { ready: number; due: number; hold: number; newToday: number; shortfall: number };
  rows: ManualOutreachRow[]; notes: string[];
}
export interface ManualOutreachUpdate { expectedRevision: number; action: OutreachAction; stage?: OutreachStageId; expectedDraftHash?: string }

async function request(path = "", body?: ManualOutreachUpdate): Promise<ManualOutreachSnapshot> {
  const response = await fetch(`/api/manual-outreach${path}`, {
    method: body ? "POST" : "GET", credentials: "same-origin",
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    const detail = result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : "Your outreach queue is unavailable. Refresh and try again.";
    throw new ApiError(response.status, detail);
  }
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) throw new Error("The outreach queue returned an incomplete response. Refresh and try again.");
  return result as ManualOutreachSnapshot;
}

export const manualOutreach = {
  snapshot: () => request(),
  update: (leadId: string, input: ManualOutreachUpdate) => request(`/leads/${encodeURIComponent(leadId)}`, input),
};

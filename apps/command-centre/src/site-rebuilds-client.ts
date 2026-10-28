import { ApiError, SESSION_EXPIRED_EVENT } from "./api";

export interface SiteRebuildEvidence { observation: string; sourceUrl: string; status: string; uncertainty?: string }
export interface SiteRebuildCandidate {
  prospectId: string; leadId?: string; name: string; location: string; industry: string;
  classification: "not_recorded" | "social_only"; classificationLabel: string;
  evidence: SiteRebuildEvidence[]; uncertainty: string;
}
export interface SiteRebuildBusiness extends SiteRebuildCandidate {
  state: "pending" | "building" | "ready" | "skipped" | "failed";
  demoReady: boolean; previewPath?: string; sourcePath?: string;
  design?: Record<string, unknown>; error?: string;
}
export interface SiteRebuildReport {
  id: string; state: "queued" | "running" | "completed" | "partial" | "failed";
  startedAt: string; finishedAt?: string; targetCount: number; rebuiltCount: number; skippedCount: number;
  businesses: SiteRebuildBusiness[]; errors: string[]; spokenSummary: string; fixture: boolean;
  notificationId?: string; reviewPath: string;
}
export interface SiteRebuildSnapshot {
  mode: "live" | "fake"; candidates: SiteRebuildCandidate[]; excludedCount: number;
  latestReport: SiteRebuildReport | null; reports: SiteRebuildReport[];
  run: { state: "idle" | "queued" | "running" | "completed" | "partial" | "failed"; detail: string };
}

async function request(path: string, body?: unknown, optional = false): Promise<SiteRebuildSnapshot | null> {
  const response = await fetch(`/api/site-rebuilds${path}`, {
    method: body === undefined ? "GET" : "POST", credentials: "same-origin",
    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (optional && response.status === 404) return null;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw new ApiError(response.status, payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : "The website review list could not be loaded. Try again after checking the connection.");
  }
  return payload as SiteRebuildSnapshot;
}
export const siteRebuilds = {
  snapshot: () => request("") as Promise<SiteRebuildSnapshot>,
  optionalSnapshot: () => request("", undefined, true),
  run: () => request("/run", {}) as Promise<SiteRebuildSnapshot>,
};

/** Review links stay inside this private app. Business/source strings never become navigation code. */
export function siteReviewPath(leadId?: string, reportId?: string): string {
  const params = new URLSearchParams();
  if (leadId && /^[A-Za-z0-9_-]{1,200}$/.test(leadId)) params.set("review", leadId);
  if (reportId && /^[A-Za-z0-9_-]{1,200}$/.test(reportId)) params.set("batch", reportId);
  return `#pipeline${params.size ? `?${params}` : ""}`;
}

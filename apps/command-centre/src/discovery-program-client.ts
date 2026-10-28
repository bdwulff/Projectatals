import { ApiError, SESSION_EXPIRED_EVENT } from "./api";

export interface DiscoveryProgramSettings {
  enabled: boolean;
  area: string;
  industry: string;
  count: number;
  templateId: "clarity" | "immersive";
  companyName: string;
  companyWebsite: string;
  timeZone: "Australia/Melbourne";
}
export interface DiscoveryProgramBusiness {
  leadId: string;
  name: string;
  location: string;
  demoReady: boolean;
  draftReady: boolean;
  logoIncluded: boolean;
  photoCount: number;
  recipientMissing: boolean;
}
export interface DiscoveryProgramReport {
  id: string;
  day: string;
  state: "queued" | "running" | "completed" | "partial" | "failed" | "skipped" | "already_ran";
  trigger: "manual" | "scheduled";
  startedAt: string;
  finishedAt?: string;
  foundCount: number;
  reusedCount: number;
  newCandidateCount: number;
  preparedCount: number;
  draftCount: number;
  logoCount: number;
  photoCount: number;
  alreadyReadyCount: number;
  businesses: DiscoveryProgramBusiness[];
  errors: string[];
  spokenSummary: string;
  fixture: boolean;
}
export interface DiscoveryProgramSnapshot {
  mode: "live" | "fake";
  configured: boolean;
  settings: DiscoveryProgramSettings;
  availability: { state: "connected" | "not_connected" | "error" | "fake"; detail: string };
  latestReport: DiscoveryProgramReport | null;
  reports: DiscoveryProgramReport[];
  run: { state: "idle" | "queued" | "running" | "completed" | "partial" | "failed" | "skipped" | "already_ran" | "blocked"; detail: string; jobId?: string };
  costs: { lovableCredits: 0; elevenLabsCredits: 0; llmTokens: 0; detail: string };
}

async function request(body?: unknown, path = ""): Promise<DiscoveryProgramSnapshot> {
  const response = await fetch(`/api/discovery-program${path}`, {
    method: body === undefined ? "GET" : "POST", credentials: "same-origin",
    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    const detail = result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : "The discovery program could not be updated. Check its status and try again.";
    throw new ApiError(response.status, detail);
  }
  return result as DiscoveryProgramSnapshot;
}

export const discoveryProgram = {
  snapshot: () => request(),
  settings: (settings: DiscoveryProgramSettings) => request(settings, "/settings"),
  run: () => request({}, "/run"),
};

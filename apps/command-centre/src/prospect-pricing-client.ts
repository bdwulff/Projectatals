import { ApiError, SESSION_EXPIRED_EVENT } from "./api";
import type { ManualEmailDraft } from "./email-export";

export type ManualEmailStatus = "not_sent" | "sent" | "replied" | "follow_up" | "closed" | "do_not_contact";
export interface ProspectPricingRow {
  leadId: string; prospectId: string; businessName: string; location: string; industry: string;
  createdAt: string; discoveryDay: string; discoveryDays: string[]; services: string[];
  website: string | null; websiteStatus: "own_site" | "social_only" | "not_recorded" | "unknown"; noWebsite: boolean;
  sourceUrl: string; observation: string; contactEmail: string | null; contactSourceUrl: string | null;
  contactReviewRequired: boolean; businessPhone: string | null; address: string | null;
  demoReady: boolean; previewPath: string | null; previewUrl: string | null; sourcePath: string | null; sourceDownloadUrl: string | null; reviewPath: string;
  draft: (ManualEmailDraft & { status: string }) | null;
  price: { revision: number; suggestedQuoteAud: number; quoteBasis: "existing_internal_recommendation" | "services_heuristic" | "owner_edited"; proposedPages: number; proposedScope: string; gstStatus: "unconfirmed"; exclusions: string[]; manualEmailStatus: ManualEmailStatus; manualEmailSentAt: string | null; notes: string; updatedAt: string };
}
export interface ProspectPricingSnapshot {
  mode: "live" | "fake"; currency: "AUD"; timeZone: "Australia/Melbourne"; generatedAt: string; day: string | null;
  sender: { name: string; organisation: string; email: string; contactDetails: string; ownerPhone: string };
  rows: ProspectPricingRow[]; notes: string[];
}
export interface UpdateProspectPricing { expectedRevision: number; suggestedQuoteAud?: number; proposedScope?: string; manualEmailStatus?: ManualEmailStatus; manualEmailSentAt?: string | null; notes?: string }
async function request(path = "", body?: UpdateProspectPricing): Promise<ProspectPricingSnapshot> {
  const response = await fetch(`/api/prospect-pricing${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    const detail = result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : "The outreach spreadsheet could not be updated.";
    throw new ApiError(response.status, detail);
  }
  return result as ProspectPricingSnapshot;
}
export const prospectPricing = {
  snapshot: () => request(),
  update: (leadId: string, input: UpdateProspectPricing) => request(`/leads/${encodeURIComponent(leadId)}`, input),
};

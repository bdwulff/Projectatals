import { ApiError, SESSION_EXPIRED_EVENT } from "./api";

export type DemoTemplateId = "fieldwork" | "momentum" | "folio" | "clarity";
export interface AcquisitionTemplate {
  id: DemoTemplateId;
  name: string;
  category: "trades" | "fitness" | "professional";
  description: string;
  implementation: "original_wulff_studio";
  inspiration: { name: string; sourceUrl: string; licence: "MIT"; licenceUrl: string; verifiedAt: string; copiedCode: false; copiedAssets: false };
  visualReference?: { name: string; sourceUrl: string; copiedCode: false; copiedAssets: false };
  attribution: string;
}
export interface AcquisitionConnection { state: "connected" | "not_connected" | "error" | "fake"; provider: string; detail: string }
export type AcquisitionMailProviderId = "gmail" | "resend";
export interface AcquisitionMailProvider {
  id: AcquisitionMailProviderId; name: string; description: string; requiredSettings: string[];
  setupSteps: string[]; notes: string[]; selected: boolean; status: AcquisitionConnection;
}
export interface AcquisitionMailProviders { selected: AcquisitionMailProviderId | null; providers: AcquisitionMailProvider[] }
export interface AcquisitionSender { name: string; organisation: string; email: string; contactDetails: string; ready: boolean; detail: string }
export type ContactBasis = "none_established" | "express_consent" | "existing_relationship" | "inferred_consent_business";
export interface AcquisitionContact {
  email: string; sourceUrl: string; basis: ContactBasis; evidence: string;
  roleRelevant: boolean; noMarketingProhibition: boolean; reviewedBy?: string; reviewedAt?: string;
}
export interface AcquisitionDemo {
  id: string; templateId: DemoTemplateId; templateName: string; htmlHash: string; previewPath: string;
  publicPath: string | null; publishedAt?: string; expiresAt: string;
}
export type OutreachStatus = "draft" | "blocked" | "awaiting_approval" | "queued" | "submitting" | "accepted" | "failed" | "uncertain" | "cancelled" | "simulated";
export interface AcquisitionDraft {
  id: string; version: number; from: string; to: string; subject: string; text: string;
  contentHash: string; status: OutreachStatus; blockers: string[]; approvalId?: string; providerRef?: string; acceptedAt?: string;
}
export interface AcquisitionBusinessImage {
  sourceUrl: string; alt: string; mime: "image/png" | "image/jpeg" | "image/webp";
  sha256: string; width: number; height: number;
}
export interface AcquisitionBusinessProfile {
  state: "ready" | "partial" | "unavailable" | "fictional"; detail: string; sourceUrl: string; fetchedAt: string;
  description?: string; address?: string; phone?: string; services: string[]; notices: string[];
  logo?: AcquisitionBusinessImage; images: AcquisitionBusinessImage[];
}
export interface AcquisitionRecord {
  id: string; prospectId: string; businessName: string; location: string; industry: string; website: string | null;
  sourceUrl: string; observation: string; services: string[]; createdAt: string; updatedAt: string;
  businessProfile?: AcquisitionBusinessProfile;
  contact: AcquisitionContact | null; demo: AcquisitionDemo | null; draft: AcquisitionDraft | null;
}
export interface AcquisitionSnapshot {
  mode: "live" | "fake"; templates: AcquisitionTemplate[]; discovery: AcquisitionConnection; email: AcquisitionConnection;
  sender: AcquisitionSender; records: AcquisitionRecord[];
}
export interface AddAcquisitionLead {
  businessName: string; location: string; industry: string; website?: string | null; sourceUrl: string;
  observation: string; services?: string[]; contactEmail?: string; contactSourceUrl?: string;
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/acquisition${path}`, {
    method: body === undefined ? "GET" : "POST", credentials: "same-origin",
    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let result: unknown;
  try { result = await response.json(); } catch { result = null; }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    const error = result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : `The studio could not complete that request (HTTP ${response.status}).`;
    throw new ApiError(response.status, error);
  }
  return result as T;
}
const leadPath = (id: string) => `/leads/${encodeURIComponent(id)}`;
export const acquisition = {
  snapshot: () => request<AcquisitionSnapshot>(""),
  googleLink: () => request<{ url: string }>("/google/link", {}),
  mailProviders: () => request<AcquisitionMailProviders>("/mail/providers"),
  selectMailProvider: (provider: AcquisitionMailProviderId) => request<AcquisitionSnapshot>("/mail/provider", { provider }),
  discover: (input: { area: string; industry?: string; count: number }) => request<AcquisitionSnapshot>("/discover", input),
  addLead: (input: AddAcquisitionLead) => request<AcquisitionSnapshot>("/leads", input),
  enrich: (id: string) => request<AcquisitionSnapshot>(`${leadPath(id)}/enrich`, { refresh: true }),
  prepare: (id: string, templateId?: DemoTemplateId) => request<AcquisitionSnapshot>(`${leadPath(id)}/prepare`, templateId ? { templateId } : {}),
  saveContact: (id: string, contact: Omit<AcquisitionContact, "reviewedBy" | "reviewedAt">) => request<AcquisitionSnapshot>(`${leadPath(id)}/contact`, contact),
  saveSender: (sender: Pick<AcquisitionSender, "name" | "organisation" | "email" | "contactDetails">) => request<AcquisitionSnapshot>("/sender", sender),
  saveDraft: (id: string, input: { subject: string; text: string; expectedHash: string }) => request<AcquisitionSnapshot>(`${leadPath(id)}/draft`, input),
  approveSend: (id: string, expectedHash: string) => request<AcquisitionSnapshot>(`${leadPath(id)}/approve-send`, { expectedHash }),
  publish: (id: string, expectedHtmlHash: string) => request<AcquisitionSnapshot>(`${leadPath(id)}/publish`, { expectedHtmlHash }),
  revoke: (id: string) => request<AcquisitionSnapshot>(`${leadPath(id)}/revoke`, {}),
};

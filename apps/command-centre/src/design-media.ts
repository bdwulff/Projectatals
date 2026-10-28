import type { AcquisitionRecord } from "./acquisition-client";

export interface TemplateReference { name: string; sourceUrl: string; previewUrl?: string }
const count = (value: unknown): number | null => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100 ? value : null;
const safeUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length > 2048) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
};
function designHasMedia(value?: Record<string, unknown>): boolean {
  return Boolean(value && (count(value.placeholderPhotoCount) !== null || count(value.businessPhotoCount) !== null || value.logoKind === "business" || value.logoKind === "concept"));
}

/** Describes photographs actually included in a concept, separately from collected business assets. */
export function demoMedia(record?: AcquisitionRecord | null, reportDesign?: Record<string, unknown>) {
  const stored = record?.demo?.designBrief as Record<string, unknown> | undefined;
  const design = designHasMedia(reportDesign) ? reportDesign : stored;
  const businessPhotos = count(design?.businessPhotoCount) ?? record?.businessProfile?.images.length ?? 0;
  const illustrativePhotos = count(design?.placeholderPhotoCount) ?? 0;
  const logoKind = design?.logoKind === "business" || design?.logoKind === "concept" ? design.logoKind : record?.businessProfile?.logo ? "business" : null;
  const parts: string[] = [];
  if (businessPhotos) parts.push(`${businessPhotos} business photo${businessPhotos === 1 ? "" : "s"}`);
  if (illustrativePhotos) parts.push(`${illustrativePhotos} illustrative photo${illustrativePhotos === 1 ? "" : "s"}`);
  if (!businessPhotos && !illustrativePhotos) parts.push("Photos not added to this concept");
  parts.push(logoKind === "business" ? "Business logo" : logoKind === "concept" ? "Concept logo" : "Logo not added");
  const references: TemplateReference[] = [];
  if (Array.isArray(design?.templateReferences)) for (const raw of design.templateReferences.slice(0, 12)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>, sourceUrl = safeUrl(item.sourceUrl), previewUrl = safeUrl(item.previewUrl);
    if (sourceUrl && typeof item.name === "string" && item.name.trim() && !references.some(ref => ref.sourceUrl === sourceUrl)) references.push({ name: item.name.trim().slice(0, 160), sourceUrl, ...(previewUrl ? { previewUrl } : {}) });
  }
  return { businessPhotos, illustrativePhotos, totalPhotos: businessPhotos + illustrativePhotos, logoKind, summary: parts.join(" · "), hasPlaceholders: illustrativePhotos > 0 || logoKind === "concept", references };
}

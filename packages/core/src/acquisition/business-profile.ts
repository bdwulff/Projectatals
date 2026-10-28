/** A bounded snapshot of facts and artwork actually found on a company's public website. */
export interface BusinessImage {
  dataUrl: string;
  sourceUrl: string;
  alt: string;
  mime: "image/png" | "image/jpeg" | "image/webp";
  sha256: string;
  width: number;
  height: number;
}

export interface BusinessProfile {
  /** Recorded research facts do not establish that the official website has been fetched. */
  sourceKind?: "public_research" | "website_fetch";
  state: "ready" | "partial" | "unavailable" | "fictional";
  detail: string;
  sourceUrl: string;
  fetchedAt: string;
  description?: string;
  address?: string;
  phone?: string;
  /** Publicly listed contact candidate only; discovery never establishes permission to email. */
  contactEmail?: string;
  contactSourceUrl?: string;
  services: string[];
  logo?: BusinessImage;
  images: BusinessImage[];
  notices: string[];
}

/** Dashboard summaries omit the embedded image bytes; only the protected HTML needs those. */
export type BusinessProfileSummary = Omit<BusinessProfile, "logo" | "images"> & {
  logo?: Omit<BusinessImage, "dataUrl">;
  images: Array<Omit<BusinessImage, "dataUrl">>;
};

export interface BusinessProfileEnricher {
  enrich(input: { businessName: string; website: string | null; location: string }): Promise<BusinessProfile>;
}

export function businessProfileSummary(profile: BusinessProfile): BusinessProfileSummary {
  const image = ({ dataUrl: _dataUrl, ...summary }: BusinessImage) => summary;
  return { ...profile, ...(profile.logo ? { logo: image(profile.logo) } : {}), images: profile.images.map(image) };
}

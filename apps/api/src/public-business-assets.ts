import { contentHash, isCustomerStage, PermissionLevel, requiredLevel, type AcquisitionRecord, type BusinessProfile } from "@atlas/core";
import type { Hono } from "hono";
import { PublicBusinessAssetError, PublicBusinessAssetImporter, safeBusinessAssetUrl, type PublicBusinessAssetCandidate } from "./acquisition-assets.js";
import type { Runtime } from "./runtime.js";

const PROFILES = "acquisition_business_profiles", RECORDS = "acquisition_records";
const UNSAFE = new Set(["accepted", "queued", "submitting", "uncertain", "simulated", "cancelled"]);

/** Mount behind owner-session, same-origin JSON and normal request-size middleware. */
export function installPublicBusinessAssetRoutes(app: Hono, rt: Runtime, importer = new PublicBusinessAssetImporter()) {
  app.post("/api/acquisition/leads/:id/public-assets", async c => {
    try {
      if (requiredLevel("prepare.design_concept") !== PermissionLevel.Prepare) throw new PublicBusinessAssetError("Business artwork preparation is unavailable under the current action policy.", 503);
      if (rt.mode !== "live") throw new PublicBusinessAssetError("Fictional mode does not contact real public business sources.", 409);
      const input: unknown = await c.req.json();
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new PublicBusinessAssetError("Provide the cited business page and selected artwork references.");
      const value = input as Record<string, unknown>;
      if (Object.keys(value).some(key => !["sourcePageUrl", "images"].includes(key)) || typeof value.sourcePageUrl !== "string" || !Array.isArray(value.images)) throw new PublicBusinessAssetError("Use only the cited sourcePageUrl and selected images.");
      const id = c.req.param("id");
      const record = rt.atlas.deps.store.getDoc<AcquisitionRecord>(RECORDS, id)?.doc;
      if (!record || record.archivedAt || record.website || UNSAFE.has(record.draft?.status ?? "draft")) throw new PublicBusinessAssetError("Choose a current editable prospect with no own website recorded.", 409);
      const prospect = rt.atlas.prospects.require(record.prospectId);
      if (prospect.fixture || prospect.website || prospect.qualification === "disqualified" || isCustomerStage(prospect.stage) || prospect.contactEligibility.suppressed) throw new PublicBusinessAssetError("Fictional, established-site, customer or suppressed prospects cannot import live public artwork.", 409);
      let pageUrl: string, recordedSource: string;
      try { pageUrl = safeBusinessAssetUrl(value.sourcePageUrl).href; recordedSource = safeBusinessAssetUrl(record.sourceUrl).href; }
      catch { throw new PublicBusinessAssetError("Use the exact recorded public HTTPS business source."); }
      if (pageUrl !== recordedSource) throw new PublicBusinessAssetError("The selected page must match this prospect's exact cited source.", 409);
      const profile = rt.atlas.deps.store.getDoc<BusinessProfile>(PROFILES, id)?.doc ?? null;
      const revision = contentHash({ record, profile, prospect });
      const assets = await importer.import({ businessName: record.businessName, sourcePageUrl: pageUrl, images: value.images as PublicBusinessAssetCandidate[] });
      const updated = rt.acquisition.applyVerifiedPublicAssets(id, assets, revision);
      return c.json({ imported: { sourceUrl: assets.sourceUrl, logoCount: assets.logo ? 1 : 0, photoCount: assets.images.length, notices: assets.notices }, record: updated });
    } catch (error) {
      if (error instanceof PublicBusinessAssetError) return c.json({ error: error.message }, error.status);
      // Provider exceptions and source HTML never become owner-visible errors or instructions.
      if (error instanceof SyntaxError) return c.json({ error: "Provide a valid artwork request object." }, 400);
      return c.json({ error: "The public artwork import could not finish. Its source or record may have changed; no substitute artwork was used." }, 409);
    }
  });
}

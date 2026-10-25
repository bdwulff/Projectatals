/**
 * Builds an Atlas instance from environment. Adapters are live only when their
 * credentials exist; otherwise the fake adapter is used and reported as such.
 * ATLAS_MODE=fake forces fakes everywhere (default for local development).
 */
import { Atlas, SqliteStore, fake, live, type AtlasDeps, type ProspectCandidate } from "@atlas/core";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function fixtureCandidates(): ProspectCandidate[] {
  return [
    { businessName: "Ironworks Boxing Gym (fictional)", location: "Berwick VIC", website: "https://ironworks-boxing.example.test", industry: "Boxing gym", observations: [{ observation: "Timetable page returns 404", sourceUrl: "https://ironworks-boxing.example.test/timetable", method: "http_check", status: "unverified", checkUrl: "https://ironworks-boxing.example.test/timetable" }, { observation: "No mobile enquiry form", sourceUrl: "https://ironworks-boxing.example.test", method: "visual_review", status: "hypothesis", uncertainty: "Form may exist behind login" }], commercialOpportunity: "Class enquiries are lost to a broken timetable and no mobile form.", recommendedScope: "Five-page site with timetable, trial-class enquiry form and mobile-first layout", internalRecommendedPriceAud: 2490, suggestedQuote: { deliverables: ["Home", "Classes & timetable", "Coaches", "Memberships", "Contact with trial-class enquiry form"], input: { pages: 5, designComplexity: "standard", contentPreparation: "client_supplied", integrations: [{ name: "Enquiry form", kind: "forms", providerConfirmed: true }], technicalRisk: "low" } }, contactEmail: "owner@ironworks-boxing.example.test", fixture: true },
    { businessName: "Southside Kickboxing (fictional)", location: "Cranbourne VIC", website: "https://southside-kb.example.test", industry: "Kickboxing gym", observations: [{ observation: "Contact form submits to a dead endpoint", sourceUrl: "https://southside-kb.example.test/contact", method: "http_check", status: "unverified", checkUrl: "https://southside-kb.example.test/api/contact" }], commercialOpportunity: "Every enquiry since the form broke has been lost.", recommendedScope: "Eight-page site with class booking embed", internalRecommendedPriceAud: 3490, suggestedQuote: { deliverables: ["Home", "Classes", "Timetable", "Kids program", "Coaches", "Pricing", "Blog", "Contact with booking embed"], input: { pages: 8, designComplexity: "elevated", contentPreparation: "light_editing", integrations: [{ name: "Mindbody booking", kind: "booking_embed", providerConfirmed: false }], technicalRisk: "medium" } }, contactEmail: "info@southside-kb.example.test", fixture: true },
    { businessName: "Pakenham Mobile Mechanics (fictional)", location: "Pakenham VIC", website: "https://pak-mobile-mech.example.test", industry: "Automotive", observations: [{ observation: "Placeholder lorem ipsum on services page", sourceUrl: "https://pak-mobile-mech.example.test/services", method: "visual_review", status: "hypothesis", uncertainty: "May be mid-rebuild" }], commercialOpportunity: "Quote requests unclear.", recommendedScope: "One-page site", internalRecommendedPriceAud: 1490, suggestedQuote: { deliverables: ["One-page site with services, service area and quote request form"], input: { pages: 1, designComplexity: "standard", contentPreparation: "full_copywriting", integrations: [], technicalRisk: "low" } }, contactEmail: "bookings@pak-mobile-mech.example.test", fixture: true },
    { businessName: "Dandenong Equipment Hire (fictional)", location: "Dandenong VIC", website: "https://dando-hire.example.test", industry: "Equipment hire", observations: [{ observation: "Hire enquiry page returns 500", sourceUrl: "https://dando-hire.example.test/hire", method: "http_check", status: "unverified", checkUrl: "https://dando-hire.example.test/hire" }, { observation: "Opening hours differ between site and directory listing", sourceUrl: "https://dando-hire.example.test", method: "search_result", status: "hypothesis", uncertainty: "Directory may be stale" }], commercialOpportunity: "Hire enquiries fail outright.", recommendedScope: "Five-page site with hire catalogue and quote request", internalRecommendedPriceAud: 2490, suggestedQuote: { deliverables: ["Home", "Hire catalogue", "Rates", "About", "Quote request"], input: { pages: 5, designComplexity: "standard", contentPreparation: "light_editing", integrations: [{ name: "Quote form", kind: "forms", providerConfirmed: true }], technicalRisk: "low" } }, contactEmail: "hire@dando-hire.example.test", fixture: true },
    { businessName: "Officer Plumbing Co (fictional)", location: "Officer VIC", website: null, industry: "Trades", observations: [{ observation: "No website; only a social page", sourceUrl: "https://social.example.test/officerplumbing", method: "search_result", status: "hypothesis", uncertainty: "May have a site not indexed" }], commercialOpportunity: "No web presence for quote requests.", recommendedScope: "One-page site", internalRecommendedPriceAud: 1490, fixture: true },
  ];
}

export function fixtureWebsiteTable() {
  return {
    "https://ironworks-boxing.example.test/timetable": { reachable: false, status: 404 },
    "https://ironworks-boxing.example.test": { reachable: true, status: 200, title: "Ironworks Boxing" },
    "https://southside-kb.example.test/api/contact": { reachable: false, status: 502 },
    "https://southside-kb.example.test": { reachable: true, status: 200, title: "Southside Kickboxing" },
    "https://dando-hire.example.test/hire": { reachable: false, status: 500 },
    "https://dando-hire.example.test": { reachable: true, status: 200, title: "Dandenong Equipment Hire" },
    "https://pak-mobile-mech.example.test": { reachable: true, status: 200, title: "Pakenham Mobile Mechanics" },
  };
}

export interface Runtime { atlas: Atlas; mode: "fake" | "mixed"; fakes: { mailer: fake.FakeMailer; mailbox: fake.FakeMailbox; telephony: fake.FakeTelephony; push: fake.FakePushNotifier } }

export function buildRuntime(env: NodeJS.ProcessEnv = process.env): Runtime {
  const forceFake = (env.ATLAS_MODE ?? "fake") === "fake";
  const dbPath = env.ATLAS_DB_PATH ?? ":memory:";
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const store = new SqliteStore(dbPath);
  const fakes = { mailer: new fake.FakeMailer(), mailbox: new fake.FakeMailbox(), telephony: new fake.FakeTelephony(), push: new fake.FakePushNotifier() };
  const liveBoxsafe = new live.SupabaseBoxSafeGateway({ url: env.BOXSAFE_SUPABASE_URL, key: env.BOXSAFE_SUPABASE_READ_KEY });
  const liveStripe = new live.StripeRestGateway(env.STRIPE_RESTRICTED_KEY);
  const liveMailer = new live.ResendMailer(env.RESEND_API_KEY, (env.ATLAS_ALLOWED_FROM ?? "").split(",").filter(Boolean));
  const liveTel = new live.TwilioTelephony({ sid: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM_NUMBER, ownerNumber: env.ATLAS_OWNER_PHONE });
  const useLive = (has: boolean) => !forceFake && has;
  const deps: AtlasDeps = {
    store,
    mailer: useLive(Boolean(env.RESEND_API_KEY)) ? liveMailer : fakes.mailer,
    mailbox: fakes.mailbox,
    telephony: useLive(Boolean(env.TWILIO_ACCOUNT_SID)) ? liveTel : fakes.telephony,
    boxsafe: useLive(Boolean(env.BOXSAFE_SUPABASE_URL && env.BOXSAFE_SUPABASE_READ_KEY)) ? liveBoxsafe : new fake.FakeBoxSafeGateway(),
    stripe: useLive(Boolean(env.STRIPE_RESTRICTED_KEY)) ? liveStripe : new fake.FakeStripeGateway(),
    websiteChecker: forceFake ? new fake.FakeWebsiteChecker(fixtureWebsiteTable()) : new live.HttpWebsiteChecker(),
    speech: new fake.FakeSpeech(),
    pushNotifier: fakes.push,
    research: { find: async ({ count }) => fixtureCandidates().slice(0, count) },
    config: {
      ownerName: env.ATLAS_OWNER_NAME ?? "Brandon",
      ownerEmail: env.ATLAS_OWNER_EMAIL ?? "owner@example.test",
      ownerPhone: env.ATLAS_OWNER_PHONE ?? null,
      businessFromAddress: env.ATLAS_FROM_ADDRESS ?? "hello@wulffstudio.example.test",
      budgetLimitAud: Number(env.ATLAS_BUDGET_LIMIT_AUD ?? 300),
      gstRegistered: env.ATLAS_GST_REGISTERED === "true",
    },
  };
  const mixed = [deps.mailer, deps.telephony, deps.boxsafe, deps.stripe].some((a) => a === liveMailer || a === liveTel || a === liveBoxsafe || a === liveStripe);
  return { atlas: new Atlas(deps), mode: mixed ? "mixed" : "fake", fakes };
}

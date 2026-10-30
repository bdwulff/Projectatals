/**
 * Builds an Atlas instance from environment. Adapters are live only when their
 * credentials exist; missing live connections remain unavailable, never fictional.
 * ATLAS_MODE=fake forces fakes everywhere (default for local development).
 */
import { AcquisitionService, Atlas, SqliteStore, fake, live, BraveResearchSource, TavilyResearchSource, type AcquisitionMailTransport, type AtlasDeps, type ProspectCandidate } from "@atlas/core";
import { GmailAcquisitionMailTransport, ResendAcquisitionMailTransport, SelectableAcquisitionMailTransport } from "./acquisition-mail.js";
import { OwnerUpdates } from "./owner-updates.js";
import { OfficialBusinessEnricher } from "./acquisition-assets.js";
import { DiscoveryProgram } from "./discovery-program.js";
import { SiteRebuilds } from "./site-rebuilds.js";
import { ProspectPricing } from "./prospect-pricing.js";
import { ManualOutreach } from "./manual-outreach.js";
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

export interface Runtime { atlas: Atlas; acquisition: AcquisitionService; acquisitionMail: AcquisitionMailTransport; mailProviders: SelectableAcquisitionMailTransport; googleMail: GmailAcquisitionMailTransport; ownerUpdates: OwnerUpdates; discoveryProgram: DiscoveryProgram; siteRebuilds: SiteRebuilds; prospectPricing: ProspectPricing; manualOutreach: ManualOutreach; mode: "fake" | "live"; fakes: { mailer: fake.FakeMailer; mailbox: fake.FakeMailbox; telephony: fake.FakeTelephony; push: fake.FakePushNotifier } }

export function buildRuntime(env: NodeJS.ProcessEnv = process.env): Runtime {
  const requestedMode = env.ATLAS_MODE ?? "fake";
  if (!["fake", "live"].includes(requestedMode)) throw new Error("ATLAS_MODE must be fake or live");
  const forceFake = requestedMode === "fake";
  const dbPath = env.ATLAS_DB_PATH ?? ":memory:";
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const store = new SqliteStore(dbPath);
  const fakes = { mailer: new fake.FakeMailer(), mailbox: new fake.FakeMailbox(), telephony: new fake.FakeTelephony(), push: new fake.FakePushNotifier() };
  const liveBoxsafe = new live.SupabaseBoxSafeGateway({ url: env.BOXSAFE_SUPABASE_URL, key: env.BOXSAFE_READ_SCOPE_VERIFIED === "true" ? env.BOXSAFE_SUPABASE_READ_KEY : undefined });
  const liveStripe = new live.StripeRestGateway(env.STRIPE_RESTRICTED_KEY);
  const liveMailer = new live.ResendMailer(env.RESEND_API_KEY, (env.ATLAS_ALLOWED_FROM ?? "").split(",").filter(Boolean));
  const liveTel = new live.VerifiedTwilioTelephony({ sid: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM_NUMBER, ownerNumber: env.ATLAS_OWNER_PHONE, enabled: env.ATLAS_OWNER_CALLS_ENABLED === "true", store, maxCallsPerDay: Number(env.ATLAS_OWNER_CALLS_PER_DAY ?? 1) });
  const useBrave = env.ATLAS_RESEARCH_PROVIDER === "brave" || (env.ATLAS_RESEARCH_PROVIDER !== "tavily" && Boolean(env.BRAVE_SEARCH_API_KEY?.trim()));
  const research = useBrave ? new BraveResearchSource({ apiKey: env.BRAVE_SEARCH_API_KEY }) : new TavilyResearchSource({ apiKey: env.TAVILY_API_KEY, excludeDomains: () => store.listDocs<{ website: string | null }>("prospects").flatMap(row => { try { return row.doc.website ? [new URL(row.doc.website).hostname] : []; } catch { return []; } }) });
  const deps: AtlasDeps = {
    store,
    mailer: forceFake ? fakes.mailer : liveMailer,
    mailbox: forceFake ? fakes.mailbox : undefined,
    telephony: forceFake ? fakes.telephony : liveTel,
    boxsafe: forceFake ? new fake.FakeBoxSafeGateway() : liveBoxsafe,
    stripe: forceFake ? new fake.FakeStripeGateway() : liveStripe,
    websiteChecker: forceFake ? new fake.FakeWebsiteChecker(fixtureWebsiteTable()) : new live.HttpWebsiteChecker(),
    speech: forceFake ? new fake.FakeSpeech() : undefined,
    pushNotifier: forceFake ? fakes.push : new live.NtfyOwnerNotifier({ baseUrl: env.NTFY_BASE_URL, allowedHost: env.NTFY_ALLOWED_HOST, topic: env.NTFY_OWNER_TOPIC, token: env.NTFY_ACCESS_TOKEN, enabled: env.ATLAS_OWNER_PUSH_ENABLED === "true", store }),
    research: forceFake ? { find: async ({ count }) => fixtureCandidates().slice(0, count) } : research,
    lookup: forceFake ? undefined : research,
    config: {
      ownerName: env.ATLAS_OWNER_NAME ?? "Brandon",
      ownerEmail: env.ATLAS_OWNER_EMAIL ?? "owner@example.test",
      ownerPhone: env.ATLAS_OWNER_PHONE ?? null,
      businessFromAddress: env.ATLAS_FROM_ADDRESS ?? "hello@wulffstudio.example.test",
      budgetLimitAud: Number(env.ATLAS_BUDGET_LIMIT_AUD ?? 300),
      ownerCallsEnabled: env.ATLAS_OWNER_CALLS_ENABLED === "true",
      gstRegistered: env.ATLAS_GST_REGISTERED === "true",
    },
  };
  const atlas = new Atlas(deps);
  const googleMail = new GmailAcquisitionMailTransport({ enabled: !forceFake, clientId: forceFake ? undefined : env.GOOGLE_CLIENT_ID, clientSecret: forceFake ? undefined : env.GOOGLE_CLIENT_SECRET, publicOrigin: env.ATLAS_PUBLIC_ORIGIN, ownerAccessKey: env.ATLAS_OWNER_ACCESS_KEY, store });
  const fictionalMailer: AcquisitionMailTransport = { status: async () => ({ state: "fake", provider: "Fictional mailer", detail: "Fictional mode records test emails locally; no provider is contacted.", sender: "hello@wulffstudio.example.test" }), send: input => fakes.mailer.send(input) };
  const mailProviders = new SelectableAcquisitionMailTransport({ store, defaultProvider: env.ATLAS_OUTREACH_PROVIDER, transports: { gmail: forceFake ? fictionalMailer : googleMail, resend: forceFake ? fictionalMailer : new ResendAcquisitionMailTransport({ apiKey: env.RESEND_API_KEY, fromAddress: env.ATLAS_OUTREACH_FROM, store }) } });
  const acquisitionMail = forceFake ? fictionalMailer : mailProviders;
  const acquisition = new AcquisitionService(atlas, { mode: forceFake ? "fake" : "live", publicOrigin: env.ATLAS_PUBLIC_ORIGIN, mailer: acquisitionMail, mailProviderIdentity: () => forceFake ? "fictional" : mailProviders.selected() === "gmail" ? googleMail.identity() : mailProviders.selected() ?? "invalid", enricher: forceFake ? undefined : new OfficialBusinessEnricher(), fromAddress: env.ATLAS_OUTREACH_FROM ?? "", senderName: env.ATLAS_OUTREACH_SENDER_NAME ?? "Brandon Wulff", organisation: "Wulff Studio", contactDetails: env.ATLAS_OUTREACH_CONTACT, maxSendsPerDay: 5 });
  const ownerUpdates = new OwnerUpdates({ atlas, mode: forceFake ? "fake" : "live", mailer: acquisitionMail, publicOrigin: env.ATLAS_PUBLIC_ORIGIN, ownerAccessKey: env.ATLAS_OWNER_ACCESS_KEY, telegramToken: forceFake ? undefined : env.TELEGRAM_BOT_TOKEN, telegramChatId: forceFake ? undefined : env.TELEGRAM_OWNER_CHAT_ID, counts: async () => { const snapshot = await acquisition.snapshot(); return { candidates: snapshot.records.length, concepts: snapshot.records.filter(r => r.demo).length, pendingReview: snapshot.records.filter(r => r.draft && ["draft", "blocked", "awaiting_approval"].includes(r.draft.status)).length }; } });
  for (const notifier of ownerUpdates.notifiers()) atlas.notifications.use(notifier);
  const prospectPricing = new ProspectPricing({ atlas, mode: forceFake ? "fake" : "live", publicOrigin: env.ATLAS_PUBLIC_ORIGIN });
  prospectPricing.sync();
  const discoveryProgram = new DiscoveryProgram({ atlas, acquisition, mode: forceFake ? "fake" : "live", env, onPrepared: () => prospectPricing.sync() });
  const siteRebuilds = new SiteRebuilds({ atlas, acquisition, mode: forceFake ? "fake" : "live", notificationPriority: "action_needed" });
  const manualOutreach = new ManualOutreach({ atlas, pricing: prospectPricing, discovery: discoveryProgram, mode: forceFake ? "fake" : "live", publicOrigin: env.ATLAS_PUBLIC_ORIGIN, env });
  return { atlas, acquisition, acquisitionMail, mailProviders, googleMail, ownerUpdates, discoveryProgram, siteRebuilds, prospectPricing, manualOutreach, mode: forceFake ? "fake" : "live", fakes };
}

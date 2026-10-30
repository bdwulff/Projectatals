import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscoveryProgram, type DiscoverySettings } from "./discovery-program.js";
import { buildRuntime, type Runtime } from "./runtime.js";

const runtimes: Runtime[] = [];
const config: DiscoverySettings = { enabled: true, area: "Melbourne and south-east Melbourne, Victoria", industry: "", count: 20, templateId: "simple", target: "no_website", companyName: "Fictional Studio", companyWebsite: "https://studio.example.com", timeZone: "Australia/Melbourne" };
function setup() {
  let now = new Date("2026-10-28T00:00:00Z");
  const rt = buildRuntime({ ATLAS_MODE: "live", ATLAS_PUBLIC_ORIGIN: "https://studio.example.com" }); runtimes.push(rt);
  const lookup = vi.fn(async () => []);
  rt.atlas.deps.lookup = { lookup, status: async () => ({ name: "Fictional lookup", state: "connected", mode: "live", checkedAt: now.toISOString(), detail: "Isolated fictional lookup for daily workflow tests." }) };
  const service = new DiscoveryProgram({ atlas: rt.atlas, acquisition: rt.acquisition, mode: "live", env: { ATLAS_RESEARCH_PROVIDER: "tavily" }, clock: () => now, onPrepared: () => rt.prospectPricing.sync() });
  rt.acquisition.saveSender({ name: "Fictional Owner", organisation: "Fictional Studio", email: "owner@example.com", contactDetails: "https://studio.example.com\n0400 000 001" }, "Fictional Owner", { preserveDrafts: true });
  service.configure(config);
  function reviewed(index: number, contact = true) {
    const sourceUrl = `https://www.wyndham.vic.gov.au/business-directory/fictional-${index}`;
    const record = rt.acquisition.addLead({ businessName: `Fictional Garden ${index}`, location: "Werribee, Melbourne, Victoria", industry: "Garden maintenance", sourceUrl, observation: "Fictional isolated test. Public source and dated website checks require owner review.", services: ["Garden maintenance"], ...(contact ? { contactEmail: `fictional-${index}@example.com`, contactSourceUrl: sourceUrl } : {}) });
    return { leadId: record.id, sourceUrl, email: record.contact?.email ?? "", checkedAt: now.toISOString(), searchQueries: [`Fictional Garden ${index} Werribee website`], noIndependentWebsiteFound: true };
  }
  return { rt, service, lookup, reviewed, now: () => now, setNow: (value: Date) => { now = value; } };
}
afterEach(() => { for (const rt of runtimes.splice(0)) rt.atlas.deps.store.close(); vi.useRealTimers(); });

describe("daily manual client workflow", () => {
  it("prepares twenty reviewed unique clients, keeps pricing separate and never invokes outbound work", async () => {
    vi.useFakeTimers(); const s = setup();
    const send = vi.spyOn(s.rt.acquisition, "approveAndSend"), publish = vi.spyOn(s.rt.acquisition, "publish"), notify = vi.fn();
    s.rt.atlas.notifications.use({ channel: "email", deliver: notify });
    const leads = Array.from({ length: 20 }, (_, i) => s.reviewed(i));
    await s.service.seedToday({ leads }); await vi.advanceTimersByTimeAsync(0);
    const report = (await s.service.snapshot()).latestReport!;
    expect(report).toMatchObject({ id: "outreach_2026-10-28", state: "completed", requestedCount: 20, emailReadyCount: 20, shortfallCount: 0, foundCount: 20, preparedCount: 20 });
    expect(report.exclusions).toEqual({ duplicate: 0, missingEmail: 0, ownWebsite: 0, unverified: 0, nonBusiness: 0 });
    expect(s.lookup).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled(); expect(notify).not.toHaveBeenCalled();
    const prices = s.rt.prospectPricing.snapshot().rows; expect(prices).toHaveLength(20);
    for (const row of prices) {
      expect(row.price.suggestedQuoteAud).toBe(699);
      expect(row.noWebsite).toBe(true);
      expect(row.draft?.text).toContain("0400 000 001"); expect(row.draft?.text).not.toMatch(/699|999|1499|\/demos\//);
      expect(row.demoReady).toBe(true);
    }
    await s.service.runNow(); await s.service.dailyTick(); await vi.advanceTimersByTimeAsync(0);
    expect((await s.service.snapshot()).latestReport?.finishedAt).toBe(report.finishedAt);
    expect(s.rt.atlas.jobs.list().filter(job => job.idempotencyKey === "daily_outreach:2026-10-28")).toHaveLength(1);
    await expect(s.service.seedToday({ leads })).rejects.toThrow("already final");
  });

  it("does not accept a missing recipient or mismatched published source as a reviewed email", async () => {
    vi.useFakeTimers(); const s = setup(), lead = s.reviewed(1, false);
    await expect(s.service.seedToday({ leads: [lead] })).rejects.toThrow("match the saved source and email");
    const qualified = s.reviewed(2);
    await expect(s.service.seedToday({ leads: [{ ...qualified, sourceUrl: "https://www.wyndham.vic.gov.au/other" }] })).rejects.toThrow("match the saved source and email");
    expect(s.rt.atlas.jobs.list().filter(job => job.idempotencyKey.startsWith("daily_outreach:"))).toHaveLength(0);
  });

  it("does not start scheduled research before seven and resumes a persisted running cursor after restart", async () => {
    vi.useFakeTimers(); const s = setup(); s.setNow(new Date("2026-10-27T19:59:00Z"));
    expect((await s.service.dailyTick()).state).toBe("skipped"); expect(s.lookup).not.toHaveBeenCalled();
    s.setNow(new Date("2026-10-27T20:00:00Z"));
    expect((await s.service.dailyTick()).state).toBe("running"); expect(s.lookup).toHaveBeenCalledTimes(2);
    const first = (await s.service.snapshot()).latestReport!; expect(first.emailReadyCount).toBe(0); expect(first.shortfallCount).toBe(20);
    const restarted = new DiscoveryProgram({ atlas: s.rt.atlas, acquisition: s.rt.acquisition, mode: "live", env: { ATLAS_RESEARCH_PROVIDER: "tavily" }, clock: s.now });
    expect((await restarted.snapshot()).latestReport?.state).toBe("running");
    await restarted.dailyTick(); expect(s.lookup).toHaveBeenCalledTimes(2);
    s.setNow(new Date("2026-10-27T20:05:00Z")); await restarted.dailyTick(); expect(s.lookup).toHaveBeenCalledTimes(4);
    restarted.configure({ ...config, enabled: false }); s.setNow(new Date("2026-10-27T20:10:00Z")); await restarted.dailyTick(); expect(s.lookup).toHaveBeenCalledTimes(4);
  });
});

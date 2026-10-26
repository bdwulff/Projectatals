import { describe, it, expect } from "vitest";
import { buildRuntime } from "./runtime.js";

describe("live runtime never substitutes fixtures", () => {
  it("leaves missing providers unavailable and produces no invented clients, money or calls", async () => {
    const rt = buildRuntime({ ATLAS_MODE: "live" });
    expect(rt.mode).toBe("live");
    expect((await rt.atlas.connections()).every(c => c.mode !== "fake")).toBe(true);
    await expect(rt.atlas.boxsafeSummary("today")).rejects.toThrow();
    const leads = await rt.atlas.handleCommand("Find five clients around Berwick");
    expect(leads.reply).toMatch(/unavailable|missing|BRAVE_SEARCH_API_KEY/i);
    expect(rt.atlas.prospects.list()).toHaveLength(0);
    const call = await rt.atlas.handleCommand("Call me");
    expect(call.outcome).toBe("denied");
    expect(rt.fakes.telephony.calls).toHaveLength(0);
    expect(rt.fakes.mailer.sent).toHaveLength(0);
  });
  it("continues job checks when BoxSafe and Stripe are unavailable", async () => {
    const rt = buildRuntime({ ATLAS_MODE: "live" });
    const result = await rt.atlas.runScheduledChecks();
    expect(result.ran).toContain("jobs");
    expect(result.failed).toContain("boxsafe.summary");
    expect(rt.atlas.notifications.list().every(n => n.deliveries.every(d => d.channel === "dashboard"))).toBe(true);
  });
});

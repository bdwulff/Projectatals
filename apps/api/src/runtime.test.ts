import { afterEach, describe, it, expect, vi } from "vitest";
import { buildRuntime } from "./runtime.js";

describe("live runtime never substitutes fixtures", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("keeps acquisition fully fictional even if live mail credentials are present in the environment", async () => {
    const request = vi.fn().mockRejectedValue(new Error("no provider requests allowed")); vi.stubGlobal("fetch", request);
    const rt = buildRuntime({ ATLAS_MODE: "fake", RESEND_API_KEY: "fictional-secret", GOOGLE_CLIENT_ID: "fictional-client", GOOGLE_CLIENT_SECRET: "fictional-client-secret", ATLAS_OWNER_ACCESS_KEY: "fictional-owner-key-".repeat(3), ATLAS_PUBLIC_ORIGIN: "https://jarvis.example.test" });
    const snapshot = await rt.acquisition.snapshot();
    expect(snapshot.mode).toBe("fake"); expect(snapshot.email.state).toBe("fake"); expect(request).not.toHaveBeenCalled();
    expect(() => rt.googleMail.startLink()).toThrow(); rt.atlas.deps.store.close();
  });
  it("leaves missing providers unavailable and produces no invented clients, money or calls", async () => {
    const request = vi.fn().mockRejectedValue(new Error("network unavailable; fictional-secret-not-for-output"));
    vi.stubGlobal("fetch", request);
    const rt = buildRuntime({ ATLAS_MODE: "live" });
    expect(rt.mode).toBe("live");
    expect((await rt.atlas.connections()).every(c => c.mode !== "fake")).toBe(true);
    await expect(rt.atlas.boxsafeSummary("today")).rejects.toThrow();
    const leads = await rt.atlas.handleCommand("Find five clients around Berwick");
    expect(leads.outcome).toBe("denied");
    expect(leads.reply).not.toContain("fictional-secret-not-for-output");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe("https://api.tavily.com/search");
    expect(request.mock.calls[0]?.[1].headers).toMatchObject({ "X-Tavily-Access-Mode": "keyless" });
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

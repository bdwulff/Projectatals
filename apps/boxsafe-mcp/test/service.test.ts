import { describe, it, expect, vi } from "vitest";
import { fake, buildDailyBoxSafeBriefing, type ConnectionStatus } from "@atlas/core";
import { BoxSafeReadService, buildDependencies } from "../src/service.js";

const now = new Date("2026-10-26T12:00:00.000Z");
function fixture() {
  const deps = buildDependencies({ ATLAS_MODE: "fake" }, () => now);
  deps.audit = vi.fn();
  return { deps, service: new BoxSafeReadService(deps) };
}

describe("BoxSafe read service", () => {
  it("completes an explicitly fictional orders, Stripe and dispatch briefing without customer data", async () => {
    const { deps, service } = fixture();
    const briefing = await service.call("get_daily_briefing", { range: "today" });
    expect(briefing.fixture).toBe(true);
    expect(briefing.mode).toBe("fake");
    expect(briefing.spoken).toContain("FICTIONAL TEST DATA");
    expect(briefing.summary).toMatchObject({ paidOrders: 5, recordedNetPaidAud: 559, pendingOrders: 1, awaitingDispatch: 2 });
    expect(briefing.reconciliation).toMatchObject({
      ordersWithoutPayment: [{ orderId: "ord_fx_008", reason: expect.any(String) }],
      pendingOrdersWithSucceededPayment: [{ orderId: "ord_fx_005", paymentIntentId: "pi_fx_005" }],
      paymentsWithoutOrder: [{ paymentIntentId: "pi_fx_999", amountAud: 65 }],
    });
    expect(briefing.speech).toMatchObject({ audioProduced: false });
    expect(JSON.stringify(briefing)).not.toMatch(/customerEmail|customerName|@example|Test Member|trackingNumber|guest_name/);
    expect((deps.boxsafe as fake.FakeBoxSafeGateway).trackingWrites).toEqual([]);
    expect(deps.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "get_daily_briefing", outcome: "simulated", permissionLevel: 1 }));
  });

  it("bounds output and rejects unknown arguments and tools", async () => {
    const { service } = fixture();
    const orders = await service.call("get_recent_orders", { limit: 1, range: "today" });
    expect(orders).toMatchObject({ returned: 1, truncated: true });
    await expect(service.call("get_recent_orders", { limit: 101 })).rejects.toThrow();
    await expect(service.call("get_dispatch_queue", { limit: -1 })).rejects.toThrow();
    await expect(service.call("get_recent_orders", { url: "https://attacker.example" })).rejects.toThrow();
    await expect(service.call("get_daily_briefing", { range: "all" })).rejects.toThrow();
    await expect(service.call("record_tracking", {})).rejects.toThrow("Unknown read tool");
  });

  it("never lets fixture records or source failures become a live financial result", async () => {
    const { deps, service } = fixture();
    deps.mode = "live";
    await expect(service.call("get_daily_briefing", {})).rejects.toThrow("mode mismatch");
    await expect(buildDailyBoxSafeBriefing({ boxsafe: deps.boxsafe, stripe: deps.stripe, now, mode: "live" })).rejects.toThrow("both read connections");
    deps.mode = "fake";
    deps.stripe.listPayments = async () => { throw new Error("Provider unavailable"); };
    await expect(service.call("get_revenue_summary", {})).rejects.toThrow("Provider unavailable");
    expect(deps.audit).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: "failed" }));
  });

  it("fails closed on missing live configuration or an unsupported mode", () => {
    expect(() => buildDependencies({ ATLAS_MODE: "live" })).toThrow("reviewed SELECT-only");
    expect(() => buildDependencies({ ATLAS_MODE: "live", BOXSAFE_READ_SCOPE_VERIFIED: "true" })).toThrow("no fixture fallback");
    expect(() => buildDependencies({ ATLAS_MODE: "mixed" })).toThrow("fake or live");
  });

  it("health reports limited checks and never leaks upstream error details", async () => {
    const { deps, service } = fixture();
    deps.boxsafe.status = async (): Promise<ConnectionStatus> => ({ name: "BoxSafe", mode: "fake", state: "error", checkedAt: now.toISOString(), detail: "https://secret:password@example.test" });
    const health = await service.call("get_platform_health", {});
    expect(health.checks).toMatchObject({ orderReadAccess: "error", applicationHealth: "not_checked", webhooks: "not_checked", registrationAndLicences: "not_connected" });
    expect(JSON.stringify(health)).not.toContain("password");
  });
});

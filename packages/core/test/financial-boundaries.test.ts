import { describe, it, expect } from "vitest";
import { melbourneDayRange, reconcile } from "../src/index.js";
import { fictionalBoxSafeOrders, fictionalStripePayments } from "../src/adapters/fake/index.js";

describe("Melbourne financial day boundaries", () => {
  it("handles both daylight saving transition days and fractional seconds", () => {
    const spring = melbourneDayRange(new Date("2026-10-04T03:12:30.123Z"), "today");
    expect(spring.from.toISOString()).toBe("2026-10-03T14:00:00.000Z");
    expect(spring.to.toISOString()).toBe("2026-10-04T13:00:00.000Z");
    const autumn = melbourneDayRange(new Date("2026-04-05T03:12:30.999Z"), "today");
    expect(autumn.from.toISOString()).toBe("2026-04-04T13:00:00.000Z");
    expect(autumn.to.toISOString()).toBe("2026-04-05T14:00:00.000Z");
    expect(melbourneDayRange(new Date("2026-10-15T12:00:00.123Z"), "month").from.toISOString()).toBe("2026-09-30T14:00:00.000Z");
  });
  it("does not reconcile paid orders to unsuccessful Stripe payments of the same amount", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    const order = fictionalBoxSafeOrders(now)[0]!;
    const payment = { ...fictionalStripePayments(now)[0]!, status: "processing" as const };
    const result = reconcile([order], [payment]);
    expect(result.matched).toHaveLength(0);
    expect(result.paymentStateMismatches).toHaveLength(1);
    expect(result.summary).toContain("1 issue");
  });
});

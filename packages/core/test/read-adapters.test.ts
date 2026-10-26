import { afterEach, it, expect, vi } from "vitest";
import { SupabaseBoxSafeGateway, StripeRestGateway } from "../src/adapters/live/index.js";

afterEach(() => vi.unstubAllGlobals());

it("queries both creation and payment dates and does not hide older dispatch orders", async () => {
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { requests.push(String(url)); return Response.json([]); }));
  const gateway = new SupabaseBoxSafeGateway({ url: "https://test.supabase.co", key: "test-read-key" });
  await gateway.listOrders({ from: new Date("2026-10-25T13:00:00Z"), to: new Date("2026-10-26T13:00:00Z") });
  expect(new URL(requests[0]!).searchParams.get("or")).toContain("paid_at.gte.");
  await gateway.listOrdersNeedingDispatch();
  const query = new URL(requests[1]!).searchParams;
  expect(query.has("created_at")).toBe(false);
  expect(query.get("status")).toContain("paid");
  expect(query.get("paid_at")).toBe("not.is.null");
});

it("paginates Stripe and refuses to report non-AUD values as dollars collected", async () => {
  const requests: URL[] = [];
  const payment = (id: string, currency = "aud") => ({ id, currency, amount: 5000, amount_received: 5000, status: "succeeded", created: 1792929600, latest_charge: { amount_refunded: 1000 } });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    requests.push(new URL(url));
    return Response.json(requests.length === 1 ? { data: [payment("pi_1")], has_more: true } : { data: [payment("pi_2")], has_more: false });
  }));
  const gateway = new StripeRestGateway("test-restricted-key");
  const range = { from: new Date("2026-10-25T00:00:00Z"), to: new Date("2026-10-27T00:00:00Z") };
  const result = await gateway.listPayments(range);
  expect(requests[1]!.searchParams.get("starting_after")).toBe("pi_1");
  expect(result).toHaveLength(2);
  expect(result[0]!.refundedAud).toBe(10);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [payment("pi_usd", "usd")], has_more: false })));
  await expect(gateway.listPayments(range)).rejects.toThrow("Non-AUD");
});

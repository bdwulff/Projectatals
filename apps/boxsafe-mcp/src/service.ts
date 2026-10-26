import {
  fake, live, melbourneDayRange, buildDailyBoxSafeBriefing, projectBriefingOrder,
  requiredLevel, PermissionLevel,
  type BoxSafeGateway, type StripeGateway,
} from "@atlas/core";
import { z } from "zod";

const rangeSchema = z.enum(["today", "week", "month"]).default("today");
const limitSchema = z.number().int().min(1).max(100).default(25);
const ranged = z.object({ range: rangeSchema }).strict();
const recent = z.object({ range: rangeSchema, limit: limitSchema }).strict();
const limited = z.object({ limit: limitSchema }).strict();
const empty = z.object({}).strict();

export const toolNames = ["get_recent_orders", "get_revenue_summary", "get_dispatch_queue", "get_platform_health", "get_daily_briefing"] as const;
export type ToolName = (typeof toolNames)[number];

export interface Dependencies {
  boxsafe: BoxSafeGateway;
  stripe: StripeGateway;
  mode: "fake" | "live";
  clock: () => Date;
  audit: (record: { at: string; action: ToolName; business: "boxsafe"; permissionLevel: 1; outcome: "completed" | "simulated" | "failed" }) => void;
}

/** Live credentials are never replaced with fixtures. No secrets are included in errors. */
export function buildDependencies(env: NodeJS.ProcessEnv = process.env, clock = () => new Date()): Dependencies {
  const mode = env.ATLAS_MODE ?? "fake";
  if (mode !== "fake" && mode !== "live") throw new Error("ATLAS_MODE must be fake or live.");
  if (mode === "live") {
    if (env.BOXSAFE_READ_SCOPE_VERIFIED !== "true") throw new Error("Live mode requires reviewed SELECT-only BoxSafe access and BOXSAFE_READ_SCOPE_VERIFIED=true.");
    if (!env.BOXSAFE_SUPABASE_URL || !env.BOXSAFE_SUPABASE_READ_KEY || !env.STRIPE_RESTRICTED_KEY) {
      throw new Error("Live mode requires BoxSafe scoped read credentials and a Stripe restricted read key; no fixture fallback is allowed.");
    }
  }
  const now = clock();
  return {
    mode, clock,
    boxsafe: mode === "fake"
      ? new fake.FakeBoxSafeGateway(fake.fictionalBoxSafeOrders(now))
      : new live.SupabaseBoxSafeGateway({ url: env.BOXSAFE_SUPABASE_URL, key: env.BOXSAFE_SUPABASE_READ_KEY }),
    stripe: mode === "fake"
      ? new fake.FakeStripeGateway(fake.fictionalStripePayments(now))
      : new live.StripeRestGateway(env.STRIPE_RESTRICTED_KEY),
    // Protocol stdout is reserved for JSON-RPC. Audit contains no arguments, customer data or secrets.
    audit: (record) => process.stderr.write(JSON.stringify(record) + "\n"),
  };
}

export class BoxSafeReadService {
  constructor(private readonly deps: Dependencies) {}

  private envelope() {
    return {
      business: "boxsafe", mode: this.deps.mode, fixture: this.deps.mode === "fake",
      generatedAt: this.deps.clock().toISOString(), timezone: "Australia/Melbourne", currency: "AUD",
      dataNotice: this.deps.mode === "fake"
        ? "FICTIONAL TEST DATA. No live BoxSafe or Stripe account was queried."
        : "Live read-only data. Connection status verifies read access, not complete platform health.",
    };
  }

  private async assertConnections(withStripe: boolean) {
    const connections = await Promise.all([this.deps.boxsafe.status(), ...(withStripe ? [this.deps.stripe.status()] : [])]);
    const expected = this.deps.mode === "fake" ? "fake" : "connected";
    if (connections.some((c) => c.state !== expected || c.mode !== this.deps.mode)) {
      throw new Error("Required read connection unavailable or mode mismatch. No financial result was produced.");
    }
    return connections;
  }

  async call(name: string, args: unknown): Promise<Record<string, unknown>> {
    if (!toolNames.includes(name as ToolName)) throw new Error("Unknown read tool.");
    const action = name as ToolName;
    if (requiredLevel("read.boxsafe.orders") !== PermissionLevel.Read || requiredLevel("read.stripe.payments") !== PermissionLevel.Read) {
      throw new Error("Read permissions are not available.");
    }
    try {
      const result = await this.execute(action, args ?? {});
      this.deps.audit({ at: this.deps.clock().toISOString(), action, business: "boxsafe", permissionLevel: 1, outcome: this.deps.mode === "fake" ? "simulated" : "completed" });
      return result;
    } catch (e) {
      this.deps.audit({ at: this.deps.clock().toISOString(), action, business: "boxsafe", permissionLevel: 1, outcome: "failed" });
      throw e;
    }
  }

  private async execute(name: ToolName, args: unknown): Promise<Record<string, unknown>> {
    if (name === "get_platform_health") {
      empty.parse(args);
      const connections = await Promise.all([this.deps.boxsafe.status(), this.deps.stripe.status()]);
      // Avoid returning upstream error details, which may contain credential URLs or personal records.
      return { ...this.envelope(), connections: connections.map(({ name, state, mode, checkedAt }) => ({ name, state, mode, checkedAt })),
        checks: { orderReadAccess: connections[0]?.state ?? "unknown", paymentReadAccess: connections[1]?.state ?? "unknown", applicationHealth: "not_checked", webhooks: "not_checked", registrationAndLicences: "not_connected" },
        limitation: "No repair functions, test seeding, member documents or licence decisions were invoked." };
    }
    if (name === "get_dispatch_queue") {
      const { limit } = limited.parse(args);
      await this.assertConnections(false);
      const orders = await this.deps.boxsafe.listOrdersNeedingDispatch();
      return { ...this.envelope(), awaitingDispatch: orders.length, returned: Math.min(limit, orders.length), truncated: orders.length > limit,
        orders: orders.slice(0, limit).map(projectBriefingOrder), coverage: "All dispatch records returned by the configured gateway, independent of today's order window." };
    }
    const parsed = name === "get_recent_orders" ? recent.parse(args) : ranged.parse(args);
    const range = melbourneDayRange(this.deps.clock(), parsed.range);
    await this.assertConnections(name !== "get_recent_orders");
    if (name === "get_recent_orders") {
      const { limit } = recent.parse(args);
      const orders = await this.deps.boxsafe.listOrders(range);
      const sorted = [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { ...this.envelope(), range: { from: range.from.toISOString(), to: range.to.toISOString() },
        matchingOrders: sorted.length, returned: Math.min(limit, sorted.length), truncated: sorted.length > limit,
        orders: sorted.slice(0, limit).map(projectBriefingOrder) };
    }
    return buildDailyBoxSafeBriefing({ boxsafe: this.deps.boxsafe, stripe: this.deps.stripe, now: this.deps.clock(), mode: this.deps.mode, range: parsed.range });
  }
}

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Runtime } from "./runtime.js";

export function createApp(rt: Runtime) {
  const app = new Hono();
  const { atlas } = rt;
  app.use("/api/*", cors());

  app.get("/api/status", async (c) => {
    const connections = await atlas.connections();
    return c.json({ atlas: { online: true, version: "0.1.0", time: atlas.clock().toISOString(), mode: rt.mode, timezone: "Australia/Melbourne" }, connections });
  });
  app.get("/api/briefing", async (c) => c.json(await atlas.briefing()));
  app.get("/api/alerts", (c) => c.json(atlas.notifications.list({ unacknowledgedOnly: c.req.query("all") !== "1" })));
  app.post("/api/alerts/:id/ack", (c) => { const n = atlas.notifications.acknowledge(c.req.param("id")); return n ? c.json(n) : c.json({ error: "not found" }, 404); });
  app.get("/api/approvals", (c) => { const status = c.req.query("status"); return c.json(status === "all" ? atlas.approvals.list() : atlas.approvals.pending()); });
  app.post("/api/approvals/:id/decide", async (c) => {
    const body = (await c.req.json()) as { decision: "approve" | "reject" | "revise"; note?: string; priceAud?: number | null; by?: string };
    const approval = atlas.approvals.get(c.req.param("id"));
    if (!approval) return c.json({ error: "not found" }, 404);
    try {
      if (approval.action === "approve.quote_send") {
        const r = atlas.decideQuote(body.decision, body.by ?? atlas.deps.config.ownerName, { approvalId: approval.id, priceAud: body.priceAud ?? null, note: body.note });
        await atlas.jobs.runOnce();
        return c.json({ ok: true, result: r, quote: atlas.quotes.get(r.revised?.quote.id ?? r.quote.id) });
      }
      const decided = atlas.approvals.decide(approval.id, body.decision, body.by ?? atlas.deps.config.ownerName, body.note);
      return c.json({ ok: true, result: { approval: decided } });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 409);
    }
  });
  app.get("/api/prospects", (c) => c.json(atlas.prospects.list()));
  app.get("/api/quotes", (c) => c.json(atlas.quotes.list()));
  app.get("/api/projects", (c) => c.json(atlas.projects()));
  app.get("/api/boxsafe/orders", async (c) => {
    const range = (c.req.query("range") ?? "today") as "today" | "week" | "month";
    const r = await atlas.boxsafeSummary(["today", "week", "month"].includes(range) ? range : "today");
    return c.json({ ...r, spoken: (await import("@atlas/core")).spokenOrderSummary(r.summary) });
  });
  app.get("/api/boxsafe/dispatch", async (c) => c.json(await atlas.boxsafeDispatchList()));
  app.get("/api/boxsafe/reconcile", async (c) => c.json(await atlas.reconcileBoxSafe((c.req.query("range") as "today" | "week" | "month") ?? "today")));
  app.get("/api/finance", async (c) => {
    const [today, week, month] = await Promise.all([atlas.boxsafeSummary("today"), atlas.boxsafeSummary("week"), atlas.boxsafeSummary("month")]);
    const spent = atlas.deps.store.getMemory<number>("budget.spentAud") ?? 0;
    const wulffCollected = 0; // No payment integration connected yet; nothing verified.
    return c.json({
      boxsafe: { mode: today.mode, today: pick(today.summary), week: pick(week.summary), month: pick(month.summary) },
      wulffStudio: { verifiedCollectedAud: wulffCollected, quotesSentAud: atlas.quotes.list().filter((q) => q.status === "sent").reduce((s, q) => s + q.priceExGstAud, 0), quotesPendingApprovalAud: atlas.quotes.list().filter((q) => q.status === "approval_pending").reduce((s, q) => s + q.priceExGstAud, 0), note: "Quoted amounts are not income. Only verified collected payments count." },
      budget: { limitAud: atlas.deps.config.budgetLimitAud, spentAud: spent, remainingAud: atlas.deps.config.budgetLimitAud - spent },
    });
  });
  app.get("/api/jobs", (c) => c.json(atlas.jobs.list(100)));
  app.get("/api/audit", (c) => c.json(atlas.audit.recent(Number(c.req.query("limit") ?? 100))));
  app.post("/api/command", async (c) => {
    const body = (await c.req.json()) as { text: string };
    if (!body?.text?.trim()) return c.json({ error: "text required" }, 400);
    const r = await atlas.handleCommand(body.text);
    const speech = atlas.deps.speech ? await atlas.deps.speech.speak(r.reply) : null;
    return c.json({ ...r, speech });
  });
  app.post("/api/run-checks", async (c) => c.json(await atlas.runScheduledChecks()));
  app.post("/api/dev/seed", async (c) => {
    // Development helper: run the fictional scenario so the dashboard has data.
    await atlas.researchProspects({ area: "Berwick", count: 5 });
    const best = atlas.prospects.bestLead();
    if (best && !atlas.quotes.latestForProspect(best.id)) atlas.prepareQuote(best.id);
    await atlas.runScheduledChecks();
    return c.json({ ok: true, prospects: atlas.prospects.list().length, approvals: atlas.approvals.pending().length });
  });
  app.post("/api/dev/customer-reply", async (c) => {
    const body = (await c.req.json()) as { quoteId: string; text: string };
    return c.json(atlas.handleCustomerReply(body.quoteId, body.text));
  });
  app.get("/api/dev/outbox", (c) => c.json({ emails: rt.fakes.mailer.sent, calls: rt.fakes.telephony.calls, push: rt.fakes.push.delivered }));
  app.get("/healthz", (c) => c.json({ ok: true }));
  return app;
}

function pick(s: { paidOrders: number; verifiedRevenueAud: number; refundsAud: number; pendingOrders: number; byCategory: unknown; needsDispatch: unknown[]; attention: unknown[]; range: unknown }) {
  return { range: s.range, paidOrders: s.paidOrders, verifiedRevenueAud: s.verifiedRevenueAud, refundsAud: s.refundsAud, pendingOrders: s.pendingOrders, byCategory: s.byCategory, needsDispatch: s.needsDispatch.length, attention: s.attention.length };
}

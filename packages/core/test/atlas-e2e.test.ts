import { describe, it, expect } from "vitest";
import { Atlas, SqliteStore, type ProspectCandidate, PermissionDeniedError } from "../src/index.js";
import { FakeMailer, FakeMailbox, FakeTelephony, FakeBoxSafeGateway, FakeStripeGateway, FakeWebsiteChecker, FakePushNotifier } from "../src/adapters/fake/index.js";

const candidates: ProspectCandidate[] = [
  { businessName: "Ironworks Boxing Gym (fictional)", location: "Berwick VIC", website: "https://ironworks-boxing.example.test", industry: "Boxing gym", observations: [{ observation: "Timetable page returns 404", sourceUrl: "https://ironworks-boxing.example.test/timetable", method: "http_check", status: "unverified", checkUrl: "https://ironworks-boxing.example.test/timetable" }, { observation: "No mobile enquiry form", sourceUrl: "https://ironworks-boxing.example.test", method: "visual_review", status: "hypothesis", uncertainty: "Form may exist behind login" }], commercialOpportunity: "Class enquiries are lost to a broken timetable and no mobile form.", recommendedScope: "Five-page site with timetable, trial-class enquiry form and mobile-first layout", internalRecommendedPriceAud: 2490, suggestedQuote: { deliverables: ["Home", "Classes & timetable", "Coaches", "Memberships", "Contact with trial-class enquiry form"], input: { pages: 5, designComplexity: "standard", contentPreparation: "client_supplied", integrations: [{ name: "Enquiry form", kind: "forms", providerConfirmed: true }], technicalRisk: "low" } }, contactEmail: "owner@ironworks-boxing.example.test", fixture: true },
  { businessName: "Pakenham Mobile Mechanics (fictional)", location: "Pakenham VIC", website: "https://pak-mobile-mech.example.test", industry: "Automotive", observations: [{ observation: "Placeholder lorem ipsum on services page", sourceUrl: "https://pak-mobile-mech.example.test/services", method: "visual_review", status: "hypothesis", uncertainty: "May be mid-rebuild" }], commercialOpportunity: "Quote requests unclear.", recommendedScope: "One-page site", internalRecommendedPriceAud: 1490, fixture: true },
];

function build(opts: { telephony?: FakeTelephony } = {}) {
  const store = new SqliteStore(":memory:");
  const mailer = new FakeMailer();
  const push = new FakePushNotifier();
  const checker = new FakeWebsiteChecker({ "https://ironworks-boxing.example.test/timetable": { reachable: false, status: 404 }, "https://ironworks-boxing.example.test": { reachable: true, status: 200, title: "Ironworks Boxing" } });
  const atlas = new Atlas({ store, mailer, mailbox: new FakeMailbox(), telephony: opts.telephony ?? new FakeTelephony(), boxsafe: new FakeBoxSafeGateway(), stripe: new FakeStripeGateway(), websiteChecker: checker, pushNotifier: push, research: { find: async () => candidates }, config: { ownerName: "Brandon", ownerEmail: "brandon@example.test", ownerPhone: "+61400000000", businessFromAddress: "hello@wulffstudio.example.test", budgetLimitAud: 300, gstRegistered: false } });
  return { atlas, store, mailer, push };
}

describe("Atlas end-to-end (fictional data)", () => {
  it("runs the brief's scenario: research → quote → approve → send → scope change → new approval", async () => {
    const { atlas, mailer } = build();
    const r1 = await atlas.handleCommand("Atlas, find five businesses around Berwick that need better websites.");
    expect(r1.reply).toMatch(/identified 2 candidates. 1 have confirmed website issues/);
    const best = atlas.prospects.bestLead();
    expect(best?.businessName).toMatch(/Ironworks/);
    expect(best?.evidence.find((e) => e.observation.includes("404"))?.status).toBe("confirmed");
    expect(atlas.prospects.list().find((p) => p.businessName.includes("Pakenham"))?.qualification).toBe("unqualified");

    const r2 = await atlas.handleCommand("Prepare a website concept for that gym");
    expect(r2.outcome).toBe("awaiting_approval");
    expect(r2.reply).toContain("A$2490");
    expect(mailer.sent).toHaveLength(0);

    // Sending before approval is denied.
    const quote = atlas.quotes.list()[0]!;
    await expect(atlas.sendQuote(quote.id)).rejects.toThrowError(/No approved version/);

    const vague = await atlas.handleCommand("sounds good, go ahead");
    expect(vague.outcome).toBe("unknown");
    expect(mailer.sent).toHaveLength(0);
    const r3 = await atlas.handleCommand("Yes, approved.");
    expect(r3.outcome).toBe("completed");
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe("owner@ironworks-boxing.example.test");
    expect(mailer.sent[0]!.approvalId).toBeTruthy();
    expect(atlas.prospects.get(quote.prospectId)?.stage).toBe("quote_sent");

    // Re-running the job does not send twice.
    await atlas.jobs.drain();
    expect(mailer.sent).toHaveLength(1);

    const reply = atlas.handleCustomerReply(quote.id, "Looks great. Can you also add online booking so people can book a trial class?");
    expect(reply.changed).toBe(true);
    expect(reply.note).toContain("A$3190");
    expect(atlas.approvals.pending()).toHaveLength(1);
    expect(atlas.approvals.pending()[0]!.version).toBe(2);
    // Earlier approval cannot authorise the changed quote.
    await expect(atlas.sendQuote(reply.revised!.quote.id)).rejects.toThrowError(/No approved version/);
    expect(mailer.sent).toHaveLength(1);

    const r4 = await atlas.handleCommand("Approve the quote at $3,190");
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[1]!.subject).toContain("v2");
    expect(r4.outcome).toBe("completed");

    const versions = atlas.approvals.bySubject(`quote:${quote.prospectId}`);
    expect(versions.map((v) => v.status)).toEqual(["consumed", "consumed"]);
    const audit = atlas.audit.recent(200).map((a) => a.action);
    expect(audit).toContain("approval.consumed");
    expect(audit).toContain("quote.sent");
  });

  it("treats a different approved price as a revision with its own approval", async () => {
    const { atlas, mailer } = build();
    await atlas.researchProspects({ area: "Berwick", count: 5 });
    const best = atlas.prospects.bestLead()!;
    atlas.prepareQuote(best.id);
    const r = await atlas.handleCommand("approve the quote at $2,290");
    expect(r.reply).toMatch(/Approved at A\$2290 \(revised from A\$2490\)/);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.text).toContain("A$2290");
    const versions = atlas.approvals.bySubject(`quote:${best.id}`);
    expect(versions.map((v) => v.status)).toEqual(["superseded", "consumed"]);
    expect(atlas.audit.recent(200).some((e) => e.action === "approval.revise_requested")).toBe(true);
  });

  it("produces BoxSafe briefings from fictional data and labels them as such", async () => {
    const { atlas } = build();
    const r = await atlas.handleCommand("Atlas, read me today's BoxSafe orders");
    expect(r.outcome).toBe("simulated");
    expect(r.reply).toMatch(/BoxSafe received \d+ paid orders? today/);
    expect(r.reply).toContain("fictional data");
    const b = await atlas.briefing();
    expect(b.dataNotice).toMatch(/FICTIONAL/);
    expect(b.sections.find((s) => s.heading === "Needs your approval")?.lines[0]).toMatch(/Nothing needs your approval|needs review/);
    const rec = await atlas.handleCommand("Check the Stripe payments against the orders");
    expect(rec.reply).toMatch(/3 issues/);
    const d = await atlas.handleCommand("Which merchandise orders need posting?");
    expect(d.reply).toMatch(/2 orders need posting/);
  });

  it("scheduled checks are idempotent across runs", async () => {
    const { atlas } = build();
    const first = await atlas.runScheduledChecks();
    const second = await atlas.runScheduledChecks();
    expect(first.notifications).toBeGreaterThan(0);
    expect(second.notifications).toBe(0);
  });

  it("never reports a phone call as completed without a provider record", async () => {
    const { atlas } = build({ telephony: new FakeTelephony("no_answer") });
    const { notification } = await atlas.notifications.emit({ eventKey: "outage:1", priority: "critical", business: "wulff_studio", title: "Client site down", body: "HTTP 503" });
    const res = await atlas.escalateByPhone(notification);
    expect(res.attempted).toBe(true);
    expect(res.status).toBe("no_answer");
    expect(atlas.notifications.byEventKey("outage:1")?.deliveries.some((d) => d.channel === "call")).toBe(false);
  });

  it("blocks sending to a suppressed prospect even when approved", async () => {
    const { atlas, mailer } = build();
    await atlas.researchProspects({ area: "Berwick", count: 5 });
    const best = atlas.prospects.bestLead()!;
    const { approval } = atlas.prepareQuote(best.id);
    atlas.prospects.suppress(best.id, "asked not to be contacted");
    atlas.approvals.decide(approval.id, "approve", "Brandon");
    await expect(atlas.sendQuote(atlas.quotes.latestForProspect(best.id)!.id)).rejects.toThrowError(/suppression list/);
    expect(mailer.sent).toHaveLength(0);
  });

  it("denies level-5 actions outright", () => {
    const { atlas } = build();
    expect(() => (atlas as any).assertExecutable("human.bank_operation")).toThrowError(PermissionDeniedError);
  });
});

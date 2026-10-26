import { afterEach, describe, expect, it, vi } from "vitest";
import { Atlas, type ProspectCandidate } from "../src/orchestrator.js";
import { SqliteStore } from "../src/store.js";
import { FakeBoxSafeGateway, FakeMailer, FakeStripeGateway, FakeTelephony, FakeWebsiteChecker } from "../src/adapters/fake/index.js";
import { AcquisitionService, type AcquisitionMailTransport, type AcquisitionOptions, type AcquisitionRecord } from "../src/acquisition/service.js";

const stores: SqliteStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); vi.restoreAllMocks(); });
const sender = { name: "Brandon", organisation: "Wulff Studio (fictional)", email: "hello@wulffstudio.example.test", contactDetails: "Reply to hello@wulffstudio.example.test" };
function setup(extra: { connected?: boolean; max?: number; fail?: boolean; candidates?: ProspectCandidate[] } = {}) {
  let now = new Date("2026-10-26T05:00:00Z");
  const clock = () => now;
  const store = new SqliteStore(":memory:"); stores.push(store);
  const atlas = new Atlas({ store, mailer: new FakeMailer(), telephony: new FakeTelephony(), boxsafe: new FakeBoxSafeGateway(), stripe: new FakeStripeGateway(), websiteChecker: new FakeWebsiteChecker(), research: { find: vi.fn(async () => extra.candidates ?? []) }, clock, config: { ownerName: "Brandon", ownerEmail: "owner@example.test", ownerPhone: null, businessFromAddress: sender.email, budgetLimitAud: 300, gstRegistered: false } });
  const send = vi.fn<AcquisitionMailTransport["send"]>(async () => { if (extra.fail) throw new Error("network error containing provider-secret-never-persist"); return { providerRef: "fakemail_test_1", acceptedAt: now.toISOString() }; });
  const mailer: AcquisitionMailTransport = { status: vi.fn(async () => ({ state: extra.connected === false ? "not_connected" as const : "fake" as const, provider: "Fictional mail test transport", detail: "No external requests.", sender: sender.email })), send };
  const options: AcquisitionOptions = { publicOrigin: "https://jarvis.example.test", mode: "fake", mailer, fromAddress: sender.email, senderName: sender.name, organisation: sender.organisation, contactDetails: sender.contactDetails, maxSendsPerDay: extra.max, clock };
  const service = new AcquisitionService(atlas, options);
  return { store, atlas, service, options, send, mailer, setNow: (date: string) => { now = new Date(date); } };
}
function add(service: AcquisitionService, number = 1, email = `owner${number}@business${number}.example.test`) {
  return service.addLead({ businessName: `Example Fencing ${number} (fictional)`, location: "Berwick, Victoria", industry: "Fencing trades", website: `https://business${number}.example.test`, sourceUrl: `https://business${number}.example.test/contact`, observation: "Published business contact page (fictional test record). No website defect or contact consent is asserted.", services: ["Timber fencing", "Repairs"], contactEmail: email });
}
function eligible(service: AcquisitionService, record: AcquisitionRecord, email = record.contact!.email) {
  return service.saveContact(record.id, { email, sourceUrl: record.sourceUrl, basis: "express_consent", evidence: "Fictional test record: the owner has documented express consent for this exact initial concept email.", roleRelevant: true, noMarketingProhibition: true }, "Brandon");
}
function rawDemo(record: AcquisitionRecord): string { return /\/demos\/([A-Za-z0-9_-]+)/.exec(record.draft!.text)![1]!; }
function rawUnsub(record: AcquisitionRecord): string { return /\/unsubscribe\/([A-Za-z0-9_-]+)/.exec(record.draft!.text)![1]!; }

describe("client acquisition domain", () => {
  it("prepares real private artifacts and honest blockers without connected search, sender or contact", async () => {
    const { service, send } = setup({ connected: false });
    const lead = add(service);
    const prepared = service.prepare(lead.id);
    expect(prepared.demo?.templateId).toBe("fieldwork");
    expect(prepared.demo?.publicPath).toBeNull();
    expect(service.ownerPreview(prepared.demo!.id)?.html).toContain("FICTIONAL TEST RECORD");
    expect(service.publicPreview(rawDemo(prepared))).toBeNull();
    expect(prepared.draft?.text).toContain(prepared.businessName);
    expect(prepared.draft?.text).toContain("independent website concept");
    const snapshot = await service.snapshot();
    expect(snapshot.email.state).toBe("not_connected");
    expect(snapshot.sender.ready).toBe(false);
    expect(snapshot.records[0]?.draft?.blockers.join(" ")).toMatch(/Connect an authorised mail account/);
    expect(snapshot.records[0]?.draft?.blockers.join(" ")).toMatch(/eligibility/);
    expect(JSON.stringify(snapshot)).not.toContain("<!doctype");
    expect(send).not.toHaveBeenCalled();
    await expect(service.approveAndSend(prepared.id, prepared.draft!.contentHash, "Brandon")).rejects.toThrow(/Connect an authorised/);
    expect(service.publicPreview(rawDemo(prepared))).toBeNull();
  });

  it("discovers a bounded fictional batch, preserving source uncertainty and preparing without sending", async () => {
    const candidate: ProspectCandidate = { businessName: "Example Fitness (fictional)", location: "Berwick (unverified)", website: "https://fitness.example.test", industry: "Fitness", observations: [{ observation: "Unverified fictional search title", sourceUrl: "https://fitness.example.test", method: "search_result", status: "unverified", uncertainty: "Search results need verification." }], commercialOpportunity: "Not established", recommendedScope: "Needs review", internalRecommendedPriceAud: null, fixture: true };
    const { service, atlas, send } = setup({ candidates: [candidate] });
    const records = await service.discover({ area: "Berwick", industry: "Fitness", count: 1 });
    expect(records).toHaveLength(1);
    expect(records[0]?.demo?.templateId).toBe("momentum");
    expect(records[0]?.draft).not.toBeNull();
    expect(records[0]?.contact).toBeNull();
    expect(atlas.prospects.require(records[0]!.prospectId).evidence[0]?.status).toBe("unverified");
    expect(atlas.prospects.require(records[0]!.prospectId).qualification).toBe("unqualified");
    expect(atlas.audit.recent(50).find(entry => entry.action === "acquisition.demo.prepared")?.actor).toBe("agent:design");
    expect(send).not.toHaveBeenCalled();
    await expect(service.discover({ area: "Berwick", count: 6 })).rejects.toThrow(/one to five/);
  });

  it("requires exact email hashes and preserves mandatory demo, unsubscribe and sender details on edits", () => {
    const { service } = setup();
    let lead = service.prepare(add(service).id);
    const oldHash = lead.draft!.contentHash;
    lead = eligible(service, lead);
    expect(lead.draft!.contentHash).not.toBe(oldHash);
    expect(() => service.saveDraft(lead.id, { expectedHash: oldHash, subject: "Changed", text: lead.draft!.text })).toThrow(/version changed/);
    expect(() => service.saveDraft(lead.id, { expectedHash: lead.draft!.contentHash, subject: "Changed", text: "No required footer or links" })).toThrow(/Keep the exact demo link/);
    const updated = service.saveDraft(lead.id, { expectedHash: lead.draft!.contentHash, subject: "A tailored website concept", text: lead.draft!.text + "\n\nThe editorial design is one possible creative direction." });
    expect(updated.draft!.contentHash).not.toBe(lead.draft!.contentHash);
    expect(updated.draft!.version).toBe(lead.draft!.version + 1);
    expect(() => service.saveContact(lead.id, { ...lead.contact!, basis: "express_consent", email: "victim@example.test\r\nBcc:other@example.test" }, "Brandon")).toThrow(/invalid/);
  });

  it("publishes only the exact reviewed demo and enforces expiry and revocation without sending", () => {
    const { service, setNow, send, atlas } = setup();
    const prepared = service.prepare(add(service).id), raw = rawDemo(prepared);
    expect(service.publicPreview(raw)).toBeNull();
    expect(() => service.publish(prepared.id, "stale", "Brandon")).toThrow(/demo changed/);
    const published = service.publish(prepared.id, prepared.demo!.htmlHash, "Brandon");
    expect(published.demo?.publicPath).toContain(raw);
    expect(service.publicPreview(raw)?.html).toContain("Independent website concept");
    expect(atlas.approvals.list()[0]?.status).toBe("consumed");
    expect(send).not.toHaveBeenCalled();
    setNow("2026-11-10T05:00:00Z"); expect(service.publicPreview(raw)).toBeNull();
    setNow("2026-10-26T05:00:00Z"); service.revoke(prepared.id); expect(service.publicPreview(raw)).toBeNull();
    expect(service.publicPreview("../../etc/passwd")).toBeNull();
  });

  it("detects stored HTML tampering even if metadata and expected draft hash are unchanged", async () => {
    const { service, store, send } = setup();
    let prepared = service.prepare(add(service).id); prepared = eligible(service, prepared);
    const internal = store.getDoc<{ html: string }>("acquisition_demos", prepared.demo!.id)!.doc;
    internal.html += "<script>bad()</script>"; store.upsertDoc("acquisition_demos", prepared.demo!.id, internal);
    expect(() => service.publish(prepared.id, prepared.demo!.htmlHash, "Brandon")).toThrow(/demo changed/);
    await expect(service.approveAndSend(prepared.id, prepared.draft!.contentHash, "Brandon")).rejects.toThrow(/concept content changed/i);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not serve altered stored HTML after a concept was published", () => {
    const { service, store } = setup();
    const record = service.prepare(add(service).id), raw = rawDemo(record);
    service.publish(record.id, record.demo!.htmlHash, "Brandon");
    expect(service.publicPreview(raw)).not.toBeNull();
    const internal = store.getDoc<{ html: string }>("acquisition_demos", record.demo!.id)!.doc;
    internal.html = internal.html.replace("Independent website concept", "Altered after approval");
    store.upsertDoc("acquisition_demos", record.demo!.id, internal);
    expect(service.publicPreview(raw)).toBeNull();
  });

  it("sends an explicit exact version once, marking fake transport simulated and binding the whole envelope", async () => {
    const { service, send, atlas } = setup();
    let record = service.prepare(add(service).id); record = eligible(service, record);
    const result = await service.approveAndSend(record.id, record.draft!.contentHash, "Brandon");
    expect(result.draft?.status).toBe("simulated");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ to: record.contact!.email, from: sender.email, text: record.draft!.text, unsubscribeUrl: expect.stringContaining("/unsubscribe/"), idempotencyKey: expect.stringContaining(record.draft!.contentHash) });
    expect(service.publicPreview(rawDemo(record))).not.toBeNull();
    const approval = atlas.approvals.list()[0]!;
    expect(approval.status).toBe("consumed");
    expect(approval.payload).toMatchObject({ to: record.contact!.email, subject: record.draft!.subject, text: record.draft!.text, demoHtmlHash: record.demo!.htmlHash, sender: expect.objectContaining({ name: sender.name }), contactEligibility: expect.objectContaining({ basis: "express_consent" }) });
    await service.approveAndSend(record.id, record.draft!.contentHash, "Brandon");
    await atlas.jobs.drain(); expect(send).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate rapid approvals while a connection verification is pending", async () => {
    const { service, send, mailer } = setup();
    let record = service.prepare(add(service).id); record = eligible(service, record);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const status = mailer.status.bind(mailer);
    vi.spyOn(mailer, "status").mockImplementationOnce(async () => { await pending; return status(); });
    const first = service.approveAndSend(record.id, record.draft!.contentHash, "Brandon");
    await service.approveAndSend(record.id, record.draft!.contentHash, "Brandon");
    release(); await first;
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("ignores stale queued versions without blocking the newly approved exact message", async () => {
    const { service, atlas, send } = setup();
    let record = eligible(service, service.prepare(add(service).id));
    vi.spyOn(atlas.jobs, "runOnce").mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await service.approveAndSend(record.id, record.draft!.contentHash, "Brandon");
    record = service.saveDraft(record.id, { expectedHash: record.draft!.contentHash, subject: "Updated website concept", text: record.draft!.text + "\nA further creative direction for your review." });
    await service.approveAndSend(record.id, record.draft!.contentHash, "Brandon");
    await atlas.jobs.runOnce();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].subject).toBe("Updated website concept");
    expect(atlas.approvals.list().map(a => a.status).sort()).toEqual(["consumed", "superseded"]);
  });

  it("expires unsent queued messages at the Melbourne day boundary and requires a fresh owner hash", async () => {
    const { service, atlas, send, setNow } = setup();
    const record = eligible(service, service.prepare(add(service).id));
    vi.spyOn(atlas.jobs, "runOnce").mockResolvedValueOnce([]);
    await service.approveAndSend(record.id, record.draft!.contentHash, "Brandon");
    setNow("2026-10-27T05:00:00Z");
    await atlas.jobs.runOnce();
    expect(send).not.toHaveBeenCalled();
    let latest = (await service.snapshot()).records[0]!;
    expect(latest.draft!.contentHash).not.toBe(record.draft!.contentHash);
    await expect(service.approveAndSend(record.id, record.draft!.contentHash, "Brandon")).rejects.toThrow(/version changed/);
    latest = await service.approveAndSend(latest.id, latest.draft!.contentHash, "Brandon");
    expect(latest.draft?.status).toBe("simulated");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rechecks the Melbourne day after an asynchronous sender verification crosses midnight", async () => {
    const { service, mailer, send, setNow, store } = setup();
    const record = eligible(service, service.prepare(add(service).id));
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const original = vi.mocked(mailer.status).getMockImplementation()!;
    vi.spyOn(mailer, "status").mockImplementationOnce(original).mockImplementationOnce(async () => { entered(); await waiting; return original(); });
    const submitting = service.approveAndSend(record.id, record.draft!.contentHash, "Brandon");
    await started;
    setNow("2026-10-27T05:00:00Z"); release();
    const result = await submitting;
    expect(result.draft?.status).toBe("blocked");
    expect(result.draft?.blockers.join(" ")).toMatch(/queued message expired/);
    expect(send).not.toHaveBeenCalled();
    expect(store.getMemory("acquisition.quota.2026-10-26")).toBeNull();
    expect(store.getMemory("acquisition.quota.2026-10-27")).toBeNull();
  });

  it("rechecks suppression after enqueue and applies unsubscribe globally without exposing an address", async () => {
    const { service, atlas, send } = setup();
    let first = service.prepare(add(service).id); first = eligible(service, first);
    vi.spyOn(atlas.jobs, "runOnce").mockResolvedValueOnce([]);
    expect((await service.approveAndSend(first.id, first.draft!.contentHash, "Brandon")).draft?.status).toBe("queued");
    const raw = rawUnsub(first);
    expect(service.unsubscribePreview(raw)).toEqual({ alreadySuppressed: false });
    expect(service.unsubscribe(raw)).toBe(true);
    expect(service.unsubscribe(raw)).toBe(true);
    expect(service.unsubscribePreview(raw)).toEqual({ alreadySuppressed: true });
    await atlas.jobs.runOnce(); expect(send).not.toHaveBeenCalled();
    const other = eligible(service, service.prepare(add(service, 2, first.contact!.email).id));
    const current = (await service.snapshot()).records.find(r => r.id === other.id)!;
    expect(current.draft?.blockers.join(" ")).toMatch(/suppressed/);
    expect(service.unsubscribe("not-a-token")).toBe(false);
  });

  it("reserves daily quota and one initial contact per business/recipient across restart and dates", async () => {
    const { service, atlas, options, send, setNow } = setup({ max: 1 });
    let first = eligible(service, service.prepare(add(service).id));
    await service.approveAndSend(first.id, first.draft!.contentHash, "Brandon");
    const second = eligible(service, service.prepare(add(service, 2).id));
    await expect(service.approveAndSend(second.id, second.draft!.contentHash, "Brandon")).rejects.toThrow(/daily initial-email limit/);
    const restarted = new AcquisitionService(atlas, options);
    setNow("2026-10-27T05:00:00Z");
    await restarted.approveAndSend(second.id, second.draft!.contentHash, "Brandon");
    expect(send).toHaveBeenCalledTimes(2);
    first = restarted.prepare(first.id);
    await expect(restarted.approveAndSend(first.id, first.draft!.contentHash, "Brandon")).rejects.toThrow(/initial message has already been reserved/);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not carry an old provider acceptance record onto edited unsent text", async () => {
    const { service, send } = setup();
    let record = eligible(service, service.prepare(add(service).id));
    record = await service.approveAndSend(record.id, record.draft!.contentHash, "Brandon");
    expect(record.draft?.providerRef).toBeTruthy();
    expect(record.draft?.acceptedAt).toBeTruthy();
    record = service.saveDraft(record.id, { expectedHash: record.draft!.contentHash, subject: "Edited concept after original acceptance", text: record.draft!.text + "\nNew text that has not been sent." });
    expect(record.draft?.status).toBe("draft");
    expect(record.draft?.providerRef).toBeUndefined();
    expect(record.draft?.acceptedAt).toBeUndefined();
    await expect(service.approveAndSend(record.id, record.draft!.contentHash, "Brandon")).rejects.toThrow(/initial message has already been reserved/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps ambiguous submissions terminal without retry or leaking provider exception details", async () => {
    const { service, send, atlas, store, options } = setup({ fail: true });
    let record = eligible(service, service.prepare(add(service).id));
    record = await service.approveAndSend(record.id, record.draft!.contentHash, "Brandon");
    expect(record.draft?.status).toBe("uncertain");
    expect(JSON.stringify(record)).not.toContain("provider-secret");
    expect(atlas.jobs.list()[0]?.maxAttempts).toBe(1);
    await atlas.jobs.drain(); await service.approveAndSend(record.id, record.draft!.contentHash, "Brandon");
    expect(send).toHaveBeenCalledTimes(1);
    record.draft!.status = "submitting"; store.upsertDoc("acquisition_records", record.id, record);
    const restarted = new AcquisitionService(atlas, options);
    expect((await restarted.snapshot()).records[0]?.draft?.status).toBe("uncertain");
    await atlas.jobs.drain(); expect(send).toHaveBeenCalledTimes(1);
  });

  it("invalidates existing drafts when the sender changes and never guesses consent from a public address", async () => {
    const { service, send } = setup();
    let record = service.prepare(add(service).id); const old = record.draft!.contentHash;
    expect(record.contact?.basis).toBe("none_established");
    record = service.saveContact(record.id, { ...record.contact!, basis: "inferred_consent_business", evidence: "Publicly published business email", roleRelevant: false, noMarketingProhibition: false }, "Brandon");
    await expect(service.approveAndSend(record.id, record.draft!.contentHash, "Brandon")).rejects.toThrow(/eligibility evidence/);
    service.saveSender({ ...sender, name: "A different authorised owner" }, "Brandon");
    const current = (await service.snapshot()).records[0]!;
    expect(current.draft!.contentHash).not.toBe(old);
    await expect(service.approveAndSend(record.id, old, "Brandon")).rejects.toThrow(/version changed/);
    expect(send).not.toHaveBeenCalled();
  });

  it("blocks live publication of fictional fixtures and checks authorised sender identity", async () => {
    const { service, atlas, options, mailer } = setup();
    const record = service.prepare(add(service).id);
    const liveService = new AcquisitionService(atlas, { ...options, mode: "live", publicOrigin: "https://jarvis.business.com" });
    expect(() => liveService.publish(record.id, record.demo!.htmlHash, "Brandon")).toThrow(/Fictional fixtures/);
    vi.spyOn(mailer, "status").mockResolvedValue({ state: "fake", provider: "Test transport", detail: "No email sent", sender: "another@business.example.test" });
    expect((await service.snapshot()).sender.ready).toBe(false);
  });

  it("uses a transport-verified reply address to fill blank sender details and invalidates prior drafts", async () => {
    const { atlas, options, send } = setup();
    const service = new AcquisitionService(atlas, { ...options, fromAddress: "", contactDetails: "" });
    const record = service.prepare(add(service).id);
    const oldHash = record.draft!.contentHash;
    const snapshot = await service.snapshot();
    expect(snapshot.sender).toMatchObject({ email: sender.email, contactDetails: sender.email, ready: true });
    expect(snapshot.records[0]?.draft?.from).toBe(sender.email);
    expect(snapshot.records[0]?.draft?.contentHash).not.toBe(oldHash);
    expect(snapshot.records[0]?.draft?.text).toContain(sender.email);
    expect(send).not.toHaveBeenCalled();
  });
});

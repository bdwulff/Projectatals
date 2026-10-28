import { afterEach, describe, expect, it, vi } from "vitest";
import { Atlas, type ProspectCandidate } from "../src/orchestrator.js";
import { SqliteStore } from "../src/store.js";
import { FakeBoxSafeGateway, FakeMailer, FakeStripeGateway, FakeTelephony, FakeWebsiteChecker } from "../src/adapters/fake/index.js";
import { AcquisitionService, type AcquisitionMailTransport, type AcquisitionOptions, type AcquisitionRecord } from "../src/acquisition/service.js";
import { businessProfileSummary, type BusinessProfile } from "../src/acquisition/business-profile.js";

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
  it("uses cited business facts for a no-website concept without inventing an official site or artwork", () => {
    const { service, send } = setup();
    const record = service.addLead({ businessName: "Garden craft (fictional)", location: "Berwick, Victoria", industry: "Garden maintenance", website: null, sourceUrl: "https://directory.example.com/garden-craft", observation: "Fictional directory research; an independent website was not found in these checks.", services: ["Hedge trimming", "Garden clean-ups"], description: "Source description with <script>untrusted markup</script>", address: "1 Fictional Avenue, Berwick", phone: "(03) 0000 0000" });
    const prepared = service.prepare(record.id, { templateId: "immersive" });
    const html = service.ownerPreview(prepared.demo!.id)!.html;
    expect(prepared.website).toBeNull();
    expect(prepared.businessProfile?.sourceUrl).toBe("https://directory.example.com/garden-craft");
    expect(prepared.businessProfile?.logo).toBeUndefined();
    expect(prepared.businessProfile?.images).toEqual([]);
    expect(html).toContain("1 Fictional Avenue"); expect(html).toContain("Hedge trimming");
    expect(html).not.toContain("<script>untrusted markup</script>");
    expect(prepared.demo?.designBrief?.family).toBe("craft");
    expect(service.publicPreview(rawDemo(prepared))).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses malformed public contact facts before creating any prospect", () => {
    const { service, atlas } = setup();
    expect(() => service.addLead({ businessName: "Invalid facts (fictional)", location: "Berwick", industry: "Trade", sourceUrl: "https://directory.example.com/company", observation: "Fictional test", phone: "0412 345 678; bcc: victim@example.com" })).toThrow();
    expect(atlas.prospects.list()).toEqual([]);
  });

  it("updates the trusted company identity without changing the email account or erasing owner edits", async () => {
    const { service, send } = setup();
    const original = service.prepare(add(service).id);
    const edited = service.saveDraft(original.id, { expectedHash: original.draft!.contentHash, subject: "Owner's fictional introduction", text: original.draft!.text + "\nMy personally written note." });
    service.configureCompany({ name: "Wulff Digital (fictional)", website: "https://studio.example.com" });
    const current = (await service.snapshot()).records[0]!;
    expect(current.draft!.text).toContain("My personally written note.");
    expect(current.draft!.subject).toBe(edited.draft!.subject);
    expect(current.draft!.text).toContain("Wulff Digital (fictional)");
    expect(current.draft!.text).toContain("https://studio.example.com/");
    expect(current.draft!.from).toBe(sender.email);
    expect(current.draft!.contentHash).not.toBe(edited.draft!.contentHash);
    await expect(service.approveAndSend(current.id, edited.draft!.contentHash, "Brandon")).rejects.toThrow(/version changed/);
    expect(() => service.configureCompany({ name: "Unsafe", website: "https://127.0.0.1" })).toThrow(/public HTTPS/);
    expect(service.company().name).toBe("Wulff Digital (fictional)");
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the generated React project private and excludes draft and publication credentials", () => {
    const { service, store, send } = setup();
    const legacy = service.prepare(add(service).id);
    expect(() => service.sourceProject(legacy.id)).toThrow(/Clarity/);
    store.setMemory("owner.private_secret", "fictional-owner-secret-never-export");
    service.configureCompany({ name: "Wulff Digital (fictional)", website: "https://studio.example.com" });
    const record = service.prepare(legacy.id, { templateId: "clarity" });
    const files = service.sourceProject(record.id).files;
    const source = JSON.stringify(files);
    expect(files["src/App.tsx"]).toContain(record.businessName);
    expect(source).toContain("Wulff Digital (fictional)");
    expect(source).not.toContain(rawDemo(record));
    expect(source).not.toContain(rawUnsub(record));
    expect(source).not.toContain("fictional-owner-secret-never-export");
    expect(service.publicPreview(rawDemo(record))).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("adopts a public contact candidate as unreviewed data and keeps sending blocked", async () => {
    const { service, options, atlas, store, send } = setup();
    const lead = service.addLead({ businessName: "Contact source (fictional)", location: "Berwick", industry: "Plumbing", website: "https://contact.example.com", sourceUrl: "https://contact.example.com", observation: "Fictional public contact adapter test." });
    options.mode = "live";
    const prospect = atlas.prospects.require(lead.prospectId); prospect.fixture = false; store.upsertDoc("prospects", prospect.id, prospect);
    options.enricher = { enrich: async () => ({ state: "partial", detail: "Fictional injected public source", sourceUrl: lead.website!, fetchedAt: "2026-10-26T05:00:00Z", services: [], images: [], notices: [], contactEmail: "hello@contact.example.com", contactSourceUrl: "https://contact.example.com/contact" }) };
    const result = await service.enrichAndPrepare(lead.id, { templateId: "clarity" });
    expect(result.contact).toMatchObject({ email: "hello@contact.example.com", basis: "none_established", roleRelevant: false, noMarketingProhibition: false });
    expect(result.contact?.reviewedBy).toBeUndefined();
    expect(result.draft?.to).toBe("hello@contact.example.com");
    await expect(service.approveAndSend(result.id, result.draft!.contentHash, "Brandon")).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("enriches facts before a private concept and invalidates every old demo/email approval hash", async () => {
    const {service,options,atlas,store,send}=setup();
    const old=service.prepare(add(service).id,{templateId:"folio"});
    // Exercise the live enrichment branch with an injected fictional profile; no network adapter exists here.
    options.mode="live";
    const prospect=atlas.prospects.require(old.prospectId);prospect.fixture=false;store.upsertDoc("prospects",prospect.id,prospect);
    const profile:BusinessProfile={state:"partial",detail:"Fictional adapter response",sourceUrl:old.website!,fetchedAt:"2026-10-26T05:00:00Z",description:"Fictional source description for the business",address:"1 Fictional Avenue, Berwick",phone:"(03) 0000 0000",services:["Fictional fallback service"],images:[],notices:["Fictional test profile"]};
    const enrich=vi.fn(async()=>profile);options.enricher={enrich};
    const current=await service.enrichAndPrepare(old.id);
    expect(enrich).toHaveBeenCalledTimes(1);expect(current.businessProfile?.address).toBe(profile.address);
    expect(current.demo?.templateId).toBe("folio");
    expect(service.ownerPreview(current.demo!.id)?.html).toContain(profile.address!);
    expect(current.demo!.htmlHash).not.toBe(old.demo!.htmlHash);expect(current.draft!.contentHash).not.toBe(old.draft!.contentHash);
    expect(()=>service.publish(current.id,old.demo!.htmlHash,"Brandon")).toThrow(/demo changed/);
    await expect(service.approveAndSend(current.id,old.draft!.contentHash,"Brandon")).rejects.toThrow(/version changed/);
    await service.enrichAndPrepare(old.id);expect(enrich).toHaveBeenCalledTimes(1);
    const refreshed=await service.enrichAndPrepare(old.id,{refresh:true});expect(enrich).toHaveBeenCalledTimes(2);expect(refreshed.demo?.templateId).toBe("folio");
    expect(send).not.toHaveBeenCalled();
  });

  it("never fetches a real website for fictional mode and omits image bytes from dashboard summaries", async () => {
    const {service,options}=setup();const enrich=vi.fn();options.enricher={enrich};
    const lead=await service.enrichAndPrepare(add(service).id);
    expect(enrich).not.toHaveBeenCalled();expect(lead.businessProfile?.state).toBe("fictional");
    const image={dataUrl:"data:image/png;base64,fixture",sourceUrl:"https://business.example.test/logo.png",alt:"Fictional logo",mime:"image/png" as const,sha256:"a".repeat(64),width:96,height:96};
    const summary=businessProfileSummary({state:"fictional",detail:"Fictional",sourceUrl:lead.website!,fetchedAt:"2026-10-26T05:00:00Z",services:[],logo:image,images:[image],notices:[]});
    expect(JSON.stringify(summary)).not.toContain("dataUrl");expect(summary.logo?.sha256).toBe(image.sha256);
  });

  it("does not overwrite owner edits made while website enrichment is running", async () => {
    const {service,options,atlas,store}=setup();const lead=service.prepare(add(service).id);
    options.mode="live";const prospect=atlas.prospects.require(lead.prospectId);prospect.fixture=false;store.upsertDoc("prospects",prospect.id,prospect);
    let finish!:(profile:BusinessProfile)=>void;options.enricher={enrich:()=>new Promise(resolve=>{finish=resolve;})};
    const pending=service.enrichAndPrepare(lead.id);
    service.saveDraft(lead.id,{expectedHash:lead.draft!.contentHash,subject:"Owner edited while source was loading",text:lead.draft!.text+"\nAn owner-written fictional note."});
    finish({state:"partial",detail:"Fictional",sourceUrl:lead.website!,fetchedAt:"2026-10-26T05:00:00Z",address:"Stale fictional address",services:[],images:[],notices:[]});
    await expect(pending).rejects.toThrow(/changed while/);
    expect((await service.snapshot()).records[0]?.businessProfile).toEqual(lead.businessProfile);
  });

  it("binds mail provider selection to a new exact version while preserving the edited email", async () => {
    const {service,options,send}=setup();let provider="gmail";options.mailProviderIdentity=()=>provider;
    const initial=service.prepare(add(service).id);
    const edited=service.saveDraft(initial.id,{expectedHash:initial.draft!.contentHash,subject:"A personal fictional subject",text:initial.draft!.text+"\nAn owner-written closing sentence."});
    provider="resend";
    await expect(service.approveAndSend(edited.id,edited.draft!.contentHash,"Brandon")).rejects.toThrow(/version changed/);
    const updated=(await service.snapshot()).records[0]!;
    expect(updated.draft!.contentHash).not.toBe(edited.draft!.contentHash);expect(updated.draft!.version).toBe(edited.draft!.version+1);
    expect(updated.draft!.text).toBe(edited.draft!.text);expect(updated.draft!.subject).toBe(edited.draft!.subject);expect(updated.draft!.mailProviderIdentity).toBe("resend");
    expect(send).not.toHaveBeenCalled();
  });

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

  it("archives false candidates without deleting their source evidence, and revokes all private/public previews", async () => {
    const { service, store, atlas, send } = setup();
    const first = service.prepare(add(service).id), firstRaw = rawDemo(first), unsubscribeRaw = rawUnsub(first);
    service.publish(first.id, first.demo!.htmlHash, "Brandon");
    const second = service.prepare(first.id), secondRaw = rawDemo(second);
    service.publish(second.id, second.demo!.htmlHash, "Brandon");
    const evidenceBefore = atlas.prospects.require(first.prospectId).evidence;
    service.archive(first.id, "Search result was a newspaper collection, not a local business.", "Brandon");
    service.archive(first.id, "Repeated archive request", "Brandon");
    expect((await service.snapshot()).records).toHaveLength(0);
    expect(service.publicPreview(firstRaw)).toBeNull();
    expect(service.publicPreview(secondRaw)).toBeNull();
    expect(service.ownerPreview(first.demo!.id)).toBeNull();
    expect(service.ownerPreview(second.demo!.id)).toBeNull();
    const stored = store.getDoc<AcquisitionRecord>("acquisition_records", first.id)!.doc;
    expect(stored.archivedAt).toBeTruthy();
    expect(stored.archiveReason).toContain("newspaper collection");
    expect(stored.draft?.status).toBe("cancelled");
    expect(store.getDoc("acquisition_demos", first.demo!.id)).not.toBeNull();
    expect(atlas.prospects.require(first.prospectId).evidence).toEqual(evidenceBefore);
    expect(atlas.audit.recent(100).filter(entry => entry.action === "acquisition.lead.archived")).toHaveLength(1);
    expect(() => add(service)).toThrow(/lead is archived/);
    expect(() => service.prepare(first.id)).toThrow(/lead is archived/);
    // Opt-out must still act on retained archived contact records.
    expect(service.unsubscribe(unsubscribeRaw)).toBe(true);
    expect(atlas.prospects.require(first.prospectId).contactEligibility.suppressed).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("cancels queued outreach when its lead is archived and never resurrects it during discovery", async () => {
    const candidate: ProspectCandidate = { businessName: "Example Fencing 1 (fictional)", location: "Berwick, Victoria", website: "https://business1.example.test", industry: "Fencing trades", observations: [{ observation: "Fictional retained source result", sourceUrl: "https://business1.example.test/contact", method: "search_result", status: "unverified" }], commercialOpportunity: "Not established", recommendedScope: "Needs review", internalRecommendedPriceAud: null, fixture: true };
    const { service, atlas, send } = setup({ candidates: [candidate] });
    const record = eligible(service, service.prepare(add(service).id));
    vi.spyOn(atlas.jobs, "runOnce").mockResolvedValueOnce([]);
    expect((await service.approveAndSend(record.id, record.draft!.contentHash, "Brandon")).draft?.status).toBe("queued");
    service.archive(record.id, "Comparison page is outside the intended local business scope.", "Brandon");
    await atlas.jobs.runOnce();
    expect(send).not.toHaveBeenCalled();
    expect(atlas.jobs.list()[0]?.result).toEqual({ status: "cancelled" });
    expect(await service.discover({ area: "Berwick", count: 1 })).toEqual([]);
    expect((await service.snapshot()).records).toEqual([]);
    await expect(service.approveAndSend(record.id, record.draft!.contentHash, "Brandon")).rejects.toThrow(/lead is archived/);
    expect(service.publicPreview(rawDemo(record))).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteStore } from "@atlas/core";
import { AcquisitionMailError, GmailAcquisitionMailTransport, ResendAcquisitionMailTransport, SelectableAcquisitionMailTransport, type AcquisitionMailTransport, type AcquisitionMailInput } from "./acquisition-mail.js";

const origin = "https://jarvis.example.test";
const ownerKey = "fictional-owner-key-".repeat(3);
const clientId = "fictional-client.apps.googleusercontent.com";
const clientSecret = "fictional-client-secret";
const refreshSecret = "fictional-refresh-token-sensitive";
const accessSecret = "fictional-access-token-sensitive";
const from = "owner@example.test";
const scope = "openid email https://www.googleapis.com/auth/gmail.send";
const stores: SqliteStore[] = [];
const store = () => { const result = new SqliteStore(":memory:"); stores.push(result); return result; };
const input = (overrides: Partial<AcquisitionMailInput> = {}): AcquisitionMailInput => ({ from, to: "business@example.test", subject: "A fictional concept for your business", text: "This is a fictional test, not a real prospect email.\nUnsubscribe: https://jarvis.example.test/unsubscribe/fictional-token", approvalId: "approval_fixture_123", idempotencyKey: "acquisition:fixture:1", unsubscribeUrl: "https://jarvis.example.test/unsubscribe/fictional-token", ...overrides });
function gmailSetup(options: { db?: SqliteStore; request?: typeof fetch; timeoutMs?: number; clock?: () => Date } = {}) {
  const db = options.db ?? store();
  const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target === "https://oauth2.googleapis.com/token") return Response.json({ access_token: accessSecret, refresh_token: refreshSecret, token_type: "Bearer", expires_in: 3600, scope });
    if (target === "https://openidconnect.googleapis.com/v1/userinfo") return Response.json({ email: from, email_verified: true });
    if (target === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send") return Response.json({ id: "fictional_message_123456" });
    throw new Error(`Unexpected URL ${target}`);
  });
  const config = { clientId, clientSecret, publicOrigin: origin, ownerAccessKey: ownerKey, store: db, request: options.request ?? request as unknown as typeof fetch, timeoutMs: options.timeoutMs, clock: options.clock };
  const gmail = new GmailAcquisitionMailTransport(config);
  const link = async () => { const url = new URL(gmail.startLink().url); await gmail.completeLink("fictional-auth-code", url.searchParams.get("state")!); return url; };
  return { gmail, request, db, config, link };
}
const sendRequests = (request: ReturnType<typeof vi.fn>) => request.mock.calls.filter(([url]) => String(url).endsWith("/messages/send"));
afterEach(() => { for (const db of stores.splice(0)) db.close(); vi.restoreAllMocks(); });

describe("Gmail HTTPS acquisition mail", () => {
  it("makes no network request on missing configuration or an unlinked account", async () => {
    const request = vi.fn(); const db = store();
    const missing = new GmailAcquisitionMailTransport({ store: db, request });
    expect(await missing.status()).toMatchObject({ state: "not_connected" });
    expect(() => missing.startLink()).toThrow(/GOOGLE_CLIENT_ID/);
    await expect(missing.send(input())).rejects.toMatchObject({ code: "not_configured" });
    const { gmail } = gmailSetup({ db, request });
    expect(await gmail.status()).toMatchObject({ state: "not_connected" });
    expect(request).not.toHaveBeenCalled();
  });
  it("creates one-use bounded OAuth state with PKCE and no secret in the authorisation URL", async () => {
    const { gmail, db, link, request } = gmailSetup();
    const url = await link();
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("redirect_uri")).toBe(origin + "/integrations/google/callback");
    expect(url.searchParams.get("scope")).toBe(scope);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.toString()).not.toContain(clientSecret);
    expect(JSON.stringify(db.listDocs("acquisition_google_oauth_state"))).not.toContain(url.searchParams.get("state")!);
    await expect(gmail.completeLink("fictional-auth-code", url.searchParams.get("state")!)).rejects.toMatchObject({ code: "oauth_state" });
    expect(request).toHaveBeenCalledTimes(2);
    expect(sendRequests(request)).toHaveLength(0);
  });
  it("completes a saved one-use state after the server restarts without a session cookie", async () => {
    const { gmail, config, request } = gmailSetup(); const state = new URL(gmail.startLink().url).searchParams.get("state")!;
    const restarted = new GmailAcquisitionMailTransport(config);
    await restarted.completeLink("fictional-code", state);
    expect(await restarted.status()).toMatchObject({ state: "connected", sender: from });
    expect(sendRequests(request)).toHaveLength(0);
    await expect(gmail.completeLink("fictional-code", state)).rejects.toMatchObject({ code: "oauth_state" });
  });
  it("expires or replaces link state without provider contact", async () => {
    let now = new Date("2026-10-26T00:00:00Z"); const { gmail, request } = gmailSetup({ clock: () => now });
    const first = new URL(gmail.startLink().url).searchParams.get("state")!;
    gmail.startLink();
    await expect(gmail.completeLink("fictional-code", first)).rejects.toMatchObject({ code: "oauth_state" });
    const fresh = new URL(gmail.startLink().url).searchParams.get("state")!;
    now = new Date(now.getTime() + 10 * 60_000);
    await expect(gmail.completeLink("fictional-code", fresh)).rejects.toMatchObject({ code: "oauth_state" });
    expect(request).not.toHaveBeenCalled();
  });
  it("consumes state even when Google rejects the code and withholds provider secrets", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ error: clientSecret + refreshSecret }), { status: 400 }));
    const { gmail } = gmailSetup({ request });
    const state = new URL(gmail.startLink().url).searchParams.get("state")!;
    const error = await gmail.completeLink("fictional-code", state).catch(e => e as Error);
    expect(String(error)).not.toContain(clientSecret); expect(String(error)).not.toContain(refreshSecret);
    await expect(gmail.completeLink("fictional-code", state)).rejects.toMatchObject({ code: "oauth_state" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("encrypts refresh credentials and reads the stored link again after restart", async () => {
    const { gmail, db, config, request, link } = gmailSetup(); await link();
    const stored = JSON.stringify(db.listDocs("acquisition_google_oauth_link"));
    expect(stored).toContain('"ciphertext"'); expect(stored).not.toContain(refreshSecret); expect(stored).not.toContain(accessSecret); expect(stored).not.toContain(clientSecret);
    expect(await gmail.status()).toMatchObject({ state: "connected", provider: "Gmail API", sender: from });
    const restarted = new GmailAcquisitionMailTransport(config);
    expect(await restarted.status()).toMatchObject({ state: "connected", sender: from });
    expect(sendRequests(request)).toHaveLength(0);
    expect(JSON.stringify(await restarted.status())).not.toContain(accessSecret);
  });
  it("refuses a saved token encrypted with a different owner key without leaking it", async () => {
    const { config, request, link } = gmailSetup(); await link(); request.mockClear();
    const changed = new GmailAcquisitionMailTransport({ ...config, ownerAccessKey: "other-fictional-key-".repeat(3) });
    const status = await changed.status(); expect(status.state).toBe("error"); expect(JSON.stringify(status)).not.toContain(refreshSecret);
    expect(request).not.toHaveBeenCalled();
  });
  it("requires a verified Google email and granted send permission", async () => {
    for (const bad of ["identity", "scope"]) {
      const request = vi.fn(async (url: string | URL | Request) => String(url).includes("/token")
        ? Response.json({ access_token: accessSecret, refresh_token: refreshSecret, expires_in: 3600, scope: bad === "scope" ? "openid email" : scope })
        : Response.json({ email: from, email_verified: false }));
      const { gmail, db } = gmailSetup({ request }); const state = new URL(gmail.startLink().url).searchParams.get("state")!;
      await expect(gmail.completeLink("fictional-code", state)).rejects.toBeInstanceOf(AcquisitionMailError);
      expect(db.listDocs("acquisition_google_oauth_link")).toHaveLength(0);
    }
  });
  it("rejects sender mismatch and unsafe headers before provider send", async () => {
    const { gmail, request, link } = gmailSetup(); await link(); request.mockClear();
    for (const mail of [input({ from: "other@example.test" }), input({ to: "business@example.test\r\nBcc: other@example.test" }), input({ subject: "Hello\nBcc: other@example.test" }), input({ approvalId: "approval\r\nHeader:value" }), input({ unsubscribeUrl: "https://jarvis.example.test/\r\nFake:x" })]) await expect(gmail.send(mail)).rejects.toBeInstanceOf(AcquisitionMailError);
    expect(request).not.toHaveBeenCalled();
  });
  it("bounds the unsubscribe header and rejects whitespace or control characters", async () => {
    const { gmail, request, link } = gmailSetup(); await link(); request.mockClear();
    for (const unsubscribeUrl of ["https://jarvis.example.test/" + "x".repeat(901), "https://jarvis.example.test/unsubscribe/fi\txture", "https://jarvis.example.test/unsubscribe/fictional token"]) await expect(gmail.send(input({ unsubscribeUrl }))).rejects.toMatchObject({ code: "invalid_request" });
    expect(request).not.toHaveBeenCalled();
  });
  it("sends bounded UTF-8 MIME only once and returns the actual provider message ID", async () => {
    const { gmail, request, link } = gmailSetup(); await link();
    const mail = input({ subject: "A café concept — fictional", text: "G’day.\nA café concept in a fictional test." });
    const accepted = await gmail.send(mail);
    expect(accepted).toEqual({ providerRef: "fictional_message_123456", acceptedAt: expect.any(String) });
    expect(await gmail.send(mail)).toEqual(accepted);
    expect(sendRequests(request)).toHaveLength(1);
    const [, init] = sendRequests(request)[0]!; const body = JSON.parse(String(init?.body));
    const mime = Buffer.from(body.raw, "base64url").toString("utf8");
    expect(mime).toContain(`From: ${from}\r\nTo: business@example.test\r\n`);
    expect(mime).toContain("Subject: =?UTF-8?B?"); expect(mime).toContain(`List-Unsubscribe: <${mail.unsubscribeUrl}>`);
    expect(mime).not.toContain(clientSecret); expect(mime).not.toContain(refreshSecret);
    expect(Buffer.from(mime.split("\r\n\r\n")[1]!.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("G’day.\r\nA café concept in a fictional test.");
    expect(init?.redirect).toBe("error"); expect(init?.signal).toBeInstanceOf(AbortSignal);
    for (const [url] of request.mock.calls) { expect(String(url)).not.toContain(clientSecret); expect(String(url)).not.toContain(refreshSecret); }
    await expect(gmail.send({ ...mail, subject: "Changed payload" })).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("keeps accepted idempotency results after restart without sending again", async () => {
    const { gmail, config, request, link } = gmailSetup(); await link();
    const result = await gmail.send(input());
    expect(await new GmailAcquisitionMailTransport(config).send(input())).toEqual(result);
    expect(sendRequests(request)).toHaveLength(1);
  });
  it("never claims acceptance when Google supplies no ID and does not retry ambiguity", async () => {
    const network = gmailSetup(); const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => String(url).endsWith("/messages/send") ? Response.json({}) : network.request(url, init));
    const { gmail, link } = gmailSetup({ request }); await link();
    await expect(gmail.send(input())).rejects.toMatchObject({ code: "uncertain" });
    await expect(gmail.send(input())).rejects.toMatchObject({ code: "uncertain" });
    expect(sendRequests(request)).toHaveLength(1);
  });
  it("does not restore a cancelled link when a delayed callback returns", async () => {
    let completeIdentity: ((response: Response) => void) | undefined;
    const request = vi.fn(async (url: string | URL | Request) => String(url).includes("/token")
      ? Response.json({ access_token: accessSecret, refresh_token: refreshSecret, expires_in: 3600, scope })
      : await new Promise<Response>(resolve => { completeIdentity = resolve; }));
    const { gmail, db } = gmailSetup({ request }); const state = new URL(gmail.startLink().url).searchParams.get("state")!;
    const completion = gmail.completeLink("fictional-code", state);
    await vi.waitFor(() => expect(completeIdentity).toBeTypeOf("function"));
    gmail.disconnect(); completeIdentity!(Response.json({ email: from, email_verified: true }));
    await expect(completion).rejects.toMatchObject({ code: "oauth_state" });
    expect(db.listDocs("acquisition_google_oauth_link")).toHaveLength(0);
  });
  it("stops a pending send if the owner disconnects before submission", async () => {
    const { gmail, request, link } = gmailSetup(); await link(); request.mockClear();
    const pending = gmail.send(input()); gmail.disconnect();
    await expect(pending).rejects.toBeInstanceOf(AcquisitionMailError);
    expect(request).not.toHaveBeenCalled();
  });
  it("times out a Gmail submission once without retries", async () => {
    const base = gmailSetup();
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => String(url).endsWith("/messages/send") ? await new Promise<Response>(() => {}) : base.request(url, init));
    const { gmail, link } = gmailSetup({ request, timeoutMs: 10 }); await link();
    await expect(gmail.send(input())).rejects.toMatchObject({ code: "uncertain" });
    await expect(gmail.send(input())).rejects.toMatchObject({ code: "uncertain" });
    expect(sendRequests(request)).toHaveLength(1);
  });
  it("disconnects locally and cancels unused callback states without provider calls", async () => {
    const { gmail, request, db, link } = gmailSetup(); await link(); const state = new URL(gmail.startLink().url).searchParams.get("state")!;
    request.mockClear(); gmail.disconnect();
    expect(db.listDocs("acquisition_google_oauth_link")).toHaveLength(0);
    expect(await gmail.status()).toMatchObject({ state: "not_connected" });
    await expect(gmail.completeLink("fictional-code", state)).rejects.toMatchObject({ code: "oauth_state" });
    await expect(gmail.send(input())).rejects.toMatchObject({ code: "not_configured" }); expect(request).not.toHaveBeenCalled();
  });
});

describe("Resend HTTPS acquisition mail", () => {
  function setup(override?: typeof fetch, timeoutMs?: number) {
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => init?.method === "POST" ? Response.json({ id: "fictional_resend_id_123" }) : Response.json({ data: [{ name: "example.test", status: "verified" }] }));
    const transport = new ResendAcquisitionMailTransport({ apiKey: "fictional-resend-key", fromAddress: from, store: store(), request: override ?? request as unknown as typeof fetch, timeoutMs });
    return { transport, request };
  }
  it("does no network on missing config and requires the exact verified domain and sender", async () => {
    const request = vi.fn(); const missing = new ResendAcquisitionMailTransport({ request });
    expect(await missing.status()).toMatchObject({ state: "not_connected" }); await expect(missing.send(input())).rejects.toMatchObject({ code: "not_configured" }); expect(request).not.toHaveBeenCalled();
    const { transport, request: connected } = setup(); await expect(transport.send(input({ from: "other@example.test" }))).rejects.toMatchObject({ code: "sender_mismatch" }); expect(connected).not.toHaveBeenCalled();
    const wrongDomain = setup(vi.fn(async () => Response.json({ data: [{ name: "unrelated.example.test", status: "verified" }] })));
    expect((await wrongDomain.transport.status()).state).toBe("not_connected");
    await expect(wrongDomain.transport.send(input())).rejects.toMatchObject({ code: "unavailable" });
  });
  it("uses read-only domain verification and a fixed idempotency key before recording acceptance", async () => {
    const { transport, request } = setup();
    expect(await transport.status()).toMatchObject({ state: "connected", sender: from }); expect(await transport.status()).toMatchObject({ state: "connected" });
    expect(request).toHaveBeenCalledTimes(1);
    const result = await transport.send(input()); expect(result.providerRef).toBe("fictional_resend_id_123"); expect(await transport.send(input())).toEqual(result);
    expect(request).toHaveBeenCalledTimes(2);
    const [url, init] = request.mock.calls[1]!; expect(url).toBe("https://api.resend.com/emails");
    expect(init?.headers).toMatchObject({ "Idempotency-Key": input().idempotencyKey }); expect(init?.redirect).toBe("error");
    await expect(transport.send(input({ text: "Changed" }))).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("rejects oversized responses and strips sensitive provider errors from status", async () => {
    for (const response of [() => new Response("x", { headers: { "content-length": "99999999" } }), () => new Response("fictional-resend-key-secret", { status: 401 }), () => new Response("not-json")]) {
      const { transport } = setup(vi.fn(async () => response()));
      const status = await transport.status(); expect(status.state).toBe("error"); expect(JSON.stringify(status)).not.toContain("fictional-resend-key-secret");
    }
  });
  it("times out once and never resubmits a lost or ambiguous provider response", async () => {
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => init?.method === "POST" ? await new Promise<Response>(() => {}) : Response.json({ data: [{ name: "example.test", status: "verified" }] }));
    const { transport } = setup(request, 10);
    await expect(transport.send(input())).rejects.toMatchObject({ code: "uncertain" });
    await expect(transport.send(input())).rejects.toMatchObject({ code: "uncertain" });
    expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
});


describe("explicit sending connection selection", () => {
  function transport(name: string, connected = true) {
    return {
      status: vi.fn(async () => ({ state: connected ? "connected" as const : "not_connected" as const, provider: name, detail: `${name} fictional connection`, ...(connected ? { sender: from } : {}) })),
      send: vi.fn(async () => ({ providerRef: `fictional_${name}_123456`, acceptedAt: "2026-10-26T00:00:00.000Z" })),
    };
  }
  it("uses the explicit default, persists owner selection and never contacts unselected providers", async () => {
    const db = store(), gmail = transport("gmail"), resend = transport("resend");
    const router = new SelectableAcquisitionMailTransport({ store: db, transports: { gmail, resend }, defaultProvider: "resend" });
    expect(router.selected()).toBe("resend");
    expect(await router.status()).toMatchObject({ state: "connected", provider: "resend" });
    await router.send(input()); expect(resend.send).toHaveBeenCalledOnce(); expect(gmail.status).not.toHaveBeenCalled(); expect(gmail.send).not.toHaveBeenCalled();
    router.select("gmail");
    const restarted = new SelectableAcquisitionMailTransport({ store: db, transports: { gmail, resend }, defaultProvider: "resend" });
    expect(restarted.selected()).toBe("gmail"); await restarted.send(input({ idempotencyKey: "acquisition:fixture:2" })); expect(gmail.send).toHaveBeenCalledOnce();
    expect(JSON.stringify(db.getMemory("acquisition.mail.provider"))).toBe('"gmail"');
  });
  it("never falls back from an unavailable selected connection to another working sender", async () => {
    const gmail = transport("gmail", false), resend = transport("resend");
    gmail.send.mockRejectedValue(new AcquisitionMailError("not_configured", "Fictional Gmail missing"));
    const router = new SelectableAcquisitionMailTransport({ store: store(), transports: { gmail, resend }, defaultProvider: "gmail" });
    expect(await router.status()).toMatchObject({ state: "not_connected", provider: "gmail" });
    await expect(router.send(input())).rejects.toMatchObject({ code: "not_configured" });
    expect(resend.status).not.toHaveBeenCalled(); expect(resend.send).not.toHaveBeenCalled();
  });
  it("fails closed on an invalid configured or saved provider and accepts only two supported selections", async () => {
    const db = store(), gmail = transport("gmail"), resend = transport("resend");
    const router = new SelectableAcquisitionMailTransport({ store: db, transports: { gmail, resend }, defaultProvider: "smtp" });
    expect(router.selected()).toBeNull(); expect(await router.status()).toMatchObject({ state: "error" });
    await expect(router.send(input())).rejects.toMatchObject({ code: "not_configured" });
    for (const bad of [undefined, "smtp", "https://attacker.example.test", {}, "resend\n"]) expect(() => router.select(bad)).toThrow(AcquisitionMailError);
    expect(gmail.status).not.toHaveBeenCalled(); expect(resend.status).not.toHaveBeenCalled();
    router.select("resend"); expect(router.selected()).toBe("resend");
    db.setMemory("acquisition.mail.provider", { injected: "gmail" }); expect(router.selected()).toBeNull();
  });
  it("lists both connection statuses and setup steps without sending email", async () => {
    const gmail = transport("gmail", false), resend = transport("resend");
    const router = new SelectableAcquisitionMailTransport({ store: store(), transports: { gmail, resend }, defaultProvider: "resend" });
    const catalogue = await router.providers();
    expect(catalogue.selected).toBe("resend"); expect(catalogue.providers).toHaveLength(2);
    expect(catalogue.providers.find(provider => provider.id === "resend")).toMatchObject({ selected: true, status: { state: "connected" }, requiredSettings: ["RESEND_API_KEY", "ATLAS_OUTREACH_FROM"] });
    expect(catalogue.providers.find(provider => provider.id === "resend")!.description).toMatch(/Microsoft 365/);
    expect(gmail.send).not.toHaveBeenCalled(); expect(resend.send).not.toHaveBeenCalled();
  });
  it("locks connection selection throughout provider verification and submission", async () => {
    let finish: ((value: { providerRef: string; acceptedAt: string }) => void) | undefined;
    const gmail: AcquisitionMailTransport = { status: async () => ({ state: "connected", provider: "gmail", detail: "fictional" }), send: () => new Promise(resolve => { finish = resolve; }) };
    const resend = transport("resend");
    const router = new SelectableAcquisitionMailTransport({ store: store(), transports: { gmail, resend } });
    const pending = router.send(input());
    expect(() => router.select("resend")).toThrow(/submission is in progress/);
    finish!({ providerRef: "fictional_gmail_123456", acceptedAt: "2026-10-26T00:00:00.000Z" }); await pending;
    expect(router.select("resend")).toBe("resend"); expect(resend.send).not.toHaveBeenCalled();
  });
  it("discards a status check made stale by an owner connection change", async () => {
    let finish: ((value: { state: "connected"; provider: string; detail: string; sender: string }) => void) | undefined;
    const gmail: AcquisitionMailTransport = { status: () => new Promise(resolve => { finish = resolve; }), send: vi.fn() };
    const resend = transport("resend");
    const router = new SelectableAcquisitionMailTransport({ store: store(), transports: { gmail, resend } });
    const pending = router.status(); router.select("resend");
    finish!({ state: "connected", provider: "gmail", detail: "fictional", sender: from });
    expect(await pending).toMatchObject({ state: "error", detail: expect.stringContaining("changed during verification") });
  });
});

describe("owner update mail purpose", () => {
  it("omits marketing unsubscribe headers for owner-only Gmail updates and binds the purpose", async () => {
    const { gmail, request, link } = gmailSetup(); await link();
    const update = input({ to: from, purpose: "owner_update", unsubscribeUrl: origin + "/#updates" });
    // Fragment-free management URLs use the same bounded HTTPS validation as outreach.
    await expect(gmail.send(update)).rejects.toMatchObject({ code: "invalid_request" });
    const valid = { ...update, unsubscribeUrl: origin + "/?settings=updates" };
    await gmail.send(valid);
    const [, init] = sendRequests(request)[0]!;
    const mime = Buffer.from(JSON.parse(String(init?.body)).raw, "base64url").toString("utf8");
    expect(mime).not.toContain("List-Unsubscribe");
    await expect(gmail.send({ ...valid, purpose: "outreach" })).rejects.toMatchObject({ code: "invalid_request" });
    expect(sendRequests(request)).toHaveLength(1);
  });
  it("omits marketing unsubscribe headers for Resend owner updates and preserves them for outreach", async () => {
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => init?.method === "POST" ? Response.json({ id: "fictional_resend_owner_123" }) : Response.json({ data: [{ name: "EXAMPLE.TEST", status: "verified" }] }));
    const mail = new ResendAcquisitionMailTransport({ apiKey: "fictional-resend-key", fromAddress: from, store: store(), request });
    await mail.send(input({ to: from, purpose: "owner_update", unsubscribeUrl: origin + "/?settings=updates" }));
    const first = JSON.parse(String(request.mock.calls.find(([, init]) => init?.method === "POST")![1]?.body));
    expect(first.headers).toEqual({});
    await mail.send(input({ idempotencyKey: "acquisition:fixture:outreach" }));
    const posts = request.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(posts[1]![1]?.body)).headers).toMatchObject({ "List-Unsubscribe": `<${input().unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  });
});

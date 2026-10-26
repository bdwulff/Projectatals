import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { buildRuntime, type Runtime } from "./runtime.js";

const origin = "https://jarvis.example.test", accessKey = "fictional-voice-owner-key-".repeat(3), readToken = "fictional-briefing-token-".repeat(3);
const runtimes: Runtime[] = [];
async function setup() {
  const rt = buildRuntime({ ATLAS_MODE: "fake", ATLAS_PUBLIC_ORIGIN: origin }); runtimes.push(rt);
  const app = createApp(rt, { publicOrigin: origin, ownerAccessKey: accessKey, briefingReadToken: readToken });
  const response = await app.request(origin + "/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ accessKey }) });
  const cookie = /__Host-atlas_session=[a-f0-9]{64}/.exec(response.headers.get("set-cookie") ?? "")![0];
  const post = (path: string, body: unknown) => app.request(origin + path, { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { rt, app, cookie, post };
}
afterEach(() => { for (const rt of runtimes.splice(0)) rt.atlas.deps.store.close(); vi.unstubAllGlobals(); });
describe("authenticated voice conversation integration", () => {
  it("accepts a greeting and current queue question through the real command endpoint without sending or publishing", async () => {
    const { rt, post } = await setup();
    const request = vi.fn().mockRejectedValue(new Error("No external request expected")); vi.stubGlobal("fetch", request);
    const greeting = await (await post("/api/command", { text: "Hi Jarvis" })).json();
    expect(greeting.intent.kind).toBe("conversation.greeting"); expect(greeting.reply).toContain("Brandon");
    const queue = await (await post("/api/command", { text: "How many website concepts are ready?" })).json();
    expect(queue.intent.kind).toBe("conversation.queue"); expect(queue.reply).toContain("0 website concepts"); expect(queue.reply).toContain("fictional");
    const unclear = await (await post("/api/command", { text: "Do the thing we discussed" })).json();
    expect(unclear.outcome).toBe("unknown"); expect(unclear.reply).toContain("specific request");
    expect(rt.fakes.mailer.sent).toHaveLength(0); expect(rt.atlas.approvals.list()).toHaveLength(0); expect(request).not.toHaveBeenCalled();
  });
  it("protects microphone input status and upload with owner auth, origin and read-token scope", async () => {
    const { app, cookie } = await setup();
    expect((await app.request(origin + "/api/voice/input-status")).status).toBe(401);
    expect((await app.request(origin + "/api/voice/input-status", { headers: { Authorization: `Bearer ${readToken}` } })).status).toBe(401);
    expect((await app.request(origin + "/api/voice/transcribe", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await app.request(origin + "/api/voice/transcribe", { method: "POST", headers: { Cookie: cookie, Origin: "https://untrusted.example.test", "Content-Type": "application/json" }, body: "{}" })).status).toBe(403);
    const status = await (await app.request(origin + "/api/voice/input-status", { headers: { Cookie: cookie } })).json();
    expect(status.enabled).toBe(false); expect(status.audioUploadedByStatusCheck).toBe(false);
  });
  it("normalises polite spoken reads while keeping negations and approval explanations away from operational handlers", async () => {
    const { rt, post } = await setup();
    const before = rt.atlas.approvals.list();
    for (const text of ["Jarvis, please don't approve that quote", "No, don't send any emails", "How do I approve a quote?", "Can you not publish those websites?"]) {
      const result = await (await post("/api/command", { text })).json();
      expect(result.intent.kind).toBe("conversation.safety");
    }
    const count = await (await post("/api/command", { text: "Could you please tell me how many website concepts are ready?" })).json();
    expect(count.intent.kind).toBe("conversation.queue");
    const emailRequest = await (await post("/api/command", { text: "Can you please send emails to those companies?" })).json();
    expect(emailRequest.intent.kind).toBe("conversation.safety");
    expect(rt.atlas.approvals.list()).toEqual(before); expect(rt.fakes.mailer.sent).toHaveLength(0);
  });
  it("keeps larger audio JSON scoped to the recording endpoint while normal commands remain bounded", async () => {
    const { post } = await setup();
    expect((await post("/api/command", { text: "a".repeat(70_000) })).status).toBe(413);
    expect((await post("/api/voice/transcribe", { audioBase64: "a".repeat(70_000) })).status).not.toBe(413);
    expect((await post("/api/voice/transcribe", { audioBase64: "a".repeat(1600 * 1024) })).status).toBe(413);
  });
});

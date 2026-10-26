import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { buildRuntime, type Runtime } from "./runtime.js";

const origin = "https://jarvis.example.test", key = "fictional-sites-owner-key-".repeat(3), briefingToken = "fictional-sites-briefing-token-".repeat(3);
const runtimes: Runtime[] = [];
async function setup() {
  const rt = buildRuntime({ ATLAS_MODE: "fake", ATLAS_PUBLIC_ORIGIN: origin }); runtimes.push(rt);
  const app = createApp(rt, { publicOrigin: origin, ownerAccessKey: key, briefingReadToken: briefingToken });
  const response = await app.request(origin + "/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ accessKey: key }) });
  const cookie = /__Host-atlas_session=[a-f0-9]{64}/.exec(response.headers.get("set-cookie") ?? "")![0];
  const get = (path: string) => app.request(origin + path, { headers: { Cookie: cookie } });
  const post = (path: string, value: unknown) => app.request(origin + path, { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(value) });
  return { rt, app, cookie, get, post };
}
afterEach(() => { for (const rt of runtimes.splice(0)) rt.atlas.deps.store.close(); vi.unstubAllGlobals(); });
describe("private email and website connection entry points", () => {
  it("requires the owner session and same origin for website credentials and site configuration", async () => {
    const s = await setup();
    expect((await s.app.request(origin + "/api/websites")).status).toBe(401);
    expect((await s.app.request(origin + "/api/websites", { headers: { Authorization: `Bearer ${briefingToken}` } })).status).toBe(401);
    expect((await s.app.request(origin + "/api/websites/lovable/connect", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: "fictional-only-key" }) })).status).toBe(401);
    expect((await s.app.request(origin + "/api/websites/sites", { method: "POST", headers: { Cookie: s.cookie, Origin: "https://untrusted.example.test", "Content-Type": "application/json" }, body: JSON.stringify({ name: "Fictional site", url: "https://fictional.example.test/" }) })).status).toBe(403);
  });
  it("lists independent email and website state without contacting a provider or changing accounts", async () => {
    const s = await setup(); const request = vi.fn().mockRejectedValue(new Error("No provider network request expected")); vi.stubGlobal("fetch", request);
    const sites = await s.get("/api/websites"); expect(sites.status).toBe(200);
    const snapshot = await sites.json(); expect(snapshot.mode).toBe("fake"); expect(snapshot.sites).toHaveLength(0);
    const mail = await s.get("/api/acquisition/mail/providers"); expect(mail.status).toBe(200);
    expect((await mail.json()).providers.map((p: any) => p.id)).toContain("resend");
    expect(s.rt.fakes.mailer.sent).toHaveLength(0); expect(request).not.toHaveBeenCalled();
  });
  it("answers owned website questions from the private registry rather than treating those sites as acquisition prospects", async () => {
    const s = await setup();
    expect((await s.post("/api/websites/sites", { name: "Owner Workshop (fictional)", url: "https://workshop.example.test/" })).status).toBe(200);
    const result = await (await s.post("/api/command", { text: "Which websites are linked?" })).json();
    expect(result.intent.kind).toBe("conversation.websites"); expect(result.reply).toContain("Owner Workshop (fictional)"); expect(result.reply).toContain("fictional");
    expect(s.rt.atlas.prospects.list()).toHaveLength(0); expect(s.rt.fakes.mailer.sent).toHaveLength(0);
    const status = await (await s.get("/api/status")).json(); expect(status.connections.find((c: any) => c.name === "Lovable project reading").state).toBe("fake");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { buildRuntime } from "./runtime.js";

const origin = "https://jarvis.example.test";
const key = "owner_access_key_for_tests_01234567890123456789";
describe("private Mac pairing and remote tasks", () => {
  let app: ReturnType<typeof createApp>;
  let cookie: string;
  beforeEach(async () => {
    app = createApp(buildRuntime({ ATLAS_MODE: "live" }), { ownerAccessKey: key, publicOrigin: origin });
    const response = await app.request(origin + "/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ accessKey: key }) });
    cookie = /__Host-atlas_session=[a-f0-9]{64}/.exec(response.headers.get("set-cookie") ?? "")![0];
  });
  const owner = (cookie: string) => ({ Origin: origin, "Content-Type": "application/json", Cookie: cookie });
  async function pair(actions = ["device.status", "browser.open"]) {
    const response = await app.request(origin + "/api/devices/pairing", { method: "POST", headers: owner(cookie), body: JSON.stringify({ deviceName: "Brandon's Mac", allowedActions: actions }) });
    expect(response.status).toBe(200);
    const pending = await response.json();
    const claim = await app.request(origin + "/device-api/v1/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pairCode: pending.pairCode, deviceName: "Mac" }) });
    expect(claim.status).toBe(200);
    return { pending, device: await claim.json() };
  }
  it("requires owner auth for pairing, downloads and commands; device credentials never grant owner access", async () => {
    for (const path of ["/api/devices", "/api/devices/mac-companion"]) expect((await app.request(origin + path)).status).toBe(401);
    const { device } = await pair();
    expect((await app.request(origin + "/api/devices", { headers: { Authorization: `Bearer ${device.deviceToken}` } })).status).toBe(401);
    expect((await app.request(origin + "/device-api/v1/tasks", { headers: { Cookie: cookie } })).status).toBe(401);
  });
  it("uses one-use pairing codes and omits device secrets from owner data", async () => {
    const { pending, device } = await pair();
    const replay = await app.request(origin + "/device-api/v1/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pairCode: pending.pairCode, deviceName: "other" }) });
    expect(replay.status).toBe(401);
    const list = await app.request(origin + "/api/devices", { headers: owner(cookie) });
    const body = await list.text();
    expect(body).not.toContain(device.deviceToken);
    expect(body).not.toContain("tokenHash");
    expect(body).not.toContain(pending.pairCode);
  });
  it("idempotently publishes authorised tasks through the job queue and leases each task once", async () => {
    const { device } = await pair();
    const request = { action: "browser.open", payload: { url: "https://example.com" }, requestId: "same-owner-action-1" };
    const create = () => app.request(origin + `/api/devices/${device.deviceId}/tasks`, { method: "POST", headers: owner(cookie), body: JSON.stringify(request) });
    const first = await create(); expect(first.status).toBe(201);
    const task = (await first.json()).task;
    const second = await create(); expect(second.status).toBe(200);
    expect((await second.json()).task.id).toBe(task.id);
    const auth = { Authorization: `Bearer ${device.deviceToken}` };
    const lease = await app.request(origin + "/device-api/v1/tasks", { headers: auth });
    expect((await lease.json()).tasks).toHaveLength(1);
    const repeat = await app.request(origin + "/device-api/v1/tasks", { headers: auth });
    expect((await repeat.json()).tasks).toHaveLength(0);
    const result = await app.request(origin + `/device-api/v1/tasks/${task.id}/result`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ status: "completed", result: { acceptedByOS: true, completionConfirmed: false, outcome: "attempted" } }) });
    expect(await result.json()).toEqual({ ok: true });
  });
  it("rejects widened scopes, changed idempotency payloads and browser-origin claims", async () => {
    const { device } = await pair(["device.status"]);
    const send = (action: string, payload: unknown, requestId = "same-request") => app.request(origin + `/api/devices/${device.deviceId}/tasks`, { method: "POST", headers: owner(cookie), body: JSON.stringify({ action, payload, requestId }) });
    expect((await send("browser.open", { url: "https://example.com" })).status).toBe(403);
    expect((await send("shell.exec", { command: "rm" })).status).toBe(400);
    const pairResponse = await app.request(origin + "/device-api/v1/claim", { method: "POST", headers: owner(cookie), body: JSON.stringify({ pairCode: "invalid", deviceName: "Mac" }) });
    expect(pairResponse.status).toBe(403);
    const other = await pair(["browser.open"]);
    const url = origin + `/api/devices/${other.device.deviceId}/tasks`;
    const request = { action: "browser.open", payload: { url: "https://example.com" }, requestId: "immutable-1" };
    expect((await app.request(url, { method: "POST", headers: owner(cookie), body: JSON.stringify(request) })).status).toBe(201);
    request.payload.url = "https://different.example.com";
    expect((await app.request(url, { method: "POST", headers: owner(cookie), body: JSON.stringify(request) })).status).toBe(409);
  });
  it("turns an explicit owner voice/text command into a scoped Mac request", async () => {
    const { device } = await pair(["browser.open"]);
    const response = await app.request(origin + "/api/command", { method: "POST", headers: owner(cookie), body: JSON.stringify({ text: "Jarvis, open https://example.com" }) });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.outcome).toBe("attempted");
    expect(result.reply).toContain("queued");
    const pending = await app.request(origin + "/device-api/v1/tasks", { headers: { Authorization: `Bearer ${device.deviceToken}` } });
    expect((await pending.json()).tasks[0].action).toBe("browser.open");
  });
  it("refuses private and non-web targets before queueing them", async () => {
    const { device } = await pair(["browser.open"]);
    for (const url of ["javascript:alert(1)", "http://127.0.0.1", "https://example.com:8080", "file:///etc/passwd"]) {
      const result = await app.request(origin + `/api/devices/${device.deviceId}/tasks`, { method: "POST", headers: owner(cookie), body: JSON.stringify({ action: "browser.open", payload: { url }, requestId: "bad-" + url }) });
      expect(result.status).toBe(400);
    }
  });
  it("revokes a device and prevents further poll or dispatch", async () => {
    const { device } = await pair();
    expect((await app.request(origin + `/api/devices/${device.deviceId}`, { method: "DELETE", headers: owner(cookie), body: "{}" })).status).toBe(200);
    expect((await app.request(origin + "/device-api/v1/tasks", { headers: { Authorization: `Bearer ${device.deviceToken}` } })).status).toBe(401);
  });
});

import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";
import { buildRuntime } from "./runtime.js";

describe("API", () => {
  it("serves status, seeds the fictional scenario, and decides an approval", async () => {
    const rt = buildRuntime({ ATLAS_MODE: "fake" });
    const app = createApp(rt);
    const status = await (await app.request("/api/status")).json();
    expect(status.atlas.mode).toBe("fake");
    expect(status.connections.every((c: { state: string }) => c.state === "fake")).toBe(true);
    const seed = await (await app.request("/api/dev/seed", { method: "POST" })).json();
    expect(seed.prospects).toBe(5);
    expect(seed.approvals).toBe(1);
    const approvals = await (await app.request("/api/approvals")).json();
    const id = approvals[0].id;
    const decided = await (await app.request(`/api/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ decision: "approve" }), headers: { "content-type": "application/json" } })).json();
    expect(decided.ok).toBe(true);
    expect(decided.quote.status).toBe("sent");
    const outbox = await (await app.request("/api/dev/outbox")).json();
    expect(outbox.emails).toHaveLength(1);
    const cmd = await (await app.request("/api/command", { method: "POST", body: JSON.stringify({ text: "give me my morning briefing" }), headers: { "content-type": "application/json" } })).json();
    expect(cmd.reply).toMatch(/Good (morning|afternoon|evening)/);
    const finance = await (await app.request("/api/finance")).json();
    expect(finance.wulffStudio.verifiedCollectedAud).toBe(0);
    expect(finance.boxsafe.mode).toBe("fake");
  });
});

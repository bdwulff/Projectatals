import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackgroundWorker, melbourneResearchDay, startBackgroundWorker } from "./background.js";
import { buildRuntime, type Runtime } from "./runtime.js";

const enabled = { ATLAS_MODE: "live", ATLAS_RESEARCH_ENABLED: "true", BRAVE_SEARCH_API_KEY: "test-only-not-a-real-key", ATLAS_RESEARCH_AREA: "Berwick, Victoria", ATLAS_RESEARCH_COUNT: "5" };
const created: Runtime[] = [];
function runtime(dbPath?: string) {
  // Fake business adapters and an injected read source ensure tests make no external calls.
  const rt = buildRuntime({ ATLAS_MODE: "fake", ATLAS_DB_PATH: dbPath });
  rt.mode = "live";
  rt.atlas.deps.research = { find: vi.fn().mockResolvedValue([]) };
  vi.spyOn(rt.atlas, "runScheduledChecks").mockResolvedValue({ ran: [], notifications: 0 });
  created.push(rt);
  return rt;
}
afterEach(() => { for (const rt of created.splice(0)) rt.atlas.deps.store.close(); vi.useRealTimers(); });

describe("background research", () => {
  it("uses Melbourne day boundaries across daylight saving", () => {
    expect(melbourneResearchDay(new Date("2026-10-25T12:59:59Z"))).toBe("2026-10-25");
    expect(melbourneResearchDay(new Date("2026-10-25T13:00:00Z"))).toBe("2026-10-26");
    expect(melbourneResearchDay(new Date("2026-07-25T14:00:00Z"))).toBe("2026-07-26");
  });

  it.each([
    { ...enabled, ATLAS_RESEARCH_ENABLED: "false" },
    { ...enabled, ATLAS_MODE: "fake" },
    { ...enabled, BRAVE_SEARCH_API_KEY: "" },
    { ...enabled, ATLAS_MODE: "mixed" },
  ])("does no automatic search when an explicit gate is missing: %j", async (env) => {
    const rt = runtime();
    const worker = createBackgroundWorker(rt, env);
    const run = await worker.tick();
    expect(rt.atlas.deps.research.find).not.toHaveBeenCalled();
    expect(rt.atlas.jobs.list()).toHaveLength(0);
    expect(["blocked", "skipped"]).toContain(run.research.state);
    expect(rt.atlas.runScheduledChecks).toHaveBeenCalledOnce();
  });

  it("also refuses an actual fake runtime despite live environment flags", async () => {
    const rt = runtime();
    rt.mode = "fake";
    await createBackgroundWorker(rt, enabled).tick();
    expect(rt.atlas.deps.research.find).not.toHaveBeenCalled();
  });

  it("runs once per Melbourne day and scope, without creating quotes or contacting customers", async () => {
    const rt = runtime();
    let now = new Date("2026-10-25T13:00:00Z");
    const worker = createBackgroundWorker(rt, enabled, { clock: () => now });
    expect((await worker.tick()).research.state).toBe("completed");
    expect((await worker.tick()).research.state).toBe("already_ran");
    expect(rt.atlas.deps.research.find).toHaveBeenCalledTimes(1);
    expect(rt.atlas.jobs.list()[0]).toMatchObject({ type: "research_prospects", attempts: 1, maxAttempts: 1, status: "succeeded" });
    expect(rt.atlas.jobs.list()[0]?.idempotencyKey).toMatch(/^research_prospects:2026-10-26:[a-f0-9]{24}$/);
    expect(rt.atlas.quotes.list()).toHaveLength(0);
    expect(rt.fakes.mailer.sent).toHaveLength(0);
    now = new Date("2026-10-26T13:00:00Z");
    await worker.tick();
    expect(rt.atlas.deps.research.find).toHaveBeenCalledTimes(2);
    expect(rt.atlas.deps.store.getMemory("background.lastRun")).toMatchObject({ state: "completed", day: "2026-10-27" });
  });

  it("retains the unique daily key after process restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "atlas-worker-"));
    try {
      const db = join(directory, "atlas.sqlite");
      const clock = () => new Date("2026-10-25T13:00:00Z");
      const first = runtime(db);
      await createBackgroundWorker(first, enabled, { clock }).tick();
      first.atlas.deps.store.close();
      created.splice(created.indexOf(first), 1);
      const second = runtime(db);
      expect((await createBackgroundWorker(second, enabled, { clock }).tick()).research.state).toBe("already_ran");
      expect(second.atlas.deps.research.find).not.toHaveBeenCalled();
      second.atlas.deps.store.close();
      created.splice(created.indexOf(second), 1);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("does not let failed BoxSafe or other scheduled checks block research", async () => {
    const rt = runtime();
    vi.mocked(rt.atlas.runScheduledChecks).mockRejectedValue(new Error("provider leaked secret-not-for-memory"));
    const run = await createBackgroundWorker(rt, enabled).tick();
    expect(run.checks.state).toBe("failed");
    expect(run.research.state).toBe("completed");
    expect(rt.atlas.deps.research.find).toHaveBeenCalledOnce();
    expect(JSON.stringify(rt.atlas.deps.store.getMemory("background.lastRun"))).not.toContain("secret-not-for-memory");
  });

  it("records errors safely and never retries a failed provider call automatically", async () => {
    const rt = runtime();
    vi.mocked(rt.atlas.deps.research.find).mockRejectedValue(new Error("private-provider-token"));
    const worker = createBackgroundWorker(rt, enabled);
    expect((await worker.tick()).research.state).toBe("failed");
    expect((await worker.tick()).research.state).toBe("failed");
    expect(rt.atlas.deps.research.find).toHaveBeenCalledOnce();
    expect(rt.atlas.jobs.list()[0]).toMatchObject({ status: "dead", attempts: 1 });
    expect(JSON.stringify(rt.atlas.deps.store.getMemory("background.research.lastRun"))).not.toContain("private-provider-token");
    expect(JSON.stringify(rt.atlas.jobs.list())).not.toContain("private-provider-token");
    expect(rt.atlas.notifications.list().filter((n) => n.title === "Daily business research needs attention")).toHaveLength(1);
  });

  it("prevents overlapping ticks, including a second worker over the same Atlas", async () => {
    const rt = runtime();
    let release!: () => void;
    vi.mocked(rt.atlas.runScheduledChecks).mockImplementation(() => new Promise((resolve) => { release = () => resolve({ ran: [], notifications: 0 }); }));
    const worker = createBackgroundWorker(rt, enabled);
    const running = worker.tick();
    expect((await worker.tick()).state).toBe("skipped");
    expect((await createBackgroundWorker(rt, enabled).tick()).state).toBe("skipped");
    release();
    await running;
    expect(rt.atlas.deps.research.find).toHaveBeenCalledOnce();
  });

  it("caps scope and scheduling inputs and counts no-result discovery honestly", async () => {
    const rt = runtime();
    const worker = createBackgroundWorker(rt, { ...enabled, ATLAS_RESEARCH_COUNT: "999", ATLAS_CHECK_INTERVAL_MS: "1" });
    expect(worker.intervalMs).toBe(60_000);
    await worker.tick();
    expect(rt.atlas.deps.research.find).toHaveBeenCalledWith({ area: "Berwick, Victoria", count: 10 });
    expect(rt.atlas.deps.store.getMemory("background.research.lastRun")).toMatchObject({ state: "completed", candidateCount: 0, qualifiedCount: 0 });
    expect(rt.atlas.notifications.list().some((n) => n.title.includes("no candidates"))).toBe(true);
    expect(createBackgroundWorker(rt, { ATLAS_CHECK_INTERVAL_MS: "invalid" }).intervalMs).toBe(300_000);
    expect(createBackgroundWorker(rt, { ATLAS_CHECK_INTERVAL_MS: "999999999999" }).intervalMs).toBe(86_400_000);
  });

  it("starts once immediately, uses the safe interval and can stop the timer", async () => {
    vi.useFakeTimers();
    const rt = runtime();
    const worker = startBackgroundWorker(rt, { ...enabled, ATLAS_CHECK_INTERVAL_MS: "1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(rt.atlas.runScheduledChecks).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rt.atlas.runScheduledChecks).toHaveBeenCalledTimes(2);
    worker.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rt.atlas.runScheduledChecks).toHaveBeenCalledTimes(2);
    expect(rt.atlas.deps.research.find).toHaveBeenCalledOnce();
  });
});

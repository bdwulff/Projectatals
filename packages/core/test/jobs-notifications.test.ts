import { describe, it, expect } from "vitest";
import { SqliteStore, AuditLog, JobQueue, NotificationService } from "../src/index.js";
import { FakePushNotifier } from "../src/adapters/fake/index.js";

describe("JobQueue", () => {
  it("deduplicates by idempotency key and retries with backoff until dead", async () => {
    const store = new SqliteStore(":memory:");
    const q = new JobQueue(store, new AuditLog(store), () => 10);
    let calls = 0;
    q.register("flaky", async () => { calls++; throw new Error("boom"); });
    const a = q.enqueue("flaky", { x: 1 }, { idempotencyKey: "k1", maxAttempts: 3 });
    const b = q.enqueue("flaky", { x: 1 }, { idempotencyKey: "k1", maxAttempts: 3 });
    expect(a.created).toBe(true); expect(b.created).toBe(false); expect(b.job.id).toBe(a.job.id);
    let t = Date.now();
    await q.runOnce(10, new Date(t)); t += 1000;
    await q.runOnce(10, new Date(t)); t += 1000;
    await q.runOnce(10, new Date(t));
    expect(calls).toBe(3);
    expect(store.getJobByKey("k1")?.status).toBe("dead");
    expect(store.getJobByKey("k1")?.lastError).toBe("boom");
  });

  it("succeeds and stores the result; a second run does not re-execute", async () => {
    const store = new SqliteStore(":memory:");
    const q = new JobQueue(store, new AuditLog(store));
    let calls = 0;
    q.register("ok", async (p: { n: number }) => { calls++; return { doubled: p.n * 2 }; });
    q.enqueue("ok", { n: 2 }, { idempotencyKey: "ok:2" });
    await q.drain();
    await q.drain();
    expect(calls).toBe(1);
    expect(store.getJobByKey("ok:2")?.result).toEqual({ doubled: 4 });
  });
});

describe("NotificationService", () => {
  it("suppresses duplicate event keys and only pushes non-routine events", async () => {
    const store = new SqliteStore(":memory:");
    const n = new NotificationService(store);
    const push = new FakePushNotifier();
    n.use(push);
    const a = await n.emit({ eventKey: "outage:site1", priority: "critical", business: "wulff_studio", title: "Site down", body: "..." });
    const b = await n.emit({ eventKey: "outage:site1", priority: "critical", business: "wulff_studio", title: "Site down", body: "..." });
    await n.emit({ eventKey: "research:done", priority: "routine", business: "wulff_studio", title: "Research", body: "..." });
    expect(a.duplicate).toBe(false); expect(b.duplicate).toBe(true);
    expect(n.list()).toHaveLength(2);
    expect(push.delivered).toHaveLength(1);
    expect(a.notification.deliveries.map((d) => d.channel)).toEqual(["dashboard", "push"]);
    expect(n.list()[0]?.priority).toBe("critical");
  });
});

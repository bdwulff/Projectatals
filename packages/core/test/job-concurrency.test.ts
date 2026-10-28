import { it, expect } from "vitest";
import { SqliteStore, AuditLog, JobQueue } from "../src/index.js";

it("does not execute due research twice when scheduler and owner run jobs concurrently", async () => {
  const store = new SqliteStore(":memory:");
  const jobs = new JobQueue(store, new AuditLog(store));
  let started!: () => void;
  let release!: () => void;
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  let searches = 0;
  jobs.register("held", async () => { started(); await held; });
  jobs.register("research", async () => { searches++; });
  jobs.enqueue("held", {}, { idempotencyKey: "held" });
  jobs.enqueue("research", {}, { idempotencyKey: "daily-search", maxAttempts: 1 });
  const first = jobs.runOnce();
  await firstStarted;
  await jobs.runOnce();
  release();
  await first;
  expect(searches).toBe(1);
});

it("runs only the requested private preparation key and leaves an unrelated send queued", async () => {
  const store = new SqliteStore(":memory:");
  try {
    const jobs = new JobQueue(store, new AuditLog(store));
    const ran: string[] = [];
    jobs.register("send", async () => { ran.push("send"); });
    jobs.register("prepare", async () => { ran.push("prepare"); });
    jobs.enqueue("send", {}, { idempotencyKey: "previously-approved-send" });
    jobs.enqueue("prepare", {}, { idempotencyKey: "today-private-demo", maxAttempts: 1 });
    await jobs.runKey("today-private-demo");
    await jobs.runKey("today-private-demo");
    expect(ran).toEqual(["prepare"]);
    expect(store.getJobByKey("previously-approved-send")?.status).toBe("queued");
    expect(store.getJobByKey("today-private-demo")?.attempts).toBe(1);
  } finally { store.close(); }
});

it("does not start a targeted job early or concurrently with an active queue run", async () => {
  const store = new SqliteStore(":memory:");
  try {
    const jobs = new JobQueue(store, new AuditLog(store));
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { started = resolve; });
    jobs.register("held", async () => { started(); await held; });
    jobs.register("future", async () => { throw new Error("Future work must not start."); });
    jobs.enqueue("held", {}, { idempotencyKey: "held-target" });
    jobs.enqueue("future", {}, { idempotencyKey: "future-target", runAfter: new Date("2099-01-01") });
    expect(await jobs.runKey("future-target")).toEqual([]);
    const active = jobs.runKey("held-target");
    await ready;
    expect(await jobs.runKey("held-target")).toEqual([]);
    release(); await active;
    expect(store.getJobByKey("held-target")?.attempts).toBe(1);
    expect(store.getJobByKey("future-target")?.attempts).toBe(0);
  } finally { store.close(); }
});

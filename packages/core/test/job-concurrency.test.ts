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

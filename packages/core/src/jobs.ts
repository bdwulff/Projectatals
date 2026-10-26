import type { Store, StoredJob } from "./store.js";
import type { AuditLog } from "./audit.js";
import { newId, nowIso } from "./ids.js";

export type JobHandler<P = unknown, R = unknown> = (payload: P, ctx: { job: StoredJob; attempt: number }) => Promise<R>;

export interface EnqueueOptions {
  /** Same key => same job; a second enqueue returns the existing job (no duplicate external action). */
  idempotencyKey: string;
  maxAttempts?: number;
  runAfter?: Date;
}

/**
 * Durable job queue with idempotency keys and exponential backoff.
 * Workflows persist their state here so Atlas can resume after interruption
 * without repeating external actions (section 15).
 */
export class JobQueue {
  private running = false;
  private handlers = new Map<string, JobHandler<any, any>>();

  constructor(private readonly store: Store, private readonly audit: AuditLog, private readonly backoffMs = (attempt: number) => Math.min(60_000, 1000 * 2 ** attempt)) {}

  register<P, R>(type: string, handler: JobHandler<P, R>): void {
    this.handlers.set(type, handler);
  }

  enqueue<P>(type: string, payload: P, opts: EnqueueOptions): { job: StoredJob; created: boolean } {
    const existing = this.store.getJobByKey(opts.idempotencyKey);
    if (existing) return { job: existing, created: false };
    const now = nowIso();
    const job: StoredJob = {
      id: newId("job"),
      type,
      payload,
      idempotencyKey: opts.idempotencyKey,
      status: "queued",
      attempts: 0,
      maxAttempts: opts.maxAttempts ?? 3,
      runAfter: (opts.runAfter ?? new Date()).toISOString(),
      lastError: null,
      result: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.insertJob(job);
    return { job, created: true };
  }

  /** Process due jobs once. Returns the jobs touched. Safe to call from a scheduler tick. */
  async runOnce(limit = 20, now: Date = new Date()): Promise<StoredJob[]> {
    if (this.running) return [];
    this.running = true;
    try {
    const due = this.store.dueJobs(now.toISOString(), limit);
    const touched: StoredJob[] = [];
    for (const job of due) {
      const handler = this.handlers.get(job.type);
      job.status = "running";
      job.attempts += 1;
      this.store.updateJob(job);
      if (!handler) {
        job.status = "dead";
        job.lastError = `No handler registered for job type ${job.type}`;
        this.store.updateJob(job);
        touched.push(job);
        continue;
      }
      try {
        const result = await handler(job.payload, { job, attempt: job.attempts });
        job.status = "succeeded";
        job.result = result ?? null;
        job.lastError = null;
        this.store.updateJob(job);
        this.audit.record({ actor: "atlas", action: `job.${job.type}`, business: "atlas", targetType: "job", targetId: job.id, outcome: "completed", detail: { attempt: job.attempts } });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        job.lastError = message;
        if (job.attempts >= job.maxAttempts) {
          job.status = "dead";
          this.audit.record({ actor: "atlas", action: `job.${job.type}`, business: "atlas", targetType: "job", targetId: job.id, outcome: "failed", detail: { attempt: job.attempts, error: message, final: true } });
        } else {
          job.status = "queued";
          job.runAfter = new Date(now.getTime() + this.backoffMs(job.attempts)).toISOString();
          this.audit.record({ actor: "atlas", action: `job.${job.type}`, business: "atlas", targetType: "job", targetId: job.id, outcome: "attempted", detail: { attempt: job.attempts, error: message, retryAt: job.runAfter } });
        }
        this.store.updateJob(job);
      }
      touched.push(job);
    }
    return touched;
    } finally { this.running = false; }
  }

  /** Drain until nothing is due (used by tests and the demo). */
  async drain(maxRounds = 50, clock: () => Date = () => new Date()): Promise<void> {
    for (let i = 0; i < maxRounds; i++) {
      const touched = await this.runOnce(50, clock());
      if (touched.length === 0) return;
    }
  }

  list(limit = 100): StoredJob[] {
    return this.store.listJobs(limit);
  }
}

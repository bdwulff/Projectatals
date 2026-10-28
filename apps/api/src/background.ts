import { createHash } from "node:crypto";
import type { Runtime } from "./runtime.js";

const RESEARCH_JOB = "research_prospects";
const activeTicks = new WeakSet<Runtime["atlas"]>();
const DEFAULT_AREA = "Officer, Berwick, Pakenham, Cranbourne, Dandenong, Victoria";

export interface BackgroundOptions { clock?: () => Date }
export interface BackgroundTaskState {
  state: "completed" | "partial" | "failed" | "skipped" | "blocked" | "already_ran" | "queued" | "running";
  detail: string;
  jobId?: string;
  candidateCount?: number;
  qualifiedCount?: number;
}
export interface BackgroundRun {
  state: "running" | "completed" | "partial" | "skipped";
  startedAt: string;
  finishedAt?: string;
  day: string;
  checks: BackgroundTaskState;
  research: BackgroundTaskState;
}
interface ResearchJobPayload { area: string; count: number; day: string; scopeHash: string }

/** A local date key, including daylight saving transitions, independent of the server's timezone. */
export function melbourneResearchDay(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** No timer is started here, making scheduling and the clock explicit in tests. */
export function createBackgroundWorker(rt: Runtime, env: NodeJS.ProcessEnv = process.env, options: BackgroundOptions = {}) {
  const clock = options.clock ?? (() => new Date());
  const intervalRaw = Number(env.ATLAS_CHECK_INTERVAL_MS ?? 300_000);
  // Node overflows very large timer delays to 1 ms, so bound both ends.
  const intervalMs = Number.isFinite(intervalRaw) ? Math.min(86_400_000, Math.max(60_000, Math.floor(intervalRaw))) : 300_000;
  const store = rt.atlas.deps.store;

  function researchGate(): BackgroundTaskState | null {
    if (rt.discoveryProgram?.isConfigured()) return { state: "skipped", detail: "The configured Discovery program replaces legacy automatic research. No duplicate search was made." };
    if (env.ATLAS_RESEARCH_ENABLED !== "true") return { state: "skipped", detail: "Automatic research is disabled." };
    if (env.ATLAS_MODE !== "live" || rt.mode !== "live") return { state: "skipped", detail: "Automatic research runs only in explicit live mode; fictional mode never searches automatically." };
    if (env.ATLAS_RESEARCH_PROVIDER !== "tavily" && !env.BRAVE_SEARCH_API_KEY?.trim()) return { state: "blocked", detail: "Choose free Tavily research or configure BRAVE_SEARCH_API_KEY. No fictional data is substituted." };
    return null;
  }

  function scope(): { area: string; count: number; scopeHash: string } {
    const area = (env.ATLAS_RESEARCH_AREA?.trim() || DEFAULT_AREA).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").slice(0, 160);
    const raw = Number(env.ATLAS_RESEARCH_COUNT ?? 5);
    const count = Number.isFinite(raw) ? Math.min(env.ATLAS_RESEARCH_PROVIDER === "tavily" ? 5 : 10, Math.max(1, Math.floor(raw))) : 5;
    const scopeHash = createHash("sha256").update(JSON.stringify({ area: area.toLowerCase(), count, policy: "local-business-v2" })).digest("hex").slice(0, 24);
    return { area, count, scopeHash };
  }

  rt.atlas.jobs.register<ResearchJobPayload, { candidateCount: number; qualifiedCount: number; day: string }>(RESEARCH_JOB, async (payload, { job }) => {
    // Gates are checked again when an older queued job is picked up after a restart.
    const gate = researchGate();
    if (gate) throw new Error(gate.detail);
    if (payload.day !== melbourneResearchDay(clock())) throw new Error("Research job has expired; no backdated provider request was made.");
    const currentScope = scope();
    if (payload.scopeHash !== currentScope.scopeHash || payload.area !== currentScope.area || payload.count !== currentScope.count) throw new Error("Research scope changed; the previous queued job was skipped without a provider request.");
    const at = clock().toISOString();
    store.setMemory("background.research.lastRun", { state: "running", startedAt: at, day: payload.day, jobId: job.id, area: payload.area, count: payload.count });
    try {
      const prospects = env.ATLAS_RESEARCH_PROVIDER === "tavily"
        ? (await rt.acquisition.discover({ area: payload.area, count: payload.count })).map(record => rt.atlas.prospects.require(record.prospectId))
        : await rt.atlas.researchProspects({ area: payload.area, count: payload.count });
      if (prospects.some((p) => p.fixture)) throw new Error("Fictional data was returned in live research.");
      const result = { candidateCount: prospects.length, qualifiedCount: prospects.filter((p) => p.qualification === "qualified").length, day: payload.day };
      store.setMemory("background.research.lastRun", { state: "completed", startedAt: at, finishedAt: clock().toISOString(), jobId: job.id, area: payload.area, ...result });
      await rt.atlas.notifications.emit({
        eventKey: `${job.idempotencyKey}:results`,
        priority: prospects.length > 0 ? "action_needed" : "routine",
        business: "wulff_studio",
        title: prospects.length > 0 ? `${prospects.length} business discovery candidate${prospects.length === 1 ? "" : "s"} ready for review` : "Daily business discovery completed with no candidates",
        body: `${result.qualifiedCount} qualified; all other search findings need verification. No customer has been contacted and no quote has been created by this research job. Review the pipeline in Atlas.`,
        link: { type: "job", id: job.id },
      });
      return result;
    } catch {
      // Never persist arbitrary provider exception strings: they may contain credentials or headers.
      const detail = "Daily live research failed. No fictional replacement or automatic retry was used. Check the research connection and retry policy before another search.";
      store.setMemory("background.research.lastRun", { state: "failed", startedAt: at, finishedAt: clock().toISOString(), day: payload.day, jobId: job.id, detail });
      await rt.atlas.notifications.emit({ eventKey: `${job.idempotencyKey}:failed`, priority: "action_needed", business: "wulff_studio", title: "Daily business research needs attention", body: detail, link: { type: "job", id: job.id } });
      throw new Error(detail);
    }
  });

  async function tick(): Promise<BackgroundRun> {
    const now = clock();
    const startedAt = now.toISOString();
    const day = melbourneResearchDay(now);
    if (activeTicks.has(rt.atlas)) return { state: "skipped", startedAt, finishedAt: startedAt, day, checks: { state: "skipped", detail: "A background tick is already running." }, research: { state: "skipped", detail: "A background tick is already running." } };
    activeTicks.add(rt.atlas);
    const run: BackgroundRun = { state: "running", startedAt, day, checks: { state: "running", detail: "Scheduled checks started." }, research: { state: "queued", detail: "Research eligibility has not been evaluated." } };
    try {
      store.setMemory("background.lastRun", run);
      try {
        const checks = await rt.atlas.runScheduledChecks();
        const errors = Array.isArray(checks.failed) ? checks.failed.length : 0;
        run.checks = errors > 0 ? { state: "partial", detail: `${errors} scheduled check${errors === 1 ? "" : "s"} unavailable; research is evaluated independently.` } : { state: "completed", detail: "Scheduled checks completed." };
      } catch {
        run.checks = { state: "failed", detail: "Scheduled checks failed; research is evaluated independently." };
      }
      store.setMemory("background.lastRun", run);

      if (rt.discoveryProgram?.isConfigured()) {
        const result = await rt.discoveryProgram.dailyTick();
        run.research = { ...result, state: result.state === "idle" ? "skipped" : result.state };
      } else {
        const gate = researchGate();
        if (gate) {
          run.research = gate;
          store.setMemory("background.research.eligibility", { ...gate, checkedAt: clock().toISOString() });
        } else {
          const requestedScope = scope();
          const key = `${RESEARCH_JOB}:${day}:${requestedScope.scopeHash}`;
          // A succeeded, dead, or interrupted/running job retains this unique key. Never re-enqueue a retry today.
          const queued = rt.atlas.jobs.enqueue(RESEARCH_JOB, { ...requestedScope, day }, { idempotencyKey: key, maxAttempts: 1, runAfter: now });
          if (queued.created || queued.job.status === "queued") await rt.atlas.jobs.runOnce(20, now);
          const job = store.getJobByKey(key)!;
          if (job.status === "succeeded") {
            const result = job.result as { candidateCount?: number; qualifiedCount?: number } | null;
            run.research = { state: queued.created ? "completed" : "already_ran", detail: queued.created ? "Daily research completed; results are ready for owner review." : "This Melbourne day's research scope has already completed; no additional search was made.", jobId: job.id, candidateCount: result?.candidateCount, qualifiedCount: result?.qualifiedCount };
          } else if (job.status === "dead" || job.status === "failed") {
            run.research = { state: "failed", detail: "Daily research failed and will not retry automatically for this day and scope.", jobId: job.id };
          } else {
            run.research = { state: job.status === "running" ? "running" : "queued", detail: job.status === "running" ? "Research was started; an interrupted request is not repeated automatically." : "Daily research is queued in the persistent job queue.", jobId: job.id };
          }
        }
      }
      try { await rt.ownerUpdates.dailyTick(); } catch { store.setMemory("ownerUpdates.workerError", { at: clock().toISOString(), detail: "Owner update processing could not finish. Check its connection status." }); }
      run.state = [run.checks.state, run.research.state].some((state) => ["failed", "partial", "blocked", "queued", "running"].includes(state)) ? "partial" : "completed";
      run.finishedAt = clock().toISOString();
      store.setMemory("background.lastRun", run);
      return run;
    } finally { activeTicks.delete(rt.atlas); }
  }

  return { tick, intervalMs };
}

/** Starts immediately, then at a minimum one-minute interval. The HTTP server keeps the process alive. */
export function startBackgroundWorker(rt: Runtime, env: NodeJS.ProcessEnv = process.env, options: BackgroundOptions = {}) {
  const worker = createBackgroundWorker(rt, env, options);
  const run = () => { void worker.tick().catch(() => console.error("Atlas background worker failed; inspect the persistent worker state.")); };
  run();
  const timer = setInterval(run, worker.intervalMs);
  timer.unref();
  return { ...worker, stop: () => clearInterval(timer) };
}

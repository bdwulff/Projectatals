// Durable local store on node:sqlite (zero native deps). Schema is kept to a
// Postgres-compatible subset so it can be moved to Supabase/Postgres later.
import { DatabaseSync } from "node:sqlite";
import type { AuditEntry } from "./audit.js";
import { nowIso } from "./ids.js";

export interface DocRow<T = unknown> {
  id: string;
  collection: string;
  doc: T;
  createdAt: string;
  updatedAt: string;
}

export interface StoredJob {
  id: string;
  type: string;
  payload: unknown;
  idempotencyKey: string;
  status: "queued" | "running" | "succeeded" | "failed" | "dead";
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lastError: string | null;
  result: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface Store {
  migrate(): void;
  // generic documents
  upsertDoc<T>(collection: string, id: string, doc: T): DocRow<T>;
  getDoc<T>(collection: string, id: string): DocRow<T> | null;
  listDocs<T>(collection: string, limit?: number): DocRow<T>[];
  deleteDoc(collection: string, id: string): void;
  // audit
  insertAudit(entry: AuditEntry): void;
  listAudit(limit: number): AuditEntry[];
  // jobs
  insertJob(job: StoredJob): void;
  updateJob(job: StoredJob): void;
  getJobByKey(idempotencyKey: string): StoredJob | null;
  dueJobs(now: string, limit: number): StoredJob[];
  listJobs(limit: number): StoredJob[];
  // key/value (business memory)
  setMemory(key: string, value: unknown): void;
  getMemory<T>(key: string): T | null;
  listMemory(prefix: string): { key: string; value: unknown }[];
  close(): void;
}

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        doc TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS documents_collection_updated ON documents(collection, updated_at DESC);
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        business TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        outcome TEXT NOT NULL,
        detail TEXT
      );
      CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log(at DESC);
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        run_after TEXT NOT NULL,
        last_error TEXT,
        result TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status, run_after);
      CREATE TABLE IF NOT EXISTS memory (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
];

export class SqliteStore implements Store {
  private db: DatabaseSync;

  constructor(path: string = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  migrate(): void {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    const applied = new Set(
      (this.db.prepare("SELECT version FROM schema_version").all() as { version: number }[]).map((r) => r.version),
    );
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue;
      this.db.exec("BEGIN");
      try {
        this.db.exec(m.sql);
        this.db.prepare("INSERT INTO schema_version(version, applied_at) VALUES (?, ?)").run(m.version, nowIso());
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    }
  }

  upsertDoc<T>(collection: string, id: string, doc: T): DocRow<T> {
    const now = nowIso();
    const existing = this.getDoc<T>(collection, id);
    const createdAt = existing?.createdAt ?? now;
    this.db
      .prepare(
        `INSERT INTO documents(collection, id, doc, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(collection, id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at`,
      )
      .run(collection, id, JSON.stringify(doc), createdAt, now);
    return { id, collection, doc, createdAt, updatedAt: now };
  }

  getDoc<T>(collection: string, id: string): DocRow<T> | null {
    const row = this.db
      .prepare("SELECT id, collection, doc, created_at, updated_at FROM documents WHERE collection = ? AND id = ?")
      .get(collection, id) as { id: string; collection: string; doc: string; created_at: string; updated_at: string } | undefined;
    if (!row) return null;
    return { id: row.id, collection: row.collection, doc: JSON.parse(row.doc) as T, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  listDocs<T>(collection: string, limit = 500): DocRow<T>[] {
    const rows = this.db
      .prepare("SELECT id, collection, doc, created_at, updated_at FROM documents WHERE collection = ? ORDER BY updated_at DESC LIMIT ?")
      .all(collection, limit) as { id: string; collection: string; doc: string; created_at: string; updated_at: string }[];
    return rows.map((row) => ({ id: row.id, collection: row.collection, doc: JSON.parse(row.doc) as T, createdAt: row.created_at, updatedAt: row.updated_at }));
  }

  deleteDoc(collection: string, id: string): void {
    this.db.prepare("DELETE FROM documents WHERE collection = ? AND id = ?").run(collection, id);
  }

  insertAudit(e: AuditEntry): void {
    this.db
      .prepare(
        "INSERT INTO audit_log(id, at, actor, action, business, target_type, target_id, outcome, detail) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(e.id, e.at, e.actor, e.action, e.business, e.targetType ?? null, e.targetId ?? null, e.outcome, e.detail ? JSON.stringify(e.detail) : null);
  }

  listAudit(limit: number): AuditEntry[] {
    const rows = this.db.prepare("SELECT * FROM audit_log ORDER BY at DESC LIMIT ?").all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      at: r.at as string,
      actor: r.actor as AuditEntry["actor"],
      action: r.action as string,
      business: r.business as AuditEntry["business"],
      targetType: (r.target_type as string | null) ?? undefined,
      targetId: (r.target_id as string | null) ?? undefined,
      outcome: r.outcome as AuditEntry["outcome"],
      detail: r.detail ? (JSON.parse(r.detail as string) as Record<string, unknown>) : undefined,
    }));
  }

  private rowToJob(r: Record<string, unknown>): StoredJob {
    return {
      id: r.id as string,
      type: r.type as string,
      payload: JSON.parse(r.payload as string),
      idempotencyKey: r.idempotency_key as string,
      status: r.status as StoredJob["status"],
      attempts: r.attempts as number,
      maxAttempts: r.max_attempts as number,
      runAfter: r.run_after as string,
      lastError: (r.last_error as string | null) ?? null,
      result: r.result ? JSON.parse(r.result as string) : null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };
  }

  insertJob(j: StoredJob): void {
    this.db
      .prepare(
        `INSERT INTO jobs(id, type, payload, idempotency_key, status, attempts, max_attempts, run_after, last_error, result, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(j.id, j.type, JSON.stringify(j.payload), j.idempotencyKey, j.status, j.attempts, j.maxAttempts, j.runAfter, j.lastError, j.result == null ? null : JSON.stringify(j.result), j.createdAt, j.updatedAt);
  }

  updateJob(j: StoredJob): void {
    this.db
      .prepare(
        `UPDATE jobs SET status = ?, attempts = ?, run_after = ?, last_error = ?, result = ?, updated_at = ? WHERE id = ?`,
      )
      .run(j.status, j.attempts, j.runAfter, j.lastError, j.result == null ? null : JSON.stringify(j.result), nowIso(), j.id);
  }

  getJobByKey(key: string): StoredJob | null {
    const r = this.db.prepare("SELECT * FROM jobs WHERE idempotency_key = ?").get(key) as Record<string, unknown> | undefined;
    return r ? this.rowToJob(r) : null;
  }

  dueJobs(now: string, limit: number): StoredJob[] {
    const rows = this.db
      .prepare("SELECT * FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY run_after ASC LIMIT ?")
      .all(now, limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToJob(r));
  }

  listJobs(limit: number): StoredJob[] {
    const rows = this.db.prepare("SELECT * FROM jobs ORDER BY updated_at DESC LIMIT ?").all(limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToJob(r));
  }

  setMemory(key: string, value: unknown): void {
    this.db
      .prepare("INSERT INTO memory(key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(key, JSON.stringify(value), nowIso());
  }

  getMemory<T>(key: string): T | null {
    const r = this.db.prepare("SELECT value FROM memory WHERE key = ?").get(key) as { value: string } | undefined;
    return r ? (JSON.parse(r.value) as T) : null;
  }

  listMemory(prefix: string): { key: string; value: unknown }[] {
    const rows = this.db.prepare("SELECT key, value FROM memory WHERE key LIKE ? ORDER BY key").all(`${prefix}%`) as { key: string; value: string }[];
    return rows.map((r) => ({ key: r.key, value: JSON.parse(r.value) }));
  }

  close(): void {
    this.db.close();
  }
}

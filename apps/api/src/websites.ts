import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Atlas } from "@atlas/core";
import type { Context, Hono } from "hono";

const API = "https://api.lovable.dev", VERSION = "2026-09-11";
const LINK = "websites.lovable.link", CACHE = "websites.lovable.cache", SITES = "owner_websites";
const ID = /^[A-Za-z0-9_-]{3,128}$/;
const hash = (v: string) => createHash("sha256").update(v).digest("hex");

export interface WebsiteProject { id: string; name: string; editorUrl: string; isPublished: boolean; lastEditedAt?: string }
export interface WebsiteCheck { state: "unchecked" | "reachable" | "unreachable" | "error" | "fake"; detail: string; checkedAt?: string; status?: number; title?: string }
export interface OwnerWebsite { id: string; name: string; url: string; lovableProjectId?: string; repoUrl?: string; fixture: boolean; createdAt: string; updatedAt: string; check: WebsiteCheck }
export interface WebsiteLovableStatus {
  state: "connected" | "not_connected" | "error" | "fake"; detail: string; workspaceId?: string; workspaceName?: string;
  verifiedAt?: string; lastAttemptAt?: string; truncated: boolean; projects: WebsiteProject[];
  capabilities: { readProjects: true; editCode: false; publish: false };
}
export interface WebsiteSnapshot { mode: "live" | "fake"; lovable: WebsiteLovableStatus; sites: OwnerWebsite[] }
export interface WebsiteConnectionsOptions { atlas: Atlas; mode: "live" | "fake"; ownerAccessKey?: string; request?: typeof fetch; clock?: () => Date }
interface SavedLink { sealedKey: string; workspaceId: string; generation: string }
interface CachedConnection { state: "connected" | "error"; detail: string; workspaceId: string; workspaceName: string; verifiedAt: string; lastAttemptAt: string; projects: WebsiteProject[]; truncated: boolean }
interface Workspace { id: string; name: string }
interface Page { data: Record<string, unknown>[]; hasMore: boolean }
const capabilities = { readProjects: true as const, editCode: false as const, publish: false as const };

export class WebsiteConnectionError extends Error { constructor(message: string, readonly status: 400 | 404 | 409 | 503 = 400) { super(message); } }

/** Read-only Lovable metadata and an owner-maintained registry of public websites. */
export class WebsiteConnections {
  private readonly store;
  private readonly clock: () => Date;
  private epoch = 0;
  private checking = new Map<string, number>();
  constructor(private readonly options: WebsiteConnectionsOptions) { this.store = options.atlas.deps.store; this.clock = options.clock ?? options.atlas.clock; }
  private iso() { return this.clock().toISOString(); }
  private encryptionKey() {
    if (!this.options.ownerAccessKey || this.options.ownerAccessKey.length < 32 || this.options.ownerAccessKey.length > 1024) throw new WebsiteConnectionError("Secure owner authentication is required before saving a workspace key.", 503);
    return createHash("sha256").update("atlas-lovable-read-connection-v1\0" + this.options.ownerAccessKey).digest();
  }
  private seal(value: string): string {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.encryptionKey(), iv);
    cipher.setAAD(Buffer.from("https://api.lovable.dev:2026-09-11"));
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
  }
  private unseal(value: string): string {
    try {
      const bytes = Buffer.from(value, "base64url"); if (bytes.length < 29 || bytes.length > 2200) throw new Error();
      const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey(), bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from("https://api.lovable.dev:2026-09-11")); decipher.setAuthTag(bytes.subarray(12, 28));
      const key = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
      if (!validKey(key)) throw new Error(); return key;
    } catch { throw new WebsiteConnectionError("The saved workspace connection cannot be read. Connect it again using your dedicated Lovable key.", 503); }
  }
  snapshot(): WebsiteSnapshot {
    const link = this.store.getMemory<SavedLink>(LINK), cached = this.store.getMemory<CachedConnection>(CACHE);
    let lovable: WebsiteLovableStatus = { state: "not_connected", detail: "Connect a dedicated Lovable workspace key to read project status. ChatGPT's Lovable connection is separate from this app.", truncated: false, projects: [], capabilities };
    if (this.options.mode === "fake") lovable = { ...lovable, state: "fake", detail: "Fictional test mode. No Lovable account is contacted or connected." };
    else if (link && cached && cached.workspaceId === link.workspaceId) {
      try { this.unseal(link.sealedKey); lovable = { ...cached, capabilities }; }
      catch { lovable = { ...lovable, state: "error", detail: "The saved workspace key is unreadable. Reconnect it; no provider request was made." }; }
    } else if (link) lovable = { ...lovable, state: "error", detail: "No verified project snapshot is available. Refresh or reconnect the workspace." };
    return { mode: this.options.mode, lovable, sites: this.store.listDocs<OwnerWebsite>(SITES, 100).map(r => r.doc) };
  }
  async connect(input: unknown): Promise<void> {
    if (this.options.mode === "fake") throw new WebsiteConnectionError("Fictional mode cannot connect a real Lovable account.", 409);
    const v = object(input, ["apiKey", "workspaceId"]);
    const apiKey = typeof v.apiKey === "string" ? v.apiKey.trim() : "";
    if (!validKey(apiKey)) throw new WebsiteConnectionError("Use a dedicated Lovable workspace API key beginning with lov_. Paste it only into this private connection form.");
    if (v.workspaceId !== undefined && (typeof v.workspaceId !== "string" || !ID.test(v.workspaceId))) throw new WebsiteConnectionError("The workspace ID is invalid.");
    this.encryptionKey();
    const epoch = ++this.epoch;
    const stillCurrent = () => { if (epoch !== this.epoch) throw new WebsiteConnectionError("Website connection settings changed during verification. Start again.", 409); };
    const cached = await this.readConnection(apiKey, v.workspaceId as string | undefined, stillCurrent);
    if (epoch !== this.epoch) throw new WebsiteConnectionError("Website connection settings changed during verification. Start again.", 409);
    const link: SavedLink = { sealedKey: this.seal(apiKey), workspaceId: cached.workspaceId, generation: randomBytes(16).toString("hex") };
    this.store.setMemory(LINK, link); this.store.setMemory(CACHE, cached);
    this.options.atlas.audit.record({ actor: "owner", action: "execute.record_update.website_connection", business: "atlas", outcome: "completed", detail: { provider: "Lovable", workspaceId: cached.workspaceId, readOnlyAdapter: true, projects: cached.projects.length, truncated: cached.truncated } });
  }
  disconnect(): void {
    this.epoch++; this.store.setMemory(LINK, null); this.store.setMemory(CACHE, null);
    this.options.atlas.audit.record({ actor: "owner", action: "execute.record_update.website_connection_removed", business: "atlas", outcome: "completed", detail: { provider: "Lovable", externalTokenRevoked: false } });
  }
  async refresh(): Promise<void> {
    if (this.options.mode === "fake") return;
    const link = this.store.getMemory<SavedLink>(LINK);
    if (!link) throw new WebsiteConnectionError("Connect a Lovable workspace before refreshing its projects.", 409);
    const key = this.unseal(link.sealedKey), epoch = ++this.epoch;
    try {
      const stillCurrent = () => { if (epoch !== this.epoch || this.store.getMemory<SavedLink>(LINK)?.generation !== link.generation) throw new WebsiteConnectionError("The workspace was disconnected or changed during refresh.", 409); };
      const cached = await this.readConnection(key, link.workspaceId, stillCurrent);
      if (epoch !== this.epoch || this.store.getMemory<SavedLink>(LINK)?.generation !== link.generation) throw new WebsiteConnectionError("The workspace was disconnected or changed during refresh.", 409);
      this.store.setMemory(CACHE, cached);
    } catch (e) {
      const current = this.store.getMemory<SavedLink>(LINK), cached = this.store.getMemory<CachedConnection>(CACHE);
      if (epoch === this.epoch && current?.generation === link.generation && cached) this.store.setMemory(CACHE, { ...cached, state: "error", lastAttemptAt: this.iso(), detail: "Workspace refresh failed. The project list below is the last verified snapshot and may be stale. Check key expiry, read permissions, workspace plan or provider availability." } satisfies CachedConnection);
      throw e instanceof WebsiteConnectionError ? e : new WebsiteConnectionError("The workspace project list could not be refreshed. No external changes were made.", 503);
    }
  }
  addSite(input: unknown): OwnerWebsite {
    const v = object(input, ["name", "url", "lovableProjectId", "repoUrl"]);
    const name = boundedText(v.name, "Website name", 160), url = websiteUrl(v.url, this.options.mode);
    if (this.options.mode === "fake" && !/\(fictional\)/i.test(name)) throw new WebsiteConnectionError("Fictional website records must include (fictional) in their names.");
    if (v.lovableProjectId !== undefined && (typeof v.lovableProjectId !== "string" || !ID.test(v.lovableProjectId))) throw new WebsiteConnectionError("Use the project ID from its verified Lovable editor URL.");
    let repoUrl: string | undefined;
    if (v.repoUrl !== undefined) {
      if (typeof v.repoUrl !== "string") throw new WebsiteConnectionError("Provide a GitHub repository URL.");
      try { const u = new URL(v.repoUrl); if (u.origin !== "https://github.com" || u.username || u.password || u.search || u.hash || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(u.pathname)) throw new Error(); repoUrl = u.href; }
      catch { throw new WebsiteConnectionError("Use an HTTPS GitHub repository URL without credentials or query parameters."); }
    }
    const id = `site_${hash(url).slice(0, 24)}`, prior = this.store.getDoc<OwnerWebsite>(SITES, id)?.doc;
    if (!prior && this.store.listDocs(SITES, 100).length >= 50) throw new WebsiteConnectionError("The website registry is limited to fifty entries.", 409);
    const site: OwnerWebsite = { id, name, url, fixture: this.options.mode === "fake", ...(v.lovableProjectId ? { lovableProjectId: v.lovableProjectId as string } : {}), ...(repoUrl ? { repoUrl } : {}), createdAt: prior?.createdAt ?? this.iso(), updatedAt: this.iso(), check: prior?.check ?? { state: "unchecked", detail: "Website saved. Availability and control have not been verified." } };
    this.store.upsertDoc(SITES, id, site);
    this.options.atlas.audit.record({ actor: "owner", action: "execute.record_update.website_registered", business: "atlas", targetType: "website", targetId: id, outcome: site.fixture ? "simulated" : "completed", detail: { publicUrl: url, projectReferenceAdded: Boolean(site.lovableProjectId), repositoryReferenceAdded: Boolean(repoUrl) } });
    return site;
  }
  async checkSite(id: string): Promise<void> {
    const site = this.store.getDoc<OwnerWebsite>(SITES, id)?.doc; if (!site) throw new WebsiteConnectionError("Website not found.", 404);
    const serial = (this.checking.get(id) ?? 0) + 1; this.checking.set(id, serial);
    let check: WebsiteCheck;
    if (this.options.mode === "fake") check = { state: "fake", checkedAt: this.iso(), detail: "Fictional website check. No real website was contacted." };
    else {
      try {
        const result = await this.options.atlas.deps.websiteChecker.check(site.url);
        const state = result.reachable ? "reachable" : result.status ? "unreachable" : "error";
        check = { state, checkedAt: this.iso(), detail: result.reachable ? "A public HTTP read succeeded. This does not verify customer forms, private data access or permission to edit the website." : "The public website check did not confirm availability. No claim about private data or editing access was made.", ...(validStatus(result.status) ? { status: result.status } : {}), ...(result.title ? { title: result.title.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 180) } : {}) };
      } catch { check = { state: "error", checkedAt: this.iso(), detail: "The public website check could not finish. Provider details were withheld." }; }
    }
    if (this.checking.get(id) !== serial) return;
    const current = this.store.getDoc<OwnerWebsite>(SITES, id)?.doc; if (!current || current.url !== site.url) return;
    this.store.upsertDoc(SITES, id, { ...current, check, updatedAt: this.iso() });
    this.options.atlas.audit.record({ actor: "owner", action: "read.website", business: "atlas", targetType: "website", targetId: id, outcome: check.state === "fake" ? "simulated" : check.state === "reachable" ? "completed" : "failed", detail: { state: check.state, status: check.status } });
  }
  private async readConnection(apiKey: string, workspaceId?: string, stillCurrent: () => void = () => {}): Promise<CachedConnection> {
    const at = this.iso(), workspacesPage = await this.page("/v1/workspaces", apiKey);
    stillCurrent();
    const workspaces: Workspace[] = workspacesPage.data.map(v => ({ id: idValue(v.id), name: boundedText(v.name, "Workspace name", 160) }));
    const workspace = workspaceId ? workspaces.find(w => w.id === workspaceId) : workspaces.length === 1 ? workspaces[0] : null;
    if (!workspace) throw new WebsiteConnectionError(workspaces.length ? "The key returned multiple workspaces or a different workspace. Provide its exact workspace ID and reconnect." : "No workspace was available to this key. Check its workspace read permission and plan.", 503);
    const projectsPage = await this.page("/v1/projects", apiKey, workspace.id);
    stillCurrent();
    const projects: WebsiteProject[] = projectsPage.data.map(v => {
      if (v.workspace_id !== workspace.id) throw new WebsiteConnectionError("Lovable returned a project outside the selected workspace. No connection was saved.", 503);
      const id = idValue(v.id); if (typeof v.is_published !== "boolean") throw new WebsiteConnectionError("Lovable returned an unexpected project state.", 503);
      const edited = typeof v.last_edited_at === "string" && Number.isFinite(Date.parse(v.last_edited_at)) ? v.last_edited_at : undefined;
      return { id, name: v.name == null ? "Untitled project" : boundedText(v.name, "Project name", 180), editorUrl: `https://lovable.dev/projects/${encodeURIComponent(id)}`, isPublished: v.is_published, ...(edited ? { lastEditedAt: edited } : {}) };
    });
    const truncated = workspacesPage.hasMore || projectsPage.hasMore;
    const result: CachedConnection = { state: "connected", detail: `${projects.length} project${projects.length === 1 ? "" : "s"} read from the selected workspace${truncated ? "; the list is limited to the first fifty results" : ""}. This is the last successful read, not a live access guarantee. This connection reads project metadata; code editing and publishing are unavailable.`, workspaceId: workspace.id, workspaceName: workspace.name, verifiedAt: at, lastAttemptAt: at, projects, truncated };
    if (JSON.stringify(result).includes(apiKey)) throw new WebsiteConnectionError("The provider returned sensitive credential content as metadata. No connection was saved.", 503);
    return result;
  }
  private async page(path: "/v1/workspaces" | "/v1/projects", apiKey: string, workspaceId?: string): Promise<Page> {
    const url = new URL(API + path); url.searchParams.set("limit", "50"); if (workspaceId) url.searchParams.set("workspace_id", workspaceId);
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new WebsiteConnectionError("The Lovable read timed out. No automatic retry or external change was made.", 503)); }, 12_000); });
    void expired.catch(() => {});
    let response: Response | undefined;
    try {
      response = await Promise.race([(this.options.request ?? fetch)(url.href, { method: "GET", headers: { "Lovable-API-Key": apiKey, "Lovable-Version": VERSION, Accept: "application/json" }, redirect: "error", signal: controller.signal }), expired]);
      if (!response.ok) throw new WebsiteConnectionError(response.status === 401 || response.status === 403 ? "Lovable refused the workspace read. Check the dedicated key's expiry, workspaces:read permission, account verification and IP restrictions." : response.status === 402 ? "This workspace does not currently have the required Lovable API access. No plan upgrade was purchased." : response.status === 429 ? "Lovable has rate-limited this read. Wait before choosing Refresh; no automatic retry was made." : "Lovable could not return the workspace metadata. No changes were made.", 503);
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("Content-Type") ?? "")) throw new Error();
      const reader = response.body?.getReader(); if (!reader) throw new Error(); const chunks: Uint8Array[] = []; let bytes = 0;
      try { for (;;) { const next = await Promise.race([reader.read(), expired]); if (next.done) break; bytes += next.value.byteLength; if (bytes > 512 * 1024) throw new Error(); chunks.push(next.value); } }
      finally { void reader.cancel().catch(() => {}); }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
      const v = data as Record<string, unknown>, p = v.pagination;
      if (!Array.isArray(v.data) || v.data.length > 50 || v.data.some(x => !x || typeof x !== "object" || Array.isArray(x)) || !p || typeof p !== "object" || typeof (p as Record<string, unknown>).has_more !== "boolean") throw new Error();
      return { data: v.data as Record<string, unknown>[], hasMore: (p as Record<string, unknown>).has_more as boolean };
    } catch (error) { if (error instanceof WebsiteConnectionError) throw error; throw new WebsiteConnectionError("The Lovable read failed or returned an invalid response. Sensitive provider details were withheld; no retry or external change was made.", 503); }
    finally { if (timeout) clearTimeout(timeout); controller.abort(); void response?.body?.cancel().catch(() => {}); }
  }
}

export function installWebsiteRoutes(app: Hono, service: WebsiteConnections): void {
  const failure = (c: Context, e: unknown) => c.json({ error: e instanceof WebsiteConnectionError ? e.message : "The website action could not finish. Check its connection and try again." }, e instanceof WebsiteConnectionError ? e.status : e instanceof SyntaxError ? 400 : 503);
  const mutate = (action: (value: unknown, c: Context) => unknown) => async (c: Context) => { try { await action(await c.req.json(), c); return c.json(service.snapshot()); } catch (e) { return failure(c, e); } };
  app.get("/api/websites", c => c.json(service.snapshot()));
  app.post("/api/websites/lovable/connect", mutate(v => service.connect(v)));
  app.post("/api/websites/lovable/refresh", mutate(v => { object(v, []); return service.refresh(); }));
  app.post("/api/websites/lovable/disconnect", mutate(v => { object(v, []); return service.disconnect(); }));
  app.post("/api/websites/sites", mutate(v => service.addSite(v)));
  app.post("/api/websites/sites/:id/check", mutate((v, c) => { object(v, []); return service.checkSite(c.req.param("id")!); }));
}
function object(value: unknown, keys: string[]): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new WebsiteConnectionError("Check the website request fields."); return value as Record<string, unknown>; }
function boundedText(value: unknown, label: string, max: number): string { if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new WebsiteConnectionError(`${label} must be plain text within its length limit.`); return value.trim(); }
function idValue(value: unknown): string { if (typeof value !== "string" || !ID.test(value)) throw new WebsiteConnectionError("The provider returned an invalid resource ID.", 503); return value; }
function validKey(value: string): boolean { return /^lov_[\x21-\x7e]{8,1000}$/.test(value); }
function validStatus(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599; }
function websiteUrl(value: unknown, mode: "live" | "fake"): string {
  try {
    if (typeof value !== "string" || value.length > 2000) throw new Error(); const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || (u.port && u.port !== "443") || !u.hostname.includes(".") || !/^[A-Za-z0-9.-]+$/.test(u.hostname) || /^\d+\./.test(u.hostname) || /(?:^|\.)(?:localhost|local|internal|home|lan|invalid|example|onion)$/.test(u.hostname)) throw new Error();
    if (mode === "live" ? /(?:^|\.)test$/.test(u.hostname) : !u.hostname.endsWith(".example.test")) throw new Error();
    return u.href;
  } catch { throw new WebsiteConnectionError(mode === "fake" ? "Use a fictional HTTPS website on an .example.test domain." : "Use a public HTTPS website URL without credentials, query parameters or fragments."); }
}

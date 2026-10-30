import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { buildRuntime, type Runtime } from "./runtime.js";
import { installScenicPreviewRoutes } from "./scenic-previews.js";

const origin = "https://jarvis.example.test", token = "fictional-preview-token-".repeat(2);
const instant = Date.parse("2026-10-29T00:00:00Z");
const script = "document.body.dataset.scene='ready';";
const html = `<!doctype html><html><body><h1>Fictional business concept</h1><a href="mailto:hello@business.example.test">Email</a><a href="tel:+61390000000">Call</a><a href="#scene">Explore</a><script>${script}</script></body></html>`;
const state: { directories: string[]; runtimes: Runtime[] } = { directories: [], runtimes: [] };
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "atlas-preview-test-")); state.directories.push(directory);
  const rt = buildRuntime({ ATLAS_MODE: "fake", ATLAS_PUBLIC_ORIGIN: origin }); state.runtimes.push(rt);
  const app = createApp(rt, { ownerAccessKey: "fictional-owner-key-".repeat(3), publicOrigin: origin });
  installScenicPreviewRoutes(app, { directory, now: () => instant });
  const entry = { token, filename: "01-fictional-business.html", sha256: createHash("sha256").update(html).digest("hex"), publishedAt: "2026-10-28T00:00:00Z", expiresAt: "2027-01-26T00:00:00Z" };
  const manifest = { version: 1, previews: [entry] };
  const saveManifest = () => writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
  await writeFile(join(directory, entry.filename), html); await saveManifest();
  return { directory, rt, app, entry, manifest, saveManifest, get: (path = `/concepts/${token}`) => app.request(origin + path) };
}
afterEach(async () => {
  state.runtimes.splice(0).forEach(rt => rt.atlas.deps.store.close());
  await Promise.all(state.directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("owner-published scenic preview files", () => {
  it("serves the exact allowlisted HTML anonymously without exposing owner data or sending email", async () => {
    const s = await setup(), before = JSON.stringify(s.rt.atlas.deps.store.listDocs("acquisition_records"));
    const response = await s.get(); expect(response.status).toBe(200); expect(await response.text()).toBe(html);
    expect(response.headers.get("set-cookie")).toBeNull();
    for (const path of ["/api/acquisition", "/api/status", "/api/prospects"]) expect((await s.get(path)).status).toBe(401);
    for (const path of ["/concepts", "/concepts/manifest.json", "/concepts/START-HERE.html", "/concepts/EMAIL-DRAFTS.html", "/concepts/pricing.xlsx", `/concepts/${token}/../manifest.json`, `/concepts/${"x".repeat(40)}`]) expect((await s.get(path)).status).toBe(404);
    expect(s.rt.fakes.mailer.sent).toHaveLength(0);
    expect(JSON.stringify(s.rt.atlas.deps.store.listDocs("acquisition_records"))).toBe(before);
  });
  it("permits only the reviewed inline scripts, embedded photography/fonts and normal contact links", async () => {
    const s = await setup(), response = await s.get(), policy = response.headers.get("content-security-policy")!;
    expect(policy).toContain(`script-src 'sha256-${createHash("sha256").update(script).digest("base64")}'`);
    for (const rule of ["sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox", "default-src 'none'", "img-src data:", "font-src data:", "style-src 'unsafe-inline'", "connect-src 'none'", "form-action 'none'", "frame-ancestors 'none'"]) expect(policy).toContain(rule);
    expect(policy).not.toContain("allow-same-origin"); expect(policy).not.toContain("script-src 'unsafe-inline'");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer"); expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("permissions-policy")).toContain("microphone=()");
    const body = await response.text(); expect(body).toContain('href="mailto:'); expect(body).toContain('href="tel:'); expect(body).toContain('href="#scene"');
  });
  it("refuses a changed HTML file on every request and accepts no publishing/upload methods", async () => {
    const s = await setup(); expect((await s.get()).status).toBe(200);
    await writeFile(join(s.directory, s.entry.filename), html + "<p>Unreviewed change</p>");
    expect((await s.get()).status).toBe(404);
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) expect((await s.app.request(origin + `/concepts/${token}`, { method, body: "untrusted" })).status).toBe(404);
    expect(s.rt.fakes.mailer.sent).toHaveLength(0);
  });
  it.each(["../private.html", "emails.txt", "subdirectory/site.html", "01-Business.html"])("rejects unsafe allowlist filename %s", async filename => {
    const s = await setup(); s.entry.filename = filename; await s.saveManifest(); expect((await s.get()).status).toBe(404);
  });
  it("rejects malformed JSON, duplicate tokens, expired/future publications and overlong publication windows", async () => {
    const s = await setup();
    await writeFile(join(s.directory, "manifest.json"), "not JSON"); expect((await s.get()).status).toBe(404);
    s.manifest.previews.push({ ...s.entry, filename: "02-other.html" }); await s.saveManifest(); expect((await s.get()).status).toBe(404); s.manifest.previews.pop();
    for (const change of [
      { publishedAt: "2026-10-27T00:00:00Z", expiresAt: "2026-10-29T00:00:00Z" },
      { publishedAt: "2026-10-30T00:00:00Z", expiresAt: "2026-11-29T00:00:00Z" },
      { publishedAt: "2026-10-28T00:00:00Z", expiresAt: "2027-02-28T00:00:00Z" },
    ]) { Object.assign(s.entry, change); await s.saveManifest(); expect((await s.get()).status).toBe(404); }
  });
  it("refuses symlinked preview files and files beyond the eight MiB limit", async () => {
    const s = await setup(), file = join(s.directory, s.entry.filename), target = join(s.directory, "private.txt");
    await writeFile(target, html); await rm(file); await symlink(target, file); expect((await s.get()).status).toBe(404);
    await rm(file); const oversized = "x".repeat(8 * 1024 * 1024 + 1); s.entry.sha256 = createHash("sha256").update(oversized).digest("hex");
    await writeFile(file, oversized); await s.saveManifest(); expect((await s.get()).status).toBe(404);
  });
});

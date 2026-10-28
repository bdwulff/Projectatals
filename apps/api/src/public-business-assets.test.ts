import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AcquisitionRecord } from "@atlas/core";
import { installOwnerAuth } from "./auth.js";
import { PublicBusinessAssetImporter, publicListingIdentityMatches, type AssetResponse } from "./acquisition-assets.js";
import { installPublicBusinessAssetRoutes } from "./public-business-assets.js";
import { buildRuntime, type Runtime } from "./runtime.js";

const pageUrl = "https://directory.example.com/business/fixture-garden", photoUrl = "https://images.example.com/garden.jpg";
const businessName = "Fixture Garden Specialists (fictional)";
const image = { url: photoUrl, kind: "photo" as const, alt: "Fictional garden photograph" };
const png = (width = 640, height = 480) => { const bytes = Buffer.alloc(40); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes); bytes.write("IHDR", 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); return bytes; };
const response = (body: string | Uint8Array, type = "text/html"): AssetResponse => ({ status: 200, headers: { "content-type": type }, body: typeof body === "string" ? Buffer.from(body) : body });
const page = (content = `<img src="${photoUrl}" alt="Fictional garden project">`) => `<html><head><title>Fixture Garden Specialists | Berwick business profile</title></head><body>${content}</body></html>`;
const resolve = async () => [{ address: "93.184.216.34", family: 4 }];
const input = { businessName, sourcePageUrl: pageUrl, images: [image] };

describe("explicit public profile artwork", () => {
  it("uses page title identity rather than generic directory body matches", () => {
    expect(publicListingIdentityMatches(page(), businessName)).toBe(true);
    expect(publicListingIdentityMatches(`<title>All local businesses</title><p>${businessName}</p>`, businessName)).toBe(false);
    expect(publicListingIdentityMatches('<meta property="og:title" content="A&amp;S Garden Specialists Pty Ltd – Berwick">', "A&S Garden Specialists Pty Ltd")).toBe(true);
    for (const fragment of [
      '<!-- <title>Fixture Garden Specialists</title> -->',
      '<script>const fake = "<title>Fixture Garden Specialists</title>"</script>',
      '<style>.x{content:"<title>Fixture Garden Specialists</title>"}</style>',
      '<template><template></template><title>Fixture Garden Specialists</title></template>',
      '<noscript><meta property="og:title" content="Fixture Garden Specialists"></noscript>',
      '<svg><title>Fixture Garden Specialists</title></svg>',
      '<img alt="<title>Fixture Garden Specialists</title>">',
      '<body><meta property="og:title" content="Fixture Garden Specialists"></body>',
    ]) expect(publicListingIdentityMatches(`<html><head><title>Generic business directory</title></head>${fragment}</html>`, businessName), fragment).toBe(false);
  });

  it("imports only an explicitly selected linked raster with pinned DNS, hash and source provenance", async () => {
    const request = vi.fn(async (url: URL, _address: { address: string; family: number }) => url.href === pageUrl ? response(page()) : response(png(), "image/png"));
    const result = await new PublicBusinessAssetImporter({ resolve, request }).import(input);
    expect(result.images).toHaveLength(1); expect(result.logo).toBeUndefined();
    expect(result.sourceUrl).toBe(pageUrl); expect(result.images[0]).toMatchObject({ sourceUrl: photoUrl, width: 640, height: 480, mime: "image/png" });
    expect(result.images[0]?.sha256).toHaveLength(64); expect(result.images[0]?.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.notices.join(" ")).toContain("permission");
    expect(request).toHaveBeenCalledTimes(2); expect(request.mock.calls.every(call => call[1]?.address === "93.184.216.34")).toBe(true);
  });

  it("refuses unlinked, script-only, comment-only, advertising and unrelated profile images before downloading", async () => {
    for (const html of [page('<p>No picture here</p>'), page(`<script>const image='${photoUrl}'</script>`), page(`<!-- <img src="${photoUrl}"> -->`), page(`<template><template></template><img src="${photoUrl}"></template>`), page(`<img alt="<img src='${photoUrl}'>">`), page(`<img src="${photoUrl}" class="sponsored-advertisement">`), `<title>Different Garden Business</title><img src="${photoUrl}">`]) {
      const request = vi.fn(async () => response(html));
      await expect(new PublicBusinessAssetImporter({ resolve, request }).import(input)).rejects.toThrow();
      expect(request).toHaveBeenCalledTimes(1);
    }
  });

  it("recognises real source sets and metadata references without treating arbitrary hrefs as images", async () => {
    for (const html of [page(`<source srcset="${photoUrl} 1280w">`), page(`<meta property="og:image" content="${photoUrl}">`)]) {
      const request = vi.fn(async (url: URL) => url.href === pageUrl ? response(html) : response(png(), "image/png"));
      expect((await new PublicBusinessAssetImporter({ resolve, request }).import(input)).images).toHaveLength(1);
    }
    const request = vi.fn(async () => response(page(`<a href="${photoUrl}">Download unrelated content</a>`)));
    await expect(new PublicBusinessAssetImporter({ resolve, request }).import(input)).rejects.toThrow(/not linked/);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("denies private/mixed DNS and checks redirect DNS before a request", async () => {
    const request = vi.fn(async () => response(page()));
    for (const addresses of [[{ address: "169.254.169.254", family: 4 }], [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }]]) {
      await expect(new PublicBusinessAssetImporter({ resolve: async () => addresses, request }).import(input)).rejects.toThrow(/could not be read/);
      expect(request).not.toHaveBeenCalled();
    }
    const redirected = vi.fn(async () => ({ status: 302, headers: { location: "https://internal.example.com/" }, body: Buffer.alloc(0) }));
    await expect(new PublicBusinessAssetImporter({ resolve: async host => [{ address: host.startsWith("internal") ? "10.0.0.1" : "93.184.216.34", family: 4 }], request: redirected }).import(input)).rejects.toThrow(/could not be read/);
    expect(redirected).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid URLs/selection budgets before any network and respects explicit copying restrictions", async () => {
    const request = vi.fn(async () => response(page()));
    const importer = new PublicBusinessAssetImporter({ resolve, request });
    for (const images of [[{ ...image, url: "https://127.0.0.1/image.png" }], Array.from({ length: 5 }, (_, i) => ({ ...image, url: `${photoUrl}?n=${i}` })), [{ ...image, alt: "Photo\r\nHidden header" }], [image, image]]) await expect(importer.import({ ...input, images })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValue(response(page(`<p>You may not download or reproduce our images without permission.</p><img src="${photoUrl}">`)));
    await expect(importer.import(input)).rejects.toThrow(/restricts reproducing/);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("omits SVG, wrong MIME, excessive dimensions and oversized responses with honest notices", async () => {
    for (const asset of [response('<svg onload="fetch(secret)"/>', "image/svg+xml"), response(png(), "text/html"), response(png(6000, 6000), "image/png"), response(Buffer.alloc(900_001), "image/png")]) {
      const request = vi.fn(async (url: URL) => url.href === pageUrl ? response(page()) : asset);
      const result = await new PublicBusinessAssetImporter({ resolve, request }).import(input);
      expect(result.images).toEqual([]); expect(result.notices.join(" ")).toContain("not substituted");
    }
  });

  it("does not replace the recorded source with a canonical www alias or leak provider failures", async () => {
    const request = vi.fn(async (url: URL) => url.href === pageUrl ? { status: 301, headers: { location: pageUrl.replace("directory.", "www.directory.") }, body: Buffer.alloc(0) } : url.hostname.startsWith("www.") ? response(page()) : response(png(), "image/png"));
    expect((await new PublicBusinessAssetImporter({ resolve, request }).import(input)).sourceUrl).toBe(pageUrl);
    const failed = new PublicBusinessAssetImporter({ resolve, request: async () => { throw new Error("provider-secret-never-return"); } });
    await expect(failed.import(input)).rejects.not.toThrow(/provider-secret/);
  });

  it("bounds malformed inactive markup without accepting an image hidden in an unclosed comment", async () => {
    const html = '<title>Fixture Garden Specialists</title>' + '<!--'.repeat(180_000) + `<img src="${photoUrl}">`;
    const request = vi.fn(async () => response(html));
    const started = performance.now();
    await expect(new PublicBusinessAssetImporter({ resolve, request }).import(input)).rejects.toThrow(/not linked/);
    expect(request).toHaveBeenCalledTimes(1); expect(performance.now() - started).toBeLessThan(1000);
  });
});

const origin = "https://jarvis.example.test", ownerKey = "fictional-public-assets-owner-key-".repeat(2);
const runtimes: Runtime[] = [];
async function setup(importer: PublicBusinessAssetImporter, fake = false) {
  const rt = buildRuntime({ ATLAS_MODE: "fake", ATLAS_PUBLIC_ORIGIN: origin, ATLAS_OWNER_ACCESS_KEY: ownerKey }); runtimes.push(rt);
  rt.acquisition.saveSender({ name: "Owner (fictional)", organisation: "Studio (fictional)", email: "owner@studio.example.test", contactDetails: "Reply to owner@studio.example.test" }, "Owner (fictional)");
  const record = rt.acquisition.addLead({ businessName, location: "Berwick (fictional)", industry: "Garden maintenance", website: null, sourceUrl: pageUrl, observation: "Fictional public profile source. No website absence or consent is proved.", services: ["Hedge trimming"], address: "1 Fictional Street, Berwick", phone: "(03) 0000 0000" });
  // Exercise the live route boundary with injected transport only; never a real source request.
  if (!fake) { rt.mode = "live"; const p = rt.atlas.prospects.require(record.prospectId); p.fixture = false; rt.atlas.deps.store.upsertDoc("prospects", p.id, p); }
  const app = new Hono(); installOwnerAuth(app, rt, { ownerAccessKey: ownerKey, publicOrigin: origin }); installPublicBusinessAssetRoutes(app, rt, importer);
  const login = await app.request(origin + "/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ accessKey: ownerKey }) });
  const cookie = /__Host-atlas_session=[a-f0-9]{64}/.exec(login.headers.get("set-cookie") ?? "")![0];
  const path = `/api/acquisition/leads/${record.id}/public-assets`;
  const post = (body: unknown = { sourcePageUrl: pageUrl, images: [image] }) => app.request(origin + path, { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { rt, app, record, cookie, path, post };
}
afterEach(() => { for (const rt of runtimes.splice(0)) rt.atlas.deps.store.close(); vi.restoreAllMocks(); });

describe("private public-profile artwork route", () => {
  it("requires owner authentication and same-origin JSON and never contacts a source from fake mode", async () => {
    const request = vi.fn(async () => response(page()));
    const s = await setup(new PublicBusinessAssetImporter({ resolve, request }), true);
    expect((await s.app.request(origin + s.path, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await s.app.request(origin + s.path, { method: "POST", headers: { Cookie: s.cookie, Origin: "https://attacker.example.com", "Content-Type": "application/json" }, body: "{}" })).status).toBe(403);
    expect((await s.app.request(origin + s.path, { method: "POST", headers: { Cookie: s.cookie, Origin: origin, "Content-Type": "text/plain" }, body: "{}" })).status).toBe(415);
    expect((await s.post()).status).toBe(409); expect(request).not.toHaveBeenCalled();
  });

  it("merges verified artwork while preserving sourced facts and returns summaries without image bytes", async () => {
    const request = vi.fn(async (url: URL) => url.href === pageUrl ? response(page()) : response(png(), "image/png"));
    const s = await setup(new PublicBusinessAssetImporter({ resolve, request }));
    const result = await s.post(); expect(result.status).toBe(200);
    const data = await result.json(); expect(data.imported).toMatchObject({ sourceUrl: pageUrl, logoCount: 0, photoCount: 1 });
    expect(data.record.businessProfile).toMatchObject({ address: "1 Fictional Street, Berwick", phone: "(03) 0000 0000", services: ["Hedge trimming"] });
    expect(data.record.businessProfile.images).toHaveLength(1); expect(JSON.stringify(data)).not.toContain("data:image");
    expect(s.rt.fakes.mailer.sent).toHaveLength(0); expect(s.rt.atlas.jobs.list()).toHaveLength(0); expect(data.record.demo).toBeNull();
  });

  it("rejects source substitutions, existing sites and malformed fields before requesting a page", async () => {
    const request = vi.fn(async () => response(page()));
    const s = await setup(new PublicBusinessAssetImporter({ resolve, request }));
    expect((await s.post({ sourcePageUrl: "https://directory.example.com/another-business", images: [image] })).status).toBe(409);
    expect((await s.post({ sourcePageUrl: pageUrl, images: [image], approved: true })).status).toBe(400);
    const changed = { ...s.record, website: "https://official.example.com/" }; s.rt.atlas.deps.store.upsertDoc("acquisition_records", changed.id, changed);
    expect((await s.post()).status).toBe(409); expect(request).not.toHaveBeenCalled();
  });

  it("refuses stale imports when the owner edits a draft during the source request", async () => {
    let release!: () => void, started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { started = resolve; });
    const request = vi.fn(async (url: URL) => { if (url.href === pageUrl) { started(); await held; return response(page()); } return response(png(), "image/png"); });
    const s = await setup(new PublicBusinessAssetImporter({ resolve, request }));
    const prepared = s.rt.acquisition.prepare(s.record.id, { templateId: "clarity" });
    const pending = s.post(); await ready;
    const edited = s.rt.acquisition.saveDraft(prepared.id, { expectedHash: prepared.draft!.contentHash, subject: "Owner-written fictional subject", text: prepared.draft!.text + "\nMy own note must remain." });
    release(); const result = await pending; expect(result.status).toBe(409);
    const current = s.rt.atlas.deps.store.getDoc<AcquisitionRecord>("acquisition_records", edited.id)!.doc;
    expect(current.draft?.text).toContain("My own note must remain."); expect(current.businessProfile?.images).toEqual([]);
    expect(s.rt.fakes.mailer.sent).toHaveLength(0);
  });

  it("refuses an import when the prospect gains an official website during the source request", async () => {
    let release!: () => void, started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { started = resolve; });
    const request = vi.fn(async (url: URL) => { if (url.href === pageUrl) { started(); await held; return response(page()); } return response(png(), "image/png"); });
    const s = await setup(new PublicBusinessAssetImporter({ resolve, request }));
    const pending = s.post(); await ready;
    const prospect = s.rt.atlas.prospects.require(s.record.prospectId); prospect.website = "https://official.example.com/";
    s.rt.atlas.deps.store.upsertDoc("prospects", prospect.id, prospect);
    release(); expect((await pending).status).toBe(409);
    const current = s.rt.atlas.deps.store.getDoc<AcquisitionRecord>("acquisition_records", s.record.id)!.doc;
    expect(current.businessProfile?.images).toEqual([]); expect(current.demo).toBeNull(); expect(s.rt.fakes.mailer.sent).toHaveLength(0);
  });
});

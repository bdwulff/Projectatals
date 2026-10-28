import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import { exportDemoReactProject, renderDemoWebsite, type DemoBusinessInput } from "../src/acquisition/demo-renderer.js";
import type { BusinessImage, BusinessProfile } from "../src/acquisition/business-profile.js";

const base: DemoBusinessInput = {
  businessName: "Boundary Works (fictional)", location: "Berwick, Victoria", industry: "Carpentry and fencing",
  services: ["Timber fencing", "Outdoor decking", "Custom gates"], templateId: "immersive", fixture: true,
  studio: { name: "Review Digital (fictional)", website: "https://studio.example.com/" },
};
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4N0AAAAASUVORK5CYII=", "base64");
const image = (alt: string): BusinessImage => ({ dataUrl: `data:image/png;base64,${pixel.toString("base64")}`, sourceUrl: "https://business.example.com/test-assets/photo.png", alt, mime: "image/png", sha256: createHash("sha256").update(pixel).digest("hex"), width: 1, height: 1 });
const profile = (): BusinessProfile => ({ state: "fictional", detail: "Injected fictional public source, no live website was fetched.", sourceUrl: "https://business.example.com/", fetchedAt: "2026-10-28T00:00:00Z", description: "A fictional source description of timber and outdoor work.", address: "10 Fictional Lane, Berwick", phone: "+61 3 9000 0000", services: ["Timber fencing"], logo: image("Fictional logo"), images: [image("First fictional source photo"), image("Second fictional source photo"), image("Third fictional source photo")], notices: ["Fictional test images; no business branding rights asserted."] });

describe("business-specific immersive design", () => {
  it("is a pure stable design for the same facts, without mutating the supplied business", () => {
    const input = { ...base, services: [...base.services!] }, before = JSON.stringify(input);
    const first = renderDemoWebsite(input), second = renderDemoWebsite({ ...input, services: [...input.services] });
    expect(first).toEqual(second); expect(JSON.stringify(input)).toBe(before);
    expect(first.templateId).toBe("immersive"); expect(first.designBrief).toBeTruthy();
    expect(first.contentHash).toBe(createHash("sha256").update(first.html).digest("hex"));
    expect(Object.isFrozen(first)).toBe(true); expect(first.externalAssets).toEqual([]);
  });

  it.each([
    ["Automotive detailing", "automotive"], ["Garden maintenance", "craft"],
    ["Fitness and personal training", "movement"], ["Cafe and hospitality", "editorial"],
  ])("gives %s its own art direction", (industry, family) => {
    const result = renderDemoWebsite({ ...base, industry });
    expect(result.designBrief?.family).toBe(family);
    expect(result.html).toContain("Boundary Works (fictional)");
    expect(result.html).toContain("FICTIONAL TEST RECORD");
  });

  it.each([
    ["Garden maintenance and lawn mowing", "photographic-garden"],
    ["Hair salon and styling", "photographic-salon"],
    ["Malaysian restaurant and cafe", "photographic-restaurant"],
  ])("uses appropriate licensed illustrative photographs for %s", (industry, motif) => {
    const result = renderDemoWebsite({ ...base, industry });
    expect(result.designBrief?.motif).toBe(motif);
    expect(result.designBrief).toMatchObject({placeholderPhotoCount: 4, businessPhotoCount: 0, logoKind: "concept"});
    expect(result.html).toContain("Illustrative stock photograph");
    expect(new Set(Array.from(result.html.matchAll(/src="(data:image\/jpeg;base64,[^"]+)"/g), m => m[1])).size).toBe(4);
  });

  it.each(["Plumbing and roofing", "Cleaning services", "Accounting", "Carpentry and fencing"])("uses neutral copy and photographs for unsupported %s", industry => {
    const result = renderDemoWebsite({ ...base, industry });
    expect(result.designBrief?.sector).toBe("professional");
    expect(result.html).not.toMatch(/Good gardens|GARDEN &amp; OUTDOOR|Your familiar corner|COFFEE &amp; GOOD COMPANY/);
    expect(result.html).toContain("Timber fencing");
  });

  it("varies composition as well as colour between businesses in the same industry", () => {
    const results = Array.from({ length: 18 }, (_, index) => renderDemoWebsite({ ...base, businessName: `Fictional carpentry studio ${index}` }));
    expect(new Set(results.map(result => result.designBrief?.layout)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(results.map(result => JSON.stringify(result.designBrief?.palette))).size).toBeGreaterThanOrEqual(2);
    expect(new Set(results.map(result => result.designBrief?.id)).size).toBe(results.length);
  });

  it("keeps a script-free, offline preview with a hash-bound stylesheet and native interaction", () => {
    const result = renderDemoWebsite(base), css = result.html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    expect(css).toBeTruthy();
    expect(result.contentSecurityPolicy).toContain(`style-src 'sha256-${createHash("sha256").update(css!).digest("base64")}'`);
    for (const permission of ["script-src 'none'", "connect-src 'none'", "form-action 'none'", "font-src 'none'"]) expect(result.contentSecurityPolicy).toContain(permission);
    expect(result.html).not.toMatch(/<script\b|<iframe\b|<form\b|<input\b|<audio\b|<video\b|\son[a-z]+\s*=/i);
    expect(css).not.toMatch(/@import|url\s*\(\s*["']?https?:/i);
    expect(result.html).toMatch(/<details\b/); expect(result.html).toMatch(/<summary\b/);
    expect(result.html).toContain("#services"); expect(css).toContain("prefers-reduced-motion");
  });

  it("escapes hostile source facts as data in HTML and editable JSX", () => {
    const attack = '</style><script>fetch("https://evil.test")</script>';
    const input = { ...base, businessName: attack, location: attack, services: [attack] };
    const result = renderDemoWebsite(input), files = exportDemoReactProject(input);
    expect(result.html).not.toContain(attack); expect(result.html).toContain("&lt;/style&gt;&lt;script&gt;");
    expect((result.html.match(/<style>/g) ?? []).length).toBe(1);
    expect((result.html.match(/<\/style>/g) ?? []).length).toBe(1);
    expect(result.html).not.toContain("<script>");
    const app = files["src/App.tsx"]!;
    expect(app).not.toMatch(/dangerouslySetInnerHTML|srcDoc|<iframe\b|\beval\s*\(/);
    const compiled = ts.transpileModule(app, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
    expect(compiled.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
    expect(compiled.outputText).not.toContain("<script>");
  });

  it("does not invent services, customer proof, street address or business photography", () => {
    const result = renderDemoWebsite({ ...base, services: undefined, businessProfile: undefined });
    expect(result.html).not.toMatch(/testimonial|rated\s*5|trusted by\s*\d|\d+\+\s*years/i);
    expect(result.designBrief).toMatchObject({placeholderPhotoCount: 4, businessPhotoCount: 0, logoKind: "concept"});
    expect(result.html).toContain("Illustrative placeholder photographs");
    expect(result.html).toMatch(/original|conceptual/i);
    expect(result.html).not.toContain("10 Fictional Lane");
    expect(result.html).not.toContain("Timber fencing");
  });

  it("presents sourced business content in the main site instead of template design rationale", () => {
    const facts = { ...profile(), logo: undefined, images: [] };
    const result = renderDemoWebsite({ ...base, businessProfile: facts });
    const main = result.html.split('<main id="main">')[1]!.split('<section id="about-concept"')[0]!;
    expect(main).toContain(facts.description!);
    expect(main).toContain("Timber fencing");
    expect(main).toContain("Boundary Works (fictional)");
    expect(main).not.toMatch(/A focused introduction to|A considered digital introduction to|Space for the business’s own story|A distinct identity\.|An independent visual direction for|Contact information shown for this private concept/i);
    expect(result.html).toContain("About this independent concept &amp; sources");
    expect(result.html).toContain("not Boundary Works (fictional)’s official website");
  });

  it("uses only validated embedded business raster images and retains source credits in preview and export", () => {
    const input = { ...base, businessProfile: profile() }, rendered = renderDemoWebsite(input), files = exportDemoReactProject(input);
    expect(rendered.html).toContain("data:image/png;base64,");
    expect(rendered.html).toContain("https://business.example.com/test-assets/photo.png");
    expect(rendered.html).not.toMatch(/<img[^>]+src="https?:/i);
    expect(rendered.html).toContain("10 Fictional Lane, Berwick");
    const source = Object.values(files).join("\n");
    expect(source).toContain("data:image/png;base64,");
    expect(source).toContain("https://business.example.com/test-assets/photo.png");
    expect(source).toContain("Boundary Works (fictional)");
    expect(source).toContain(rendered.designBrief!.id);
    expect(files["src/App.tsx"]).not.toContain("dangerouslySetInnerHTML");
  });

  it("refuses imported SVGs and forged embedded image hashes", () => {
    const source = profile();
    source.logo = { ...image("Forged asset"), sha256: "f".repeat(64) };
    source.images = [{ ...image("SVG attack"), dataUrl: "data:image/svg+xml;base64," + Buffer.from('<svg onload="fetch()"/>').toString("base64"), mime: "image/svg+xml" as "image/png" }];
    const result = renderDemoWebsite({ ...base, businessProfile: source });
    expect(result.html).not.toContain("data:image/svg");
    expect(result.html).not.toContain("Forged asset");
    expect(result.html).not.toContain("SVG attack");
    expect(result.designBrief).toMatchObject({businessPhotoCount: 0, logoKind: "concept"});
    expect(result.html).toContain("data:image/jpeg;base64,");
  });
});

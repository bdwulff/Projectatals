import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { exportDemoReactProject, renderDemoWebsite, safeDemoWebsite, type DemoBusinessInput } from "../src/acquisition/demo-renderer.js";
import { DEMO_TEMPLATES, getDemoTemplate, selectDemoTemplate } from "../src/acquisition/templates.js";
import type { BusinessImage, BusinessProfile } from "../src/acquisition/business-profile.js";

const business: DemoBusinessInput = {
  businessName: "Example Fencing (fictional)", location: "Berwick, Victoria", industry: "Fencing and timber trades",
  services: ["Timber fencing", "Gate installation", "Repairs"], fixture: true,
};

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4N0AAAAASUVORK5CYII=", "base64");
const image = (alt = "A business photograph"): BusinessImage => ({
  dataUrl: `data:image/png;base64,${png.toString("base64")}`, mime: "image/png", sha256: createHash("sha256").update(png).digest("hex"),
  width: 1, height: 1, alt, sourceUrl: "https://business.com/images/official-photo.png?tracking=removed",
});
const profile = (): BusinessProfile => ({
  state: "ready", detail: "Public details and raster images sourced from the business website.", sourceUrl: "https://business.com/", fetchedAt: "2026-10-26T00:00:00.000Z",
  description: "The business provides fencing and gate installation in Berwick.", address: "10 Sample Road, Berwick VIC 3806", phone: "+61 3 9000 0000",
  services: ["Gate installation"], logo: image("Business logo"), images: [image("The business’s first photo"), image("The business’s second photo"), image("The business’s third photo")], notices: [],
});

describe("free-template concept renderer", () => {
  it("renders deterministic immutable concepts with honest origin, source licences and fictional notice", () => {
    const first = renderDemoWebsite(business);
    expect(first).toEqual(renderDemoWebsite({ ...business, services: [...business.services!] }));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.template)).toBe(true);
    expect(Object.isFrozen(first.externalAssets)).toBe(true);
    expect(first.contentHash).toBe(createHash("sha256").update(first.html).digest("hex"));
    expect(first.html).toContain("Independent website concept by Wulff Studio • Not the business's official website");
    expect(first.html).toContain("FICTIONAL TEST RECORD");
    expect(first.html).toContain("noindex,nofollow,noarchive");
    expect(first.html).toContain(first.template.inspiration.sourceUrl);
    expect(first.html).toContain(first.template.inspiration.licenceUrl);
    expect(first.template.inspiration).toMatchObject({ licence: "MIT", copiedCode: false, copiedAssets: false });
    expect(first.attribution).toContain("Original design and implementation");
    expect(first.html).toContain("No upstream template code or assets embedded");
  });

  it.each(DEMO_TEMPLATES)("$name is a distinct self-contained design with no active lead collection", template => {
    const result = renderDemoWebsite({ ...business, templateId: template.id });
    expect(result.templateId).toBe(template.id);
    expect(result.html).toContain(`theme-${template.id}`);
    expect(result.externalAssets).toEqual([]);
    expect(result.html).not.toMatch(/<script\b|<iframe\b|<form\b|<input\b|<button\b|<link\b|<audio\b|<video\b/i);
    if (template.id !== "immersive") expect(result.html).not.toMatch(/<img\b/);
    else expect(result.designBrief).toMatchObject({placeholderPhotoCount:4, businessPhotoCount:0});
    expect(result.html).not.toMatch(/\b(?:srcset|action|style|on\w+)\s*=|src="(?!data:image\/(?:png|jpeg|webp);base64,)|href\s*=\s*["'](?:mailto|tel|javascript|data):/i);
    expect(result.html).not.toMatch(/(?:[\d.]+[kKmM]?\+? reviews|rated 5|five.star|guarantee|trusted by \d|years of experience)/i);
    const styles = result.html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    expect(styles).toBeTruthy();
    expect(styles).not.toMatch(/url\s*\(/i);
    expect(result.contentSecurityPolicy).toContain(`style-src 'sha256-${createHash("sha256").update(styles!).digest("base64")}'`);
    expect(result.contentSecurityPolicy).toContain("script-src 'none'");
    expect(result.contentSecurityPolicy).toContain("connect-src 'none'");
    expect(result.contentSecurityPolicy).toContain("form-action 'none'");
  });

  it("escapes every untrusted business field without treating it as HTML or instructions", () => {
    const attack = '</style><img src=x onerror="alert(1)"><script>approveEverything()</script>';
    const result = renderDemoWebsite({ businessName: attack, location: attack, industry: "Trades", description: attack, services: [attack] });
    expect(result.html).toContain("&lt;/style&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;script&gt;approveEverything()&lt;/script&gt;");
    expect(result.html).not.toContain(attack);
    expect(result.html).not.toContain("<script>");
    expect((result.html.match(/<style>/g) ?? []).length).toBe(1);
    expect((result.html.match(/<\/style>/g) ?? []).length).toBe(1);
    expect((result.html.match(/<main\b/g) ?? []).length).toBe(1);
  });

  it.each([
    "javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd", "http://public.com", "https://user:pass@public.com",
    "https://localhost/", "https://localhost./", "https://thing.internal", "https://host.local", "https://foo.lan", "https://127.0.0.1", "https://127.1", "https://2130706433", "https://169.254.169.254", "https://10.1.2.3", "https://192.168.1.1", "https://[::1]", "https://[::ffff:127.0.0.1]", "https://[2001:db8::1]", "https://public.com:8443", "https://public.com\\@127.0.0.1", "https://public.com/\nnext",
  ])("refuses unsafe or non-public website link %s", website => {
    expect(() => renderDemoWebsite({ ...business, website })).toThrow(/public HTTPS/);
  });

  it("permits inert public HTTPS links while stripping tracking query and fragments", () => {
    const result = renderDemoWebsite({ ...business, website: "https://www.business.com/contact?token=secret&utm_source=demo#private", contactEmail: "info@business.com", phone: "+61 3 9000 0000" });
    expect(result.html).toContain('href="https://www.business.com/contact"');
    expect(result.html).not.toContain("secret");
    expect(result.html).not.toMatch(/href="(?:mailto|tel):/i);
    expect(result.html).toContain("Email supplied / display only");
    expect(result.html).toContain("Phone supplied / display only");
    expect(safeDemoWebsite(null)).toBeNull();
    expect(safeDemoWebsite("https://8.8.8.8/")).toBe("https://8.8.8.8/");
  });

  it("never invents a service list or fictitious customer proof when research has no services", () => {
    const result = renderDemoWebsite({ businessName: "Real Business", location: "Officer", industry: "Professional services" });
    expect(result.html).toContain("Service information has not been verified");
    expect(result.html).not.toContain('class="service-row"');
    expect(result.html).not.toContain("FICTIONAL TEST RECORD");
    expect(result.html).not.toMatch(/<form|<input|testimonial|customer review/i);
  });

  it("bounds text, service counts and structured contact details", () => {
    expect(() => renderDemoWebsite({ ...business, businessName: "" })).toThrow();
    expect(() => renderDemoWebsite({ ...business, businessName: "a".repeat(161) })).toThrow();
    expect(() => renderDemoWebsite({ ...business, services: Array(9).fill("Fencing") })).toThrow(/eight/);
    expect(() => renderDemoWebsite({ ...business, services: ["\u0000unsafe"] })).toThrow(/control/);
    expect(() => renderDemoWebsite({ ...business, contactEmail: 'customer@test.com" onmouseover="x' })).toThrow(/email/);
    expect(() => renderDemoWebsite({ ...business, phone: 'javascript:alert(1)' })).toThrow(/telephone/);
    expect(() => renderDemoWebsite({ ...business, templateId: "unknown" as "fieldwork" })).toThrow(/Unknown/);
  });

  it("preserves industry choices and keeps every explicit design direction distinct", () => {
    expect(selectDemoTemplate("Plumbing").id).toBe("fieldwork");
    expect(selectDemoTemplate("Personal training").id).toBe("momentum");
    expect(selectDemoTemplate("Accounting").id).toBe("folio");
    expect(new Set(DEMO_TEMPLATES.map(template => renderDemoWebsite({ ...business, templateId: template.id }).contentHash)).size).toBe(DEMO_TEMPLATES.length);
    expect(getDemoTemplate("fieldwork").inspiration.name).toBe("ScrewFast");
  });

  it.each(DEMO_TEMPLATES)("$name embeds sourced branding and photos with factual details and explicit provenance", template => {
    const result = renderDemoWebsite({ ...business, templateId: template.id, businessProfile: profile() });
    if (template.id === "immersive") {
      expect(result.html).toContain('class="sp-business-logo im-logo"');
      expect(result.html).toContain('class="sp-gallery-photo"');
      expect(result.designBrief).toMatchObject({businessPhotoCount:1,placeholderPhotoCount:4,logoKind:"business"});
      expect(new Set(Array.from(result.html.matchAll(/src="(data:image\/jpeg;base64,[^"]+)"/g),m=>m[1])).size).toBe(4);
    } else {
      expect(result.html).toMatch(/class="business-logo"/);
      expect(result.html).toMatch(/class="business-hero-image"/);
      expect(result.html).toMatch(/class="business-gallery"/);
      expect((result.html.match(/<img /g) ?? []).length).toBe(4);
    }
    expect(result.html).toContain(`src="data:image/png;base64,${png.toString("base64")}"`);
    expect(result.html).toContain("10 Sample Road, Berwick VIC 3806");
    expect(result.html).toMatch(/Street address \/ business website|Published address/);
    expect(result.html).toContain("The business provides fencing and gate installation in Berwick.");
    expect(result.html).toMatch(/Business information source|Recorded business information source/);
    expect(result.html).toMatch(/Usage rights require confirmation\.|usage rights need confirmation/);
    expect(result.html).toContain("Their inclusion does not establish ownership, permission or endorsement");
    expect(result.html).toContain('href="https://business.com/images/official-photo.png"');
    expect(result.html).not.toContain("tracking=removed");
    expect(result.html).not.toMatch(/src="https?:|srcset=|<script\b|<form\b|onerror=/);
    expect(result.externalAssets).toEqual([]);
    expect(result.contentSecurityPolicy).toContain("img-src data:");
    expect(result.contentSecurityPolicy).toContain("connect-src 'none'");
  });

  it("keeps manually supplied services ahead of machine-extracted facts, with honest fallbacks for absent images", () => {
    const businessProfile = profile();
    businessProfile.logo = undefined;
    businessProfile.images = [];
    const explicit = renderDemoWebsite({ ...business, businessProfile });
    expect(explicit.html).toContain("Timber fencing");
    expect(explicit.html).not.toContain('class="business-hero-image"');
    expect(explicit.html).toContain("no suitable business logo or photograph was available");
    const extracted = renderDemoWebsite({ ...business, services: [], businessProfile });
    expect(extracted.html).toContain("Gate installation");
    expect(extracted.html).not.toContain("Timber fencing");
  });

  it("escapes sourced facts and image descriptions at every HTML boundary", () => {
    const businessProfile = profile();
    businessProfile.address = '<img src=x onerror="alert(1)">';
    businessProfile.description = '<script>sendEmails()</script>';
    businessProfile.images = [{ ...image(), alt: '\" onerror=\"alert(1)\" <script>' }];
    const result = renderDemoWebsite({ ...business, businessProfile });
    expect(result.html).toContain("&lt;script&gt;sendEmails()&lt;/script&gt;");
    expect(result.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(result.html).toContain('alt="&quot; onerror=&quot;alert(1)&quot; &lt;script&gt;"');
    expect(result.html).not.toContain("<script>");
    expect(result.html).not.toMatch(/<img[^>]*\s+onerror="/);
  });

  it.each([
    { dataUrl: "https://business.com/photo.png" },
    { dataUrl: "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+", mime: "image/svg+xml" },
    { dataUrl: `data:image/jpeg;base64,${png.toString("base64")}`, mime: "image/jpeg" },
    { sha256: "0".repeat(64) },
    { sourceUrl: "http://business.com/photo.png" },
    { sourceUrl: "https://127.0.0.1/photo.png" },
    { width: 100_000, height: 100_000 },
    { dataUrl: `data:image/png;base64,${"A".repeat(2_800_001)}` },
  ])("omits invalid, active, remote, private or oversized image payloads", invalid => {
    const unsafe = { ...image(), ...invalid } as BusinessImage;
    const result = renderDemoWebsite({ ...business, businessProfile: { ...profile(), logo: unsafe, images: [unsafe] } });
    expect(result.html).not.toContain("<img ");
    expect(result.html).toContain("Original illustration / Wulff Studio");
    expect(result.externalAssets).toEqual([]);
  });

  it("changes the exact concept hash when its business imagery or sourced address changes", () => {
    const original = profile();
    const first = renderDemoWebsite({ ...business, businessProfile: original });
    expect(renderDemoWebsite({ ...business, businessProfile: { ...original, address: "11 Sample Road, Berwick VIC 3806" } }).contentHash).not.toBe(first.contentHash);
    expect(renderDemoWebsite({ ...business, businessProfile: { ...original, images: [] } }).contentHash).not.toBe(first.contentHash);
  });

  it("keeps Apple visual inspiration separate from upstream code licences and honours reduced motion", () => {
    const result = renderDemoWebsite({ ...business, templateId: "clarity" });
    expect(result.template.visualReference).toEqual({ name: "Apple", sourceUrl: "https://www.apple.com/", copiedCode: false, copiedAssets: false });
    expect(Object.isFrozen(result.template.visualReference)).toBe(true);
    expect(result.template.inspiration.licence).toBe("MIT");
    expect(result.template.inspiration.name).toBe("Landwind");
    expect(result.html).toContain("No Apple code, assets or affiliation.");
    expect(result.html).toContain("font-family:-apple-system,BlinkMacSystemFont");
    expect(result.html).toContain("@media(prefers-reduced-motion:reduce)");
    expect(result.html).toContain(".clarity-arrive{animation:none}");
    expect(result.html).toContain("Original abstract illustration");
  });

  it("renders the owner-selected studio identity and website without changing business facts", () => {
    const result = renderDemoWebsite({ ...business, templateId: "clarity", studio: { name: "Wulff Digital", website: "https://wulffdigital.com/?token=remove" }, businessProfile: profile() });
    expect(result.html).toContain("Independent website concept by Wulff Digital");
    expect(result.html).toContain('href="https://wulffdigital.com/"');
    expect(result.html).toContain(">wulffdigital.com</a>");
    expect(result.html).not.toContain("token=remove");
    expect(result.html).not.toContain("Wulff Studio");
    expect(result.html).toContain(business.businessName);
    expect(result.html).toContain("10 Sample Road, Berwick VIC 3806");
    expect(result.html).toContain("Business information source ↗");
    expect(() => renderDemoWebsite({ ...business, templateId: "clarity", studio: { name: "Wulff", website: "javascript:send()" } })).toThrow(/public HTTPS/);
  });

  it("escapes hostile Clarity branding and business fields and binds the exact result to its hash", () => {
    const attack = '</h1><script>send()</script><img src=x onerror="steal()">';
    const result = renderDemoWebsite({ ...business, templateId: "clarity", businessName: attack, studio: { name: attack, website: "https://wulffdigital.com/" }, businessProfile: { ...profile(), description: attack, address: attack } });
    expect(result.html).not.toContain("<script>");
    expect(result.html).not.toContain(attack);
    expect(result.html).toContain("&lt;script&gt;send()&lt;/script&gt;");
    expect(result.html).not.toMatch(/<img[^>]*\s+onerror=["']/);
    const normal = renderDemoWebsite({ ...business, templateId: "clarity", studio: { name: "Wulff Digital", website: "https://wulffdigital.com/" } });
    expect(normal.contentHash).not.toBe(result.contentHash);
  });
});

describe("editable Clarity React source", () => {
  const input: DemoBusinessInput = { ...business, templateId: "clarity", studio: { name: "Wulff Digital", website: "https://wulffdigital.com/" } };

  it("exports a deterministic runnable React/Vite project with real components and no paid service calls", () => {
    const result = exportDemoReactProject({ ...input, businessProfile: profile() });
    expect(result).toEqual(exportDemoReactProject({ ...input, businessProfile: profile() }));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result).sort()).toEqual(["README.md", "index.html", "package.json", "src/App.tsx", "src/index.css", "src/main.tsx", "tsconfig.json", "vite.config.ts"]);
    expect(JSON.parse(result["package.json"]!)).toMatchObject({ private: true, dependencies: { react: "18.3.1", "react-dom": "18.3.1" }, scripts: { dev: "vite --host 127.0.0.1", build: "tsc --noEmit && vite build" } });
    expect(result["src/App.tsx"]).toContain("function Hero()");
    expect(result["src/App.tsx"]).toContain("function Services()");
    expect(result["src/App.tsx"]).toContain("export default function App()");
    expect(result["src/App.tsx"]).not.toMatch(/dangerouslySetInnerHTML|<iframe|srcDoc|fetch\(|XMLHttpRequest|ELEVENLABS|LOVABLE_API/);
    expect(result["src/App.tsx"]).toContain("data:image/png;base64,");
    expect(result["src/App.tsx"]).toContain("10 Sample Road, Berwick VIC 3806");
    expect(result["README.md"]).toContain("not an iframe wrapper, Lovable-generated output");
    expect(result["README.md"]).toContain("FICTIONAL TEST RECORD");
    expect(result["README.md"]).toContain("Publishing, sending email or connecting a domain is a separate owner decision");
  });

  it("keeps hostile input in JSON data and escaped title rather than executable JSX or HTML", () => {
    const attack = '</script><script>sendSecrets()</script>${send()}";import("evil")';
    const result = exportDemoReactProject({ ...input, businessName: attack, studio: { name: attack, website: "https://wulffdigital.com/" }, description: attack });
    expect(result["index.html"]).not.toContain(attack);
    expect(result["index.html"]).toContain("&lt;/script&gt;&lt;script&gt;sendSecrets()");
    expect(result["src/App.tsx"]).toContain("\\u003c/script>\\u003cscript>sendSecrets()");
    expect(result["src/App.tsx"]).not.toContain("</script><script>");
    expect(result["src/App.tsx"]).not.toContain('";import("evil")');
    expect(result["src/App.tsx"]).toContain("<h1>{data.businessName}");
    expect(result["src/App.tsx"]).toContain("<strong>Independent website concept by {data.studioName}");
    expect(result["README.md"]).not.toContain(attack);
  });

  it("omits active or invalid image payloads and rejects mismatched legacy template exports", () => {
    const unsafe = { ...image(), dataUrl: "data:image/svg+xml;base64,PHN2Zy8+", mime: "image/svg+xml" } as unknown as BusinessImage;
    const result = exportDemoReactProject({ ...input, businessProfile: { ...profile(), logo: unsafe, images: [unsafe] } });
    expect(result["src/App.tsx"]).not.toContain("data:image/svg+xml");
    expect(result["src/App.tsx"]).toContain('"images": []');
    expect(result["src/App.tsx"]).toContain('"logo": null');
    expect(() => exportDemoReactProject({ ...input, templateId: "fieldwork" })).toThrow(/Build a Clarity concept/);
    expect(() => exportDemoReactProject({ ...input, templateId: "momentum" })).toThrow(/Build a Clarity concept/);
    expect(() => exportDemoReactProject({ ...input, templateId: "folio" })).toThrow(/Build a Clarity concept/);
  });

  it("exports the same Clarity style sheet as the protected preview and a separate valid React entry point", () => {
    const result = exportDemoReactProject(input);
    const rendered = renderDemoWebsite(input);
    expect(result["src/index.css"]).toBe(rendered.html.match(/<style>([\s\S]*?)<\/style>/)?.[1]);
    expect(result["index.html"]).toContain('class="theme-clarity"');
    expect(result["index.html"]).toContain('<script type="module" src="/src/main.tsx"></script>');
    expect(result["src/main.tsx"]).toContain('ReactDOM.createRoot(document.getElementById("root")!)');
    expect(result["src/index.css"]).not.toMatch(/@import|url\(\s*["']?https?:/);
  });
});

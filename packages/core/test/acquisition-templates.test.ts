import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderDemoWebsite, safeDemoWebsite, type DemoBusinessInput } from "../src/acquisition/demo-renderer.js";
import { DEMO_TEMPLATES, getDemoTemplate, selectDemoTemplate } from "../src/acquisition/templates.js";

const business: DemoBusinessInput = {
  businessName: "Example Fencing (fictional)", location: "Berwick, Victoria", industry: "Fencing and timber trades",
  services: ["Timber fencing", "Gate installation", "Repairs"], fixture: true,
};

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
    expect(result.html).toContain(`class="theme-${template.id}"`);
    expect(result.externalAssets).toEqual([]);
    expect(result.html).not.toMatch(/<script\b|<iframe\b|<form\b|<input\b|<button\b|<img\b|<link\b|<audio\b|<video\b/i);
    expect(result.html).not.toMatch(/\b(?:src|srcset|action|style|on\w+)\s*=|href\s*=\s*["'](?:mailto|tel|javascript|data):/i);
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

  it("uses factual industry categories to choose three genuinely different directions", () => {
    expect(selectDemoTemplate("Plumbing").id).toBe("fieldwork");
    expect(selectDemoTemplate("Personal training").id).toBe("momentum");
    expect(selectDemoTemplate("Accounting").id).toBe("folio");
    expect(new Set(DEMO_TEMPLATES.map(template => renderDemoWebsite({ ...business, templateId: template.id }).contentHash)).size).toBe(3);
    expect(getDemoTemplate("fieldwork").inspiration.name).toBe("ScrewFast");
  });
});

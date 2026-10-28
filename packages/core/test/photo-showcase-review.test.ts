import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import { exportDemoReactProject, renderDemoWebsite, type DemoBusinessInput } from "../src/acquisition/demo-renderer.js";
import { getStockPhotos } from "../src/acquisition/stock-photos.js";

const cases = [
  { sector: "automotive", name: "Night Glass Detailing (fictional)", industry: "Automotive detailing", services: ["Interior detailing", "Ceramic coatings", "Headlight restoration"] },
  { sector: "garden", name: "Moss & Field Gardens (fictional)", industry: "Garden and landscape maintenance", services: ["Lawn mowing", "Hedging and pruning", "Garden clean-ups"] },
  { sector: "salon", name: "Linen Salon (fictional)", industry: "Hair salon and beauty", services: ["Hair cutting", "Hair colouring", "Balayage"] },
  { sector: "fitness", name: "Forge Boxing (fictional)", industry: "Gym and group fitness", services: ["Personal training", "Boxing and boxfit", "Strength training"] },
  { sector: "cafe", name: "Morning Hour Cafe (fictional)", industry: "Cafe and coffee shop", services: ["Coffee", "Breakfast", "Takeaway"] },
  { sector: "restaurant", name: "Rempah Kitchen (fictional)", industry: "Malaysian cafe and restaurant", services: ["Nasi lemak", "Roti canai", "Dine-in"] },
] as const;

function input(test: typeof cases[number]): DemoBusinessInput {
  return {
    businessName: test.name, location: "Berwick, Victoria", industry: test.industry,
    website: null, services: [...test.services], templateId: "immersive", fixture: true,
    studio: { name: "Review Digital (fictional)", website: "https://studio.example.com/" },
    businessProfile: {
      state: "fictional", sourceKind: "public_research", detail: "Fictional public source fixture. No live source was fetched.",
      sourceUrl: "https://source.example.com/fictional-business", fetchedAt: "2026-10-28T00:00:00Z",
      description: `Fictional source description for ${test.name}, specialising in ${test.services.join(", ")}.`,
      address: "10 Fictional Lane, Berwick", phone: "+61 3 9000 0000", services: [...test.services], images: [], notices: [],
    },
  };
}

function photos(html: string): string[] {
  return [...html.matchAll(/<img\b[^>]*\bsrc="(data:image\/(?:jpeg|webp|png);base64,[A-Za-z0-9+/=]+)"[^>]*>/gi)].map(match => match[1]!);
}

/** Independent header inspection rejects a coloured pixel or SVG being counted as a photograph. */
function dimensions(dataUrl: string): { width: number; height: number; bytes: Buffer } {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  expect(match).not.toBeNull();
  const bytes = Buffer.from(match![2]!, "base64");
  expect(bytes.length).toBeGreaterThan(8_000);
  if (match![1] === "jpeg") {
    expect(bytes.subarray(0, 2).toString("hex")).toBe("ffd8");
    let cursor = 2;
    while (cursor + 8 < bytes.length) {
      if (bytes[cursor] !== 0xff) { cursor++; continue; }
      while (bytes[cursor] === 0xff) cursor++;
      const marker = bytes[cursor++]!;
      if (marker === 0xd8 || marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (marker === 0xd9 || marker === 0xda) break;
      const length = bytes.readUInt16BE(cursor);
      expect(length).toBeGreaterThanOrEqual(2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { width: bytes.readUInt16BE(cursor + 5), height: bytes.readUInt16BE(cursor + 3), bytes };
      cursor += length;
    }
  } else if (match![1] === "png") {
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes };
  } else {
    expect(bytes.toString("ascii", 0, 4)).toBe("RIFF"); expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
    if (bytes.toString("ascii", 12, 16) === "VP8X") return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1, bytes };
    if (bytes.toString("ascii", 12, 16) === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff, bytes };
  }
  throw new Error("The embedded image has no independently readable photographic dimensions.");
}

describe("independent photographic showcase review", () => {
  it.each(cases)("records four different licensed photographic sources for $sector", test => {
    const stock = getStockPhotos(test.sector);
    expect(stock.length).toBeGreaterThanOrEqual(4);
    const sources = stock.map(photo => {
      const url = new URL(photo.sourceUrl); url.search = ""; url.hash = "";
      expect(url.protocol).toBe("https:");
      expect(photo.author.trim().length).toBeGreaterThan(2);
      expect(new URL(photo.licenceUrl).protocol).toBe("https:");
      expect(photo.placeholder).toBe(true);
      expect(createHash("sha256").update(dimensions(photo.dataUrl).bytes).digest("hex")).toBe(photo.sha256);
      return url.href.replace(/\/$/, "");
    });
    expect(new Set(sources).size).toBe(stock.length);
  });

  it.each(cases)("fills the $sector site with actual self-contained photography when business photos are absent", test => {
    const result = renderDemoWebsite(input(test)), images = photos(result.html), unique = [...new Set(images)];
    expect(images.length).toBeGreaterThanOrEqual(4);
    expect(unique.length).toBeGreaterThanOrEqual(4);
    for (const data of unique) {
      const picture = dimensions(data);
      expect(Math.min(picture.width, picture.height)).toBeGreaterThanOrEqual(400);
      expect(Math.max(picture.width, picture.height)).toBeGreaterThanOrEqual(600);
      // Allow the approved 1400px photographic hero without allowing every
      // repeated secondary image to silently grow the self-contained preview.
      expect(picture.bytes.length).toBeLessThanOrEqual(data === unique[0] ? 400_000 : 220_000);
    }
    const brief = result.designBrief as unknown as Record<string, unknown>;
    expect(brief.sector).toBe(test.sector); expect(brief.placeholderPhotoCount).toBe(unique.length);
    expect(brief.businessPhotoCount).toBe(0); expect(brief.logoKind).toBe("concept");
    expect(/(?:stock|illustrative|placeholder)[^<]{0,100}(?:photo|imag)|(?:photo|imag)[^<]{0,100}(?:stock|illustrative|placeholder)/i.test(result.html), "Stock-photo disclosure").toBe(true);
    expect(/(?:concept|placeholder)[^<]{0,70}(?:logo|mark)|(?:logo|mark)[^<]{0,70}(?:concept|placeholder)/i.test(result.html), "Concept-logo disclosure").toBe(true);
    expect(result.externalAssets).toEqual([]);
    expect(/<img\b[^>]+src="https?:/i.test(result.html), "No external image sources").toBe(false);
  });

  it("gives all six sectors different compositions and photographic hero choices", () => {
    const results = cases.map(test => renderDemoWebsite(input(test)));
    expect(new Set(results.map(result => result.designBrief?.layout)).size).toBe(6);
    expect(new Set(results.map(result => photos(result.html)[0])).size).toBe(6);
    expect(new Set(results.map(result => result.designBrief?.id)).size).toBe(6);
    expect(new Set(results.map(result => JSON.stringify(result.designBrief?.palette))).size).toBeGreaterThanOrEqual(5);
  });

  it("keeps unsupported trades out of the garden and gym compositions", () => {
    for (const industry of ["Plumbing and drainage", "Roofing and building", "Domestic cleaning", "Electrical services"]) {
      const result = renderDemoWebsite({ ...input(cases[1]), industry });
      expect((result.designBrief as unknown as { sector: string }).sector).toBe("professional");
      expect(new Set(photos(result.html)).size).toBeGreaterThanOrEqual(4);
      expect(/Good gardens|start outdoors|Bring your energy|gym and fitness/i.test(result.html)).toBe(false);
    }
  });

  it.each(cases)("retains $sector facts and complete imagery in the editable project", test => {
    const business = input(test), result = renderDemoWebsite(business), files = exportDemoReactProject(business);
    expect(Object.keys(files)).toHaveLength(8);
    const combined = Object.values(files).join("\n");
    for (const image of new Set(photos(result.html))) expect(combined.includes(image), "Preview photograph is present in editable source").toBe(true);
    for (const fact of [test.name, ...test.services, business.businessProfile!.address!, business.businessProfile!.phone!]) {
      expect(result.html.replaceAll("&amp;", "&").includes(fact), `Preview retains ${fact}`).toBe(true);
      expect(combined.includes(fact), `Editable source retains ${fact}`).toBe(true);
    }
    expect(files["src/App.tsx"]).not.toMatch(/dangerouslySetInnerHTML|srcDoc|<iframe\b|\beval\s*\(/);
    const compiled = ts.transpileModule(files["src/App.tsx"]!, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
    expect(compiled.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
    expect(/(?:A\$|\$)\s*\d|rated\s*5|trusted by\s*\d|\d+\+\s*years|award.winning|open (?:24\/7|daily)/i.test(result.html), "No invented claims or prices").toBe(false);
  });

  it("keeps placeholder visual assets inert and source facts untrusted", () => {
    const attack = '</style><script>fetch("https://evil.example.test")</script>';
    const business = { ...input(cases[2]), businessName: attack, services: [attack] };
    const result = renderDemoWebsite(business), css = result.html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    expect(result.html.includes(attack), "Hostile source text is not markup").toBe(false);
    expect(result.html.includes("&lt;/style&gt;&lt;script&gt;"), "Hostile source text is escaped").toBe(true);
    expect(/<script\b|<iframe\b|<form\b|<input\b|\son[a-z]+\s*=/i.test(result.html), "No script or collection surface").toBe(false);
    expect(css).toBeTruthy(); expect(css).not.toMatch(/@import|url\s*\(\s*["']?https?:/i);
    expect(result.contentSecurityPolicy).toContain("script-src 'none'");
    expect(result.contentSecurityPolicy).toContain("connect-src 'none'");
    expect(result.contentSecurityPolicy).toContain("img-src data:");
    expect(result.contentSecurityPolicy).toContain(`style-src 'sha256-${createHash("sha256").update(css!).digest("base64")}'`);
  });
});

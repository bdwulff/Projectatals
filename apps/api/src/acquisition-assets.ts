import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { BusinessImage, BusinessProfile, BusinessProfileEnricher } from "@atlas/core";

type Address = { address: string; family: number };
export interface AssetResponse { status: number; headers: Record<string, string | undefined>; body: Uint8Array }
export interface BusinessAssetOptions {
  clock?: () => Date;
  resolve?: (hostname: string) => Promise<Address[]>;
  /** Injection is for tests; the production transport pins the checked DNS address. */
  request?: (url: URL, address: Address, maxBytes: number, timeoutMs: number) => Promise<AssetResponse>;
}
const REUSE_NOTICE = "Business artwork was found on its public website. Ownership and permission to reuse have not been verified; review these references before publishing.";
const HTML_LIMIT = 3_000_000, IMAGE_LIMIT = 900_000, TOTAL_IMAGE_LIMIT = 1_800_000;

export function isPublicAssetAddress(value: string): boolean {
  if (isIP(value) === 4) {
    const a = Number(value.split(".")[0]), b = Number(value.split(".")[1]);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b!)) || (a === 198 && [18, 19, 51].includes(b!)) || (a === 203 && b === 0));
  }
  // Permit only native global unicast IPv6, excluding transition/documentation ranges.
  if (isIP(value) === 6) {
    const [first = "", second = ""] = value.toLowerCase().split(":");
    const reserved2001 = first === "2001" && (Number.parseInt(second || "0", 16) < 0x200 || Number.parseInt(second, 16) === 0xdb8);
    return /^[23][0-9a-f]{3}:/i.test(value) && !reserved2001 && !/^(?:2002:|3fff:)/i.test(value);
  }
  return false;
}

export function safeBusinessAssetUrl(value: string, base?: string): URL {
  const url = new URL(value, base);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.href.length > 2000 || isIP(url.hostname.replace(/^\[|\]$/g, "")) || !url.hostname.includes(".") || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(url.hostname)) throw new Error("A public HTTPS hostname is required.");
  url.hash = "";
  return url;
}

function defaultRequest(url: URL, address: Address, maxBytes: number, timeoutMs: number): Promise<AssetResponse> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method: "GET", agent: false, family: address.family, servername: url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      headers: { "User-Agent": "WulffStudio-ConceptPreview/1.0", Accept: "text/html,application/xhtml+xml,image/png,image/jpeg,image/webp;q=0.9", "Accept-Encoding": "identity" },
      signal: AbortSignal.timeout(timeoutMs),
    }, response => {
      const length = Number(response.headers["content-length"]);
      if (Number.isFinite(length) && length > maxBytes) { response.destroy(); reject(new Error("Response exceeds byte limit.")); return; }
      if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") { response.destroy(); reject(new Error("Compressed responses are not accepted.")); return; }
      let count = 0;
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => { count += chunk.length; if (count > maxBytes) response.destroy(new Error("Response exceeds byte limit.")); else chunks.push(chunk); });
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: { "content-type": response.headers["content-type"], location: response.headers.location }, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject); req.end();
  });
}

function entities(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d{1,7}|#x[0-9a-f]{1,6});/gi, entity => {
    const known: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
    if (known[entity.toLowerCase()]) return known[entity.toLowerCase()]!;
    const n = entity[2]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
  });
}
function text(value: unknown, limit = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  // indexOf advances beyond each tag once, including malformed runs of opening brackets.
  let stripped = "", cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf("<", cursor);
    if (start < 0) { stripped += value.slice(cursor); break; }
    stripped += value.slice(cursor, start) + " ";
    const end = value.indexOf(">", start + 1);
    if (end < 0) break;
    cursor = end + 1;
  }
  const result = entities(stripped).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return result ? result.slice(0, limit) : undefined;
}
function attributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s>]+))/g)) attrs[match[1]!.toLowerCase()] = entities(match[2] ?? match[3] ?? match[4] ?? "");
  return attrs;
}
function urlValue(value: unknown, base: string): string | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return urlValue((value as Record<string, unknown>).url ?? (value as Record<string, unknown>).contentUrl ?? (value as Record<string, unknown>)["@id"], base);
  if (typeof value !== "string") return undefined;
  try { return safeBusinessAssetUrl(value, base).href; } catch { return undefined; }
}
function nameMatches(expected: string, actual: unknown): boolean {
  if (typeof actual !== "string") return false;
  const words = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(w => w.length > 1 && !["pty", "ltd", "the", "and", "australia", "au"].includes(w));
  const a = words(expected), b = words(actual);
  return a.length > 0 && a.filter(w => b.includes(w)).length / a.length >= 0.5;
}
interface ImageCandidate { url: string; alt: string }
export interface ExtractedBusinessPage { description?: string; address?: string; phone?: string; services: string[]; logos: ImageCandidate[]; images: ImageCandidate[] }

function withoutActiveBlocks(html: string): string {
  const lower = html.toLowerCase();
  const opening = /<(script|style)\b/g;
  let output = "", cursor = 0;
  for (let match = opening.exec(lower); match; match = opening.exec(lower)) {
    output += html.slice(cursor, match.index) + " ";
    const closing = lower.indexOf(`</${match[1]}`, opening.lastIndex);
    if (closing < 0) return output;
    const end = lower.indexOf(">", closing);
    if (end < 0) return output;
    cursor = end + 1; opening.lastIndex = cursor;
  }
  return output + html.slice(cursor);
}

export function publicArtworkProhibited(html: string): boolean {
  const visible = text(withoutActiveBlocks(html), HTML_LIMIT) ?? "";
  return /(?:you (?:may|must|can) not|you (?:may|must|can)n't|do not|not permitted|prohibited)[^.]{0,260}(?:download|reproduc|republish|copy)/i.test(visible)
    || /(?:download|reproduc|republish|copy)[^.]{0,160}(?:expressly prohibited|strictly prohibited|not permitted|without (?:prior |written |express )*permission)/i.test(visible);
}

/** Extract public data, never execute instructions or scripts from the fetched page. */
export function extractBusinessPage(html: string, sourceUrl: string, businessName: string): ExtractedBusinessPage {
  const result: ExtractedBusinessPage = { services: [], logos: [], images: [] };
  const unrelatedArtwork = /google|trustindex|trustpilot|facebook|instagram|linkedin|twitter|youtube|tiktok|paypal|mastercard|visa[-_ ]?logo|payment[-_ ]?(?:logo|badge)|agency[-_ ]?logo|web[-_ ]?design[-_ ]?logo|profile[-_ ]?picture|gravatar|avatar/i;
  const add = (list: ImageCandidate[], candidate: unknown, alt: string) => { const url = urlValue(candidate, sourceUrl); if (url && !unrelatedArtwork.test(url + " " + alt) && !list.some(i => i.url === url)) list.push({ url, alt }); };
  const json: Record<string, unknown>[] = [];
  let walked = 0;
  const walk = (value: unknown, depth = 0) => {
    if (++walked > 500 || depth > 12 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const item of value.slice(0, 50)) walk(item, depth + 1); return; }
    const item = value as Record<string, unknown>; json.push(item);
    for (const child of Object.values(item).slice(0, 40)) if (typeof child === "object") walk(child, depth + 1);
  };
  let cursor = 0;
  const lower = html.toLowerCase();
  for (let scriptCount = 0; scriptCount < 40; scriptCount++) {
    const start = lower.indexOf("<script", cursor); if (start < 0) break;
    const tagEnd = lower.indexOf(">", start + 7); if (tagEnd < 0) break;
    const end = lower.indexOf("</script", tagEnd + 1); if (end < 0) break;
    cursor = end + 8;
    if (tagEnd - start > 2000 || end - tagEnd > 100_000 || !/application\/ld\+json/i.test(attributes(html.slice(start, tagEnd + 1)).type ?? "")) continue;
    try { walk(JSON.parse(html.slice(tagEnd + 1, end))); } catch { /* Malformed public data is omitted. */ }
  }
  const business = json.find(item => nameMatches(businessName, item.name) && /LocalBusiness|Organization|Organisation|Store|SportsActivityLocation|HealthClub|AutomotiveBusiness|AutoRepair|Plumber|HomeAndConstructionBusiness|ProfessionalService|Dentist|ExerciseGym|MedicalBusiness|Corporation/i.test(String(item["@type"] ?? "")));
  if (business) {
    result.description = text(business.description, 700);
    const address = business.address;
    if (typeof address === "string") result.address = text(address, 250);
    else if (address && typeof address === "object") {
      const a = address as Record<string, unknown>;
      result.address = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, typeof a.addressCountry === "string" ? a.addressCountry : undefined].map(v => text(v, 120)).filter(Boolean).join(", ").slice(0, 300) || undefined;
    }
    result.phone = text(business.telephone, 60);
    add(result.logos, business.logo, `${businessName} logo`);
    const images = Array.isArray(business.image) ? business.image : [business.image];
    for (const image of images.slice(0, 8)) add(result.images, image, `${businessName} website photograph`);
    // Only named services explicitly attached to this organisation are used, never page headings/claims.
    const offers: unknown[] = [business.hasOfferCatalog, business.makesOffer];
    const visitOffer = (v: unknown, depth = 0) => {
      if (depth > 5 || !v || typeof v !== "object") return;
      if (Array.isArray(v)) { v.slice(0, 12).forEach(x => visitOffer(x, depth + 1)); return; }
      const item = v as Record<string, unknown>;
      if (/^Service$/i.test(String(item["@type"] ?? ""))) { const name = text(item.name, 100); if (name && !result.services.includes(name)) result.services.push(name); }
      for (const key of ["itemListElement", "itemOffered", "item"]) visitOffer(item[key], depth + 1);
    };
    offers.forEach(value => visitOffer(value)); result.services = result.services.slice(0, 8);
  }
  for (const match of html.matchAll(/<meta\b[^>]{0,4000}>/gi)) {
    const a = attributes(match[0]), key = (a.property ?? a.name ?? "").toLowerCase();
    if (["og:description", "description"].includes(key) && !result.description) result.description = text(a.content, 700);
    if (["og:image", "og:image:secure_url", "twitter:image"].includes(key)) add(result.images, a.content, `${businessName} website photograph`);
  }
  if (!result.phone) {
    for (const match of html.matchAll(/<a\b[^>]{0,3000}>/gi)) {
      const href = attributes(match[0]).href;
      if (href && /^tel:[+\d(). -]{5,50}$/i.test(href)) { result.phone = href.slice(4).trim(); break; }
    }
  }
  let imageIndex = 0;
  const brandStem = businessName.toLowerCase().replace(/[^a-z0-9 ]/g," ").split(/\s+/).find(word=>word.length>=5 && !["fictional","company","business"].includes(word))?.slice(0,5);
  for (const match of html.matchAll(/<img\b[^>]{0,6000}>/gi)) {
    const a = attributes(match[0]); const marker = `${a.alt ?? ""} ${a.class ?? ""} ${a.id ?? ""} ${a.src ?? ""}`;
    const source = a["data-src"] ?? a["data-lazy-src"] ?? a.src;
    const firstBrandImage = imageIndex < 3 && brandStem && marker.toLowerCase().includes(brandStem) && Number(a.width ?? 0) / Number(a.height ?? 1) >= 1.8;
    if (/logo|brand[-_ ]?(?:mark|image)/i.test(marker) || firstBrandImage) add(result.logos, source, firstBrandImage ? `${businessName} published brand image` : text(a.alt, 150) ?? `${businessName} logo`);
    else if (!/icon|badge|pixel|tracking|avatar|gravatar|profile[-_ ]?picture|payment|visa|mastercard|facebook|instagram|linkedin|twitter|captcha/i.test(marker) && Number(a.width || 400) >= 160 && Number(a.height || 300) >= 100) add(result.images, source, text(a.alt, 150) ?? `${businessName} website photograph`);
    imageIndex++;
    if (result.logos.length + result.images.length > 30) break;
  }
  for (const match of html.matchAll(/background-image\s*:\s*url\(\s*["']?([^"')\s]{1,2000})["']?\s*\)/gi)) if (result.images.length < 18) add(result.images, match[1], `${businessName} website photograph`);
  // A logo used as an Open Graph image is still a logo, not an invented project photograph.
  result.images = result.images.filter(image => !result.logos.some(logo => logo.url === image.url) && !/logo|favicon|icon/i.test(new URL(image.url).pathname));
  return result;
}

export function rasterDimensions(bytes: Uint8Array): { mime: BusinessImage["mime"]; width: number; height: number } | null {
  const b = Buffer.from(bytes);
  let result: { mime: BusinessImage["mime"]; width: number; height: number } | null = null;
  if (b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && b.toString("ascii", 12, 16) === "IHDR") result = { mime: "image/png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  else if (b.length >= 12 && b[0] === 255 && b[1] === 216 && b[2] === 255) {
    let offset = 2;
    while (offset + 9 < b.length) {
      if (b[offset] !== 255) break;
      const marker = b[offset + 1]!; if (marker === 217 || marker === 218) break;
      const length = b.readUInt16BE(offset + 2); if (length < 2 || offset + 2 + length > b.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) { result = { mime: "image/jpeg", height: b.readUInt16BE(offset + 5), width: b.readUInt16BE(offset + 7) }; break; }
      offset += 2 + length;
    }
  } else if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X") result = { mime: "image/webp", width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    else if (kind === "VP8 " && b[23] === 157 && b[24] === 1 && b[25] === 42) result = { mime: "image/webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    else if (kind === "VP8L" && b[20] === 47) result = { mime: "image/webp", width: 1 + (((b[22]! & 0x3f) << 8) | b[21]!), height: 1 + (((b[24]! & 0x0f) << 10) | (b[23]! << 2) | ((b[22]! & 0xc0) >> 6)) };
  }
  return result && result.width > 0 && result.height > 0 && result.width <= 6000 && result.height <= 6000 && result.width * result.height <= 12_000_000 ? result : null;
}

/** Fetches a website and a few image references, with DNS pinning and no paid image/search API. */
export class OfficialBusinessEnricher implements BusinessProfileEnricher {
  private readonly clock: () => Date;
  private readonly resolve: NonNullable<BusinessAssetOptions["resolve"]>;
  private readonly request: NonNullable<BusinessAssetOptions["request"]>;
  constructor(options: BusinessAssetOptions = {}) {
    this.clock = options.clock ?? (() => new Date()); this.resolve = options.resolve ?? (host => lookup(host, { all: true, verbatim: true })); this.request = options.request ?? defaultRequest;
  }
  async enrich(input: { businessName: string; website: string | null; location: string }): Promise<BusinessProfile> {
    const fetchedAt = this.clock().toISOString();
    const profile: BusinessProfile = { state: "unavailable", detail: "The official website could not be read. Existing verified business details are retained; no substitute branding was invented.", sourceUrl: input.website ?? "", fetchedAt, services: [], images: [], notices: [REUSE_NOTICE] };
    if (!input.website) { profile.detail = "No official website is recorded. Add the business website to discover its real branding and photographs."; return profile; }
    const deadline = Date.now() + 35_000;
    let requests = 0;
    const get = async (value: string, maxBytes: number): Promise<{ url: string; response: AssetResponse }> => {
      let url = safeBusinessAssetUrl(value);
      for (let redirect = 0; redirect <= 2; redirect++) {
        if (++requests > 11 || Date.now() >= deadline) throw new Error("Bounded enrichment budget exhausted.");
        const addresses = await Promise.race([this.resolve(url.hostname), new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("DNS timeout.")), 3000); timer.unref(); })]);
        if (!addresses.length || addresses.some(address => !isPublicAssetAddress(address.address))) throw new Error("Website resolves to a non-public address.");
        const address = addresses.find(a => a.family === 4) ?? addresses[0]!;
        const response = await this.request(url, address, maxBytes, Math.max(1, Math.min(10_000, deadline - Date.now())));
        if (response.body.length > maxBytes) throw new Error("Response exceeds byte limit.");
        if ([301,302,303,307,308].includes(response.status)) {
          if (redirect === 2 || !response.headers.location) throw new Error("Redirect limit.");
          url = safeBusinessAssetUrl(response.headers.location, url.href); continue;
        }
        if (response.status !== 200) throw new Error("Website did not return a usable page.");
        return { url: url.href, response };
      }
      throw new Error("Redirect limit.");
    };
    try {
      const page = await get(input.website, HTML_LIMIT);
      // A canonical www alias/HTTPS redirect is normal. A redirect to another business is not identity evidence.
      const originalHost = safeBusinessAssetUrl(input.website).hostname.replace(/^www\./, ""), finalHost = new URL(page.url).hostname.replace(/^www\./, "");
      if (originalHost !== finalHost) { profile.detail = "The website redirected to another domain. Review the official address before importing its branding."; return profile; }
      if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(page.response.headers["content-type"] ?? "")) throw new Error("Website content is not HTML.");
      profile.sourceUrl = page.url;
      const html = Buffer.from(page.response.body).toString("utf8");
      const extracted = extractBusinessPage(html, page.url, input.businessName);
      Object.assign(profile, { description: extracted.description, address: extracted.address, phone: extracted.phone, services: extracted.services });
      if (publicArtworkProhibited(html)) {
        profile.state = "partial";
        profile.detail = "Published business details were found, but the website expressly restricts copying or reproducing its content. Its logo and photographs were not downloaded.";
        profile.notices.push("The source website contains an explicit copying restriction. Use owner-supplied authorised brand assets or obtain permission; original illustrations remain in this concept.");
        return profile;
      }
      let imageBytes = 0;
      const download = async (candidate: ImageCandidate, logo: boolean): Promise<BusinessImage | undefined> => {
        if (requests >= 11 || imageBytes >= TOTAL_IMAGE_LIMIT) return;
        try {
          const asset = await get(candidate.url, Math.min(IMAGE_LIMIT, TOTAL_IMAGE_LIMIT - imageBytes));
          const dimensions = rasterDimensions(asset.response.body);
          if (!dimensions || !new RegExp(`^${dimensions.mime.replace("/", "\\/")}(?:;|$)`, "i").test(asset.response.headers["content-type"] ?? "")) return;
          if (logo ? dimensions.width < 24 || dimensions.height < 16 : dimensions.width < 240 || dimensions.height < 160) return;
          imageBytes += asset.response.body.length;
          return { ...dimensions, sourceUrl: asset.url, alt: candidate.alt, dataUrl: `data:${dimensions.mime};base64,${Buffer.from(asset.response.body).toString("base64")}`, sha256: createHash("sha256").update(asset.response.body).digest("hex") };
        } catch { return undefined; }
      };
      for (const candidate of extracted.logos.slice(0, 3)) { const logo = await download(candidate, true); if (logo) { profile.logo = logo; break; } }
      for (const candidate of extracted.images.slice(0, 7)) { const image = await download(candidate, false); if (image && image.sha256 !== profile.logo?.sha256 && !profile.images.some(i => i.sha256 === image.sha256)) profile.images.push(image); if (profile.images.length >= 3) break; }
      profile.state = profile.logo && profile.images.length > 0 ? "ready" : "partial";
      profile.detail = `${profile.logo ? "Official website logo captured" : "No usable raster logo found"}; ${profile.images.length} website photograph${profile.images.length === 1 ? "" : "s"} captured. ${profile.address ? "Published street address found." : "Only the recorded locality is available."} Public content requires owner review.`;
      if (!profile.logo) profile.notices.push("No suitable PNG, JPEG or WebP logo was found. The text business name remains visible; SVG and unverified third-party logos were not substituted.");
      if (!profile.images.length) profile.notices.push("No suitable public website photograph was found. Original concept artwork remains labelled as illustration.");
      return profile;
    } catch { return profile; }
  }
}

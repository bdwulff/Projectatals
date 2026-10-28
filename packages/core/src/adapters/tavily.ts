import { isIP } from "node:net";
import type { ProspectCandidate, ResearchSource } from "../orchestrator.js";
import type { ConnectionStatus } from "./types.js";
import { ResearchUnavailableError, type ResearchLookupInput, type ResearchLookupResult } from "./research.js";
import { isPublicAddress } from "./live/website-checker.js";

const ENDPOINT = "https://api.tavily.com/search";
const EXCLUDED_HOSTS = ["facebook.com", "instagram.com", "linkedin.com", "youtube.com", "mapquest.com", "yellowpages.com.au", "truelocal.com.au", "yelp.com", "wikipedia.org", "hipages.com.au", "oneflare.com.au", "canstar.com.au", "dindi.com.au", "whereis.com", "seek.com", "seek.com.au", "indeed.com", "jora.com", "adzuna.com.au", "careerone.com.au", "fitnessjobs.com.au", "anybusiness.com.au", "businessesforsale.com", "businessesforsale.com.au", "businessforsale.com.au", "bsale.com.au", "australianbusinessforsale.com.au", "commercialrealestate.com.au", "localsearch.com.au", "australia247.info", "tripadvisor.com.au", "mindbodyonline.com", "classpass.com", "keepactive.com.au", "crossfit.com", "snapfitness.com", "anytimefitness.com", "bodyfittraining.com", "fitnessfirst.com.au", "goodlife.com.au", "jetts.com.au"];
const DIRECTORY_HOSTS = new RegExp(`(^|\\.)(${EXCLUDED_HOSTS.map(host => host.replace(/\./g, "\\.")).join("|")})$`, "i");
/** A category, vacancy or sale advert is not a named potential client, even when local keywords match. */
function nonBusinessResult(title: string, pathname: string): boolean {
  return /\b(?:gazette|newspaper|local paper|government|directory|compare providers|business(?:es)? for sale|job vacancies|job openings|job search|positions vacant|employment opportunities|search results)\b/i.test(title)
    || /\b(?:jobs?|vacancies|positions|contractors|companies|businesses|gyms|plumbers|electricians)\s+(?:in|near|around)\b/i.test(title)
    || /\b(?:top|best)\s+\d+\b|^\d+\s+(?:best|top)\b/i.test(title)
    || /^(?:find\s+(?:(?:local|nearby|the best)\s+)?(?:fencing contractors|plumbers|electricians|gyms|fitness jobs|businesses)|list of|directory of|search results)\b/i.test(title)
    || /\/(?:jobs?|careers?|vacanc(?:y|ies)|employment|business(?:es)?[-_]for[-_]sale|business[-_]sales)(?:\/|$)/i.test(pathname);
}
const SECTORS = [
  { label: "fencing", pattern: /\bfenc\w*|\bgates?\b/i },
  { label: "plumbing", pattern: /\bplumb\w*|\bdrain\w*|\bgasfitt\w*/i },
  { label: "fitness and personal training", pattern: /\bgym\w*|\bfitness\b|\bboxing\b|\bkickbox\w*|\bpersonal train\w*|\bpilates\b/i },
  { label: "car detailing", pattern: /\bdetail\w*|\bpaint correction\b|\bceramic coating\b/i },
];
export interface TavilyResearchOptions { apiKey?: string; fetch?: typeof fetch; clock?: () => Date; timeoutMs?: number; excludeDomains?: () => string[] }
/** Official free keyless access for light discovery; a configured API key is never substituted automatically. */
export class TavilyResearchSource implements ResearchSource {
  private readonly request: typeof fetch;
  private readonly clock: () => Date;
  private readonly timeout: number;
  private last: ConnectionStatus | null = null;
  private active = false;
  private recent: number[] = [];
  constructor(private readonly options: TavilyResearchOptions = {}) {
    this.request = options.fetch ?? fetch; this.clock = options.clock ?? (() => new Date()); this.timeout = options.timeoutMs ?? 15_000;
    if (!Number.isInteger(this.timeout) || this.timeout < 1 || this.timeout > 30_000) throw new RangeError("Search timeout must be from1 to30000ms.");
  }
  async status(): Promise<ConnectionStatus> {
    return this.last ?? { name: "Research (Tavily)", state: "not_connected", mode: "live", checkedAt: this.clock().toISOString(), detail: this.options.apiKey ? "Tavily key configured; run discovery to verify the connection. Basic searches use provider credits." : "Free keyless Tavily is available to try. Run discovery to verify it; keyless access has provider rate limits and no paid fallback." };
  }
  async lookup(input: ResearchLookupInput): Promise<ResearchLookupResult[]> { return this.search(input); }
  private async search(input: ResearchLookupInput, excludeDomains: string[] = []): Promise<ResearchLookupResult[]> {
    const query = text(input.query, 400); const count = input.count ?? 5;
    if (!Number.isInteger(count) || count < 1 || count > 10) throw new RangeError("Request from1 to10 search results.");
    if (this.active) throw new ResearchUnavailableError("network_error", "A search is already running. Wait for it to finish.");
    const now = this.clock().getTime(); this.recent = this.recent.filter(at => now - at < 60_000);
    if (this.recent.length >= 3) throw new ResearchUnavailableError("http_error", "Search is limited to three requests per minute. Try again shortly.");
    this.active = true; this.recent.push(now);
    try {
      const response = await this.request(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : { "X-Tavily-Access-Mode": "keyless" }) }, body: JSON.stringify({ query, search_depth: "basic", max_results: count, include_answer: false, include_raw_content: false, include_images: false, topic: "general", country: "australia", auto_parameters: false, ...(excludeDomains.length ? { exclude_domains: excludeDomains } : {}) }), redirect: "error", signal: AbortSignal.timeout(this.timeout) });
      if (!response.ok) throw new ResearchUnavailableError("http_error", response.status === 429 || response.status === 432 ? "Tavily's search limit was reached. No paid fallback or retry was made." : `Tavily search is unavailable (HTTP ${response.status}). No invented results were returned.`);
      const payload = await boundedJson(response);
      if (!payload || typeof payload !== "object" || !Array.isArray((payload as { results?: unknown }).results)) throw new ResearchUnavailableError("invalid_response", "Search returned an unusable response. No companies were invented.");
      const rows = (payload as { results: unknown[] }).results.slice(0, 10); const seen = new Set<string>(); const results: ResearchLookupResult[] = [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>; const url = publicUrl(r.url);
        if (!url || seen.has(url) || typeof r.title !== "string" || !r.title.trim()) continue;
        seen.add(url); results.push({ title: clean(r.title, 240), url, description: clean(r.content, 1200), source: "Tavily", retrievedAt: this.clock().toISOString(), trust: "untrusted_web_content" });
        if (results.length >= count) break;
      }
      if (rows.length && !results.length) throw new ResearchUnavailableError("invalid_response", "Search returned no usable source URLs. No companies were invented.");
      this.last = { name: "Research (Tavily)", state: "connected", mode: "live", checkedAt: this.clock().toISOString(), detail: `${this.options.apiKey ? "Keyed" : "Free keyless"} Tavily search succeeded. Source excerpts remain unverified; contact permission is not established.` };
      return results;
    } catch (error) {
      const safe = error instanceof ResearchUnavailableError ? error : new ResearchUnavailableError("network_error", "Tavily could not complete the search. No automatic retry or paid fallback was made.");
      this.last = { name: "Research (Tavily)", state: "error", mode: "live", checkedAt: this.clock().toISOString(), detail: safe.message }; throw safe;
    } finally { this.active = false; }
  }
  async find(input: { area: string; count: number; industries?: string[] }): Promise<ProspectCandidate[]> {
    const area = text(input.area, 160); const count = Math.min(input.count, 5);
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > 10) throw new RangeError("Discover from1 to10 businesses.");
    const day = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric" }).format(this.clock()));
    const industry = input.industries?.map(i => text(i, 100)).slice(0, 3).join(" ") || SECTORS[day % SECTORS.length]!.label;
    const sector = SECTORS.find(value => value.pattern.test(industry));
    const industryWords = industry.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2 && !["business", "businesses", "services", "service", "local", "and", "the"].includes(word));
    const localities = area.split(/[,;]|\band\b/i).map(value => value.replace(/\b(?:victoria|australia|vic)\b/ig, "").trim()).filter(Boolean);
    // A single specific town avoids multi-town searches matching newspapers and gazette PDFs.
    const queryLocality = localities[Math.floor(day / SECTORS.length) % Math.max(1, localities.length)] ?? area;
    const excluded = [...new Set([...EXCLUDED_HOSTS, ...(this.options.excludeDomains?.() ?? []).filter(host => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)).slice(-100)])];
    const results = await this.search({ query: `${industry} in ${queryLocality}, VIC official website`, count: 10 }, excluded);
    const seen = new Set<string>(); const candidates: ProspectCandidate[] = [];
    for (const result of results) {
      const url = new URL(result.url);
      if (DIRECTORY_HOSTS.test(url.hostname) || /(?:^|\.)(?:gov|edu)\.au$/i.test(url.hostname) || /\.(?:pdf|docx?|xlsx?|pptx?|zip|png|jpe?g)$/i.test(url.pathname) || /\/(?:news|blog|articles?|wp-content|gazette)\//i.test(url.pathname) || nonBusinessResult(result.title, url.pathname) || seen.has(url.hostname) || excluded.some(host => url.hostname === host || url.hostname.endsWith("." + host))) continue;
      const sourceText = `${result.title} ${result.description} ${url.pathname}`.toLowerCase();
      const locality = sourceText.includes(queryLocality.toLowerCase()) ? queryLocality : null;
      if (!locality) continue;
      if (sector ? !sector.pattern.test(sourceText) : !industryWords.some(word => sourceText.includes(word))) continue;
      // Discovery records retain the source's identity as unverified. No inferred email or claimed defects.
      seen.add(url.hostname);
      candidates.push({ businessName: result.title.split(/\s+[|–—]\s+/)[0]!.slice(0, 160), location: `${locality ?? area}, Victoria`, website: url.origin, industry, observations: [{ observation: result.description || `Search result for ${result.title}. Verify the business and location before outreach.`, sourceUrl: result.url, method: "search_result", status: "unverified", uncertainty: "Source excerpt matches the selected locality and sector, but may be outdated or refer to a service-area page. Business identity, base location, service facts and contact eligibility still need review." }], commercialOpportunity: "Potential fit for a website concept; interest, need and current website performance are unverified.", recommendedScope: "Review the official site, then tailor a private website concept from verified service facts.", internalRecommendedPriceAud: null });
      if (candidates.length >= count) break;
    }
    return candidates;
  }
}
function clean(value: unknown, max: number): string { return typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : ""; }
function text(value: unknown, max: number): string { if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) throw new RangeError("Provide bounded search text."); return value.trim(); }
function publicUrl(value: unknown): string | null { try { const u = new URL(String(value)); const host = u.hostname.replace(/^\[|\]$/g, ""); if (!["https:", "http:"].includes(u.protocol) || u.username || u.password || u.port || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test") || !host.includes(".") || isIP(host) && !isPublicAddress(host)) return null; u.hash = ""; return u.href; } catch { return null; } }
async function boundedJson(response: Response): Promise<unknown> { const reader = response.body?.getReader(); if (!reader) throw new Error("No search body"); const chunks: Uint8Array[] = []; let size = 0; try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 1_048_576) throw new Error("Search response limit"); chunks.push(part.value); } } catch (error) { await reader.cancel(); throw error; } return JSON.parse(Buffer.concat(chunks).toString("utf8")); }

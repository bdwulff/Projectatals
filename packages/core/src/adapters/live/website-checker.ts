import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import type { WebsiteChecker } from "../types.js";

export type ResolvedAddress = { address: string; family: number };
type CheckFetch = (url: string, options: { redirect: "manual"; signal: AbortSignal; headers: Record<string, string> }, addresses: readonly ResolvedAddress[]) => Promise<Response>;
export interface WebsiteCheckerOptions {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  fetch?: CheckFetch;
  timeoutMs?: number;
  maxBodyBytes?: number;
  maxRedirects?: number;
}

/** Conservative global-unicast allow list: reject private, special and transition ranges. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const a = address.split(".").map(Number);
    const [x = 0, y = 0, z = 0] = a;
    return !(x === 0 || x === 10 || x === 127 || x >= 224 ||
      (x === 100 && y >= 64 && y <= 127) || (x === 169 && y === 254) ||
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && (y === 168 || (y === 0 && (z === 0 || z === 2)) || (y === 88 && z === 99))) ||
      (x === 198 && (y === 18 || y === 19 || (y === 51 && z === 100))) ||
      (x === 203 && y === 0 && z === 113));
  }
  if (isIP(address) !== 6 || address.includes("%")) return false;
  const parts = address.toLowerCase().split("::");
  const left = parts[0] ? parts[0].split(":") : [];
  const right = parts[1] ? parts[1].split(":") : [];
  const words = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right].map(x => parseInt(x, 16));
  const first = words[0] ?? 0;
  const second = words[1] ?? 0;
  return first >= 0x2000 && first <= 0x3fff &&
    !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8)) &&
    first !== 0x2002 && !(first === 0x3fff && second <= 0xfff);
}

function validatedUrl(raw: string): URL {
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Only public HTTP(S) URLs without credentials can be checked");
  if (!host || (!isIP(host) && (!host.includes(".") || /(?:^|\.)(localhost|local|internal|home|lan|test|invalid|example)$/.test(host)))) throw new Error("Private or internal hostname blocked");
  if (isIP(host) && !isPublicAddress(host)) throw new Error("Non-public address blocked");
  return url;
}

/** Connect to an already validated IP; TLS still verifies the original hostname. */
const pinnedFetch: CheckFetch = async (raw, options, addresses) => {
  const url = new URL(raw);
  const chosen = addresses[0];
  if (!chosen) throw new Error("Hostname has no public addresses");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(url, {
      hostname: chosen.address,
      family: chosen.family,
      servername: isIP(host) ? undefined : host,
      method: "GET",
      headers: { ...options.headers, Host: url.host },
      signal: options.signal,
      agent: false,
    }, incoming => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const status = incoming.statusCode ?? 502;
      const noBody = [204, 205, 304].includes(status);
      if (noBody) incoming.resume();
      resolve(new Response(noBody ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>, { status, headers }));
    });
    req.on("error", reject);
    req.end();
  });
};

export class HttpWebsiteChecker implements WebsiteChecker {
  constructor(private readonly options: WebsiteCheckerOptions = {}) {}
  async status() {
    return { name: "Website checker", state: "connected" as const, mode: "live" as const, detail: "Public HTTP(S) checks with DNS/IP pinning, redirect validation and bounded responses; reachability is checked per URL.", checkedAt: new Date().toISOString() };
  }
  async check(raw: string) {
    const checkedAt = new Date().toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Website check timed out")), this.options.timeoutMs ?? 15_000);
    const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }));
    void aborted.catch(() => {});
    const bounded = <T>(promise: Promise<T>) => Promise.race([promise, aborted]);
    try {
      let url = validatedUrl(raw);
      const maxRedirects = this.options.maxRedirects ?? 5;
      for (let redirects = 0; ; redirects++) {
        const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
        const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await bounded((this.options.resolve ?? (name => lookup(name, { all: true, verbatim: true })))(host));
        if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error("DNS returned a non-public address or no addresses");
        const response = await bounded((this.options.fetch ?? pinnedFetch)(url.href, { redirect: "manual", signal: controller.signal, headers: { "User-Agent": "AtlasWebsiteAudit/0.2", Accept: "text/html" } }, addresses));
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (response.body) await bounded(response.body.cancel());
          if (redirects >= maxRedirects) throw new Error("Too many website redirects");
          const location = response.headers.get("location");
          if (!location) throw new Error("Redirect has no location");
          url = validatedUrl(new URL(location, url).href);
          continue;
        }
        const limit = this.options.maxBodyBytes ?? 262_144;
        const reader = response.body?.getReader();
        let bytes = 0;
        const decoder = new TextDecoder();
        let html = "";
        if (reader) {
          try {
            for (;;) {
              const part = await bounded(reader.read());
              if (part.done) break;
              bytes += part.value.byteLength;
              if (bytes > limit) throw new Error("Website response exceeds size limit");
              html += decoder.decode(part.value, { stream: true });
            }
            html += decoder.decode();
          } finally { await bounded(reader.cancel()).catch(() => {}); }
        }
        const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
        return { reachable: response.ok, status: response.status, redirectedTo: url.href !== raw ? url.href : undefined, title, checkedAt };
      }
    } catch (error) {
      return { reachable: false, error: error instanceof Error ? error.message : String(error), checkedAt };
    } finally { clearTimeout(timer); controller.abort(); }
  }
}

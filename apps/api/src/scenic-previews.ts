import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context, Hono } from "hono";
import { PermissionLevel, requiredLevel } from "@atlas/core";

interface PublishedPreview {
  token: string;
  filename: string;
  sha256: string;
  publishedAt: string;
  expiresAt: string;
}

interface ScenicPreviewOptions {
  directory?: string;
  now?: () => number;
}

const MAX_HTML_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_LIFETIME_MS = 90 * 86_400_000;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const FILENAME = /^[a-z0-9][a-z0-9-]{0,139}\.html$/;
const SHA256 = /^[a-f0-9]{64}$/;

/** Serves only owner-published static files. No upload, publishing, record or email action exists here. */
export function installScenicPreviewRoutes(app: Hono, options: ScenicPreviewOptions = {}): void {
  const directory = options.directory ?? fileURLToPath(new URL("../../../concept-previews/", import.meta.url));
  const now = options.now ?? Date.now;
  app.get("/concepts/:token", async c => {
    headers(c);
    if (requiredLevel("read.website") !== PermissionLevel.Read || !TOKEN.test(c.req.param("token"))) return unavailable(c);
    try {
      const manifestBytes = await boundedFile(join(directory, "manifest.json"), MAX_MANIFEST_BYTES);
      const entries = parseManifest(JSON.parse(manifestBytes.toString("utf8")));
      if (!entries) return unavailable(c);
      const entry = entries.find(preview => preview.token === c.req.param("token"));
      const time = now();
      if (!entry || !Number.isFinite(time) || Date.parse(entry.publishedAt) > time || Date.parse(entry.expiresAt) <= time) return unavailable(c);
      const data = await boundedFile(join(directory, entry.filename), MAX_HTML_BYTES);
      if (hash(data) !== entry.sha256) return unavailable(c);
      const html = data.toString("utf8");
      c.header("Content-Security-Policy", previewPolicy(html));
      return c.html(html);
    } catch {
      return unavailable(c);
    }
  });
  // Keep every other method and child path away from the dashboard's static fallback.
  app.all("/concepts", c => { headers(c); return unavailable(c); });
  app.all("/concepts/*", c => { headers(c); return unavailable(c); });
}

async function boundedFile(filename: string, maxBytes: number): Promise<Buffer> {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) throw new Error("Unavailable preview file");
    const bytes = await file.readFile();
    if (bytes.length > maxBytes) throw new Error("Unavailable preview file");
    return bytes;
  } finally {
    await file.close();
  }
}

function parseManifest(value: unknown): PublishedPreview[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const manifest = value as Record<string, unknown>;
  if (manifest.version !== 1 || !Array.isArray(manifest.previews) || manifest.previews.length < 1 || manifest.previews.length > 100) return null;
  const tokens = new Set<string>(), filenames = new Set<string>();
  for (const item of manifest.previews) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const entry = item as Record<string, unknown>;
    if (typeof entry.token !== "string" || !TOKEN.test(entry.token) || tokens.has(entry.token)) return null;
    if (typeof entry.filename !== "string" || !FILENAME.test(entry.filename) || filenames.has(entry.filename)) return null;
    if (typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256)) return null;
    if (typeof entry.publishedAt !== "string" || typeof entry.expiresAt !== "string") return null;
    const published = Date.parse(entry.publishedAt), expires = Date.parse(entry.expiresAt);
    if (!Number.isFinite(published) || !Number.isFinite(expires) || expires <= published || expires - published > MAX_LIFETIME_MS) return null;
    tokens.add(entry.token); filenames.add(entry.filename);
  }
  return manifest.previews as PublishedPreview[];
}

function hash(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }

function previewPolicy(html: string): string {
  const scripts = new Set<string>();
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    scripts.add(`'sha256-${createHash("sha256").update(match[1] ?? "").digest("base64")}'`);
  }
  return [
    "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
    "default-src 'none'",
    `script-src ${scripts.size ? [...scripts].join(" ") : "'none'"}`,
    "style-src 'unsafe-inline'",
    "img-src data:",
    "font-src data:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function headers(c: Context): void {
  c.header("Cache-Control", "private, no-store");
  c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
}

function unavailable(c: Context): Response { return c.text("This website concept is not available.", 404); }

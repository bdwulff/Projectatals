import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getCookie, setCookie } from "hono/cookie";
import type { Context, Hono, MiddlewareHandler } from "hono";
import type { Runtime } from "./runtime.js";

export interface OwnerAuthOptions {
  ownerAccessKey?: string;
  publicOrigin?: string;
  briefingReadToken?: string;
  /** The HTTP server, not an inbound Host header, must establish this. */
  localOnlyServer?: boolean;
  allowInsecureLocalFake?: boolean;
  sessionTtlMs?: number;
  now?: () => number;
}

export function authOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): OwnerAuthOptions {
  return {
    ownerAccessKey: env.ATLAS_OWNER_ACCESS_KEY,
    publicOrigin: env.ATLAS_PUBLIC_ORIGIN,
    briefingReadToken: env.ATLAS_BRIEFING_READ_TOKEN,
    allowInsecureLocalFake: env.ATLAS_ALLOW_INSECURE_LOCAL_FAKE === "true",
  };
}

function secretReady(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= 32 && secret.length <= 1024;
}

function digest(value: string) { return createHash("sha256").update(value).digest(); }

/** Hash to equal-length buffers before timing-safe comparison. Never log input. */
export function sameSecret(actual: string, expected: string): boolean {
  return timingSafeEqual(digest(actual), digest(expected));
}

function configuredOrigin(value: string | undefined, localFake: boolean): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") return null;
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !(localFake && loopback && parsed.protocol === "http:")) return null;
    return parsed.origin;
  } catch { return null; }
}

/** Single-instance owner sessions. Restarting the process invalidates all sessions. */
export function installOwnerAuth(app: Hono, rt: Runtime, options: OwnerAuthOptions) {
  if (secretReady(options.ownerAccessKey) && secretReady(options.briefingReadToken) && sameSecret(options.ownerAccessKey, options.briefingReadToken)) {
    throw new Error("Owner and briefing credentials must be distinct.");
  }
  const now = options.now ?? Date.now;
  const localFake = options.localOnlyServer === true && options.allowInsecureLocalFake === true && rt.mode === "fake";
  const origin = configuredOrigin(options.publicOrigin, localFake);
  const ownerConfigured = secretReady(options.ownerAccessKey) && origin !== null;
  const bypass = localFake && !secretReady(options.ownerAccessKey);
  const configured = ownerConfigured || bypass;
  const cookieName = localFake ? "atlas_dev_session" : "__Host-atlas_session";
  const ttlMs = Math.min(12 * 60 * 60_000, Math.max(1000, options.sessionTtlMs ?? 12 * 60 * 60_000));
  const sessions = new Map<string, number>();
  const failures: number[] = [];
  const failureWindowMs = 15 * 60_000;
  const maxFailures = 8;

  const tokenKey = (token: string) => digest(token).toString("hex");
  function activeSession(c: Context): boolean {
    if (!ownerConfigured) return false;
    const token = getCookie(c, cookieName);
    if (!token || token.length !== 64) return false;
    const key = tokenKey(token);
    const expires = sessions.get(key);
    if (!expires || expires <= now()) { sessions.delete(key); return false; }
    return true;
  }
  function revoke(c: Context) {
    const token = getCookie(c, cookieName);
    if (token) sessions.delete(tokenKey(token));
    setCookie(c, cookieName, "", { httpOnly: true, secure: !localFake, sameSite: "Strict", path: "/", maxAge: 0 });
  }
  function expectedOrigin(c: Context): string | null {
    if (origin) return origin;
    if (!bypass) return null;
    const url = new URL(c.req.url);
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ? url.origin : null;
  }
  const middleware: MiddlewareHandler = async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    const method = c.req.method.toUpperCase();
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      const expected = expectedOrigin(c);
      if (!expected || c.req.header("Origin") !== expected || c.req.header("Sec-Fetch-Site") === "cross-site") {
        return c.json({ error: "Same-origin request required." }, 403);
      }
      if (!/^application\/json(?:\s*;|$)/i.test(c.req.header("Content-Type") ?? "")) {
        return c.json({ error: "JSON content type required." }, 415);
      }
    }
    if (["/api/auth/session", "/api/auth/login", "/api/auth/logout"].includes(c.req.path)) return next();
    if (method === "GET" && c.req.path === "/api/boxsafe/daily-briefing" && secretReady(options.briefingReadToken)) {
      const auth = c.req.header("Authorization") ?? "";
      if (auth.startsWith("Bearer ") && auth.length <= 1031 && sameSecret(auth.slice(7), options.briefingReadToken)) return next();
    }
    if (!configured) return c.json({ error: "Owner sign-in is not configured." }, 503);
    if (!bypass && !activeSession(c)) return c.json({ error: "Owner sign-in required." }, 401);
    return next();
  };
  app.use("/api/*", middleware);
  app.use("/api", middleware);

  app.get("/api/auth/session", (c) => c.json({
    authenticated: bypass || activeSession(c), configured,
    developmentBypass: bypass,
  }));
  app.post("/api/auth/login", async (c) => {
    if (!configured) return c.json({ error: "Owner sign-in is not configured." }, 503);
    if (bypass) return c.json({ authenticated: true, developmentBypass: true });
    const cutoff = now() - failureWindowMs;
    while (failures.length && failures[0]! < cutoff) failures.shift();
    if (failures.length >= maxFailures) {
      c.header("Retry-After", String(Math.ceil((failures[0]! + failureWindowMs - now()) / 1000)));
      return c.json({ error: "Too many sign-in attempts. Try again later." }, 429);
    }
    let accessKey: unknown;
    try {
      if (Number(c.req.header("Content-Length") ?? 0) > 4096) return c.json({ error: "Invalid sign-in request." }, 400);
      const text = await c.req.text();
      if (text.length > 4096) return c.json({ error: "Invalid sign-in request." }, 400);
      accessKey = (JSON.parse(text) as { accessKey?: unknown })?.accessKey;
    } catch { return c.json({ error: "Invalid sign-in request." }, 400); }
    if (typeof accessKey !== "string" || accessKey.length > 1024 || !sameSecret(accessKey, options.ownerAccessKey!)) {
      failures.push(now());
      return c.json({ error: "Sign-in failed." }, 401);
    }
    failures.length = 0;
    revoke(c);
    for (const [key, expires] of sessions) if (expires <= now()) sessions.delete(key);
    if (sessions.size >= 32) sessions.delete(sessions.keys().next().value!);
    const token = randomBytes(32).toString("hex");
    const expires = now() + ttlMs;
    sessions.set(tokenKey(token), expires);
    setCookie(c, cookieName, token, { httpOnly: true, secure: !localFake, sameSite: "Strict", path: "/", maxAge: Math.floor(ttlMs / 1000) });
    rt.atlas.audit.record({ actor: "owner", action: "auth.login", business: "atlas", outcome: "completed" });
    return c.json({ authenticated: true, expiresAt: new Date(expires).toISOString() });
  });
  app.post("/api/auth/logout", (c) => {
    revoke(c);
    return c.json({ authenticated: false });
  });
}

import type { Context, Hono } from "hono";
import { PermissionLevel, requiredLevel } from "@atlas/core";
import { AcquisitionMailError, isGoogleMailboxAddress, validateGoogleOAuthClient } from "./acquisition-mail.js";
import type { Runtime } from "./runtime.js";

const MESSAGE_ID = /^[A-Za-z0-9_-]{1,200}$/;
class MailRouteError extends Error {
  constructor(message: string, readonly status: 400 | 409 | 503 = 400) { super(message); }
}

/** Install after the existing owner-session and same-origin JSON middleware. */
export function installMailRoutes(app: Hono, rt: Runtime): void {
  const google = rt.googleMail;
  const snapshot = async () => ({
    mode: rt.mode,
    configuration: google.configurationStatus(),
    status: rt.mode === "fake"
      ? { state: "fake" as const, provider: "Fictional Gmail connection", detail: "Fictional mode does not connect a real mailbox or read live messages." }
      : await google.status(),
  });
  const fail = (c: Context, error: unknown) => {
    if (error instanceof MailRouteError) return c.json({ error: error.message }, error.status);
    if (error instanceof AcquisitionMailError) {
      const status = error.code === "invalid_request" ? 400 : error.code === "sender_mismatch" || error.code === "oauth_state" ? 409 : 503;
      return c.json({ error: error.message, code: error.code }, status);
    }
    return c.json({ error: error instanceof SyntaxError ? "Provide a valid mailbox request object." : "The mailbox action could not finish. Check its connection and try again." }, error instanceof SyntaxError ? 400 : 503);
  };
  const liveOnly = () => {
    if (rt.mode !== "live") throw new MailRouteError("Fictional mode never links an account or reads a real inbox.", 409);
  };
  const readPermission = (action: "read.mail.inbox" | "read.mail.message") => {
    if (requiredLevel(action) !== PermissionLevel.Read) throw new MailRouteError("Mailbox reading is unavailable under the current action policy.", 503);
  };
  const record = (operation: string, detail: Record<string, unknown> = {}) => rt.atlas.audit.record({ actor: "owner", action: operation.startsWith("read.") ? "read.records" : "execute.record_update", business: "atlas", outcome: "completed", detail: { provider: "Gmail", operation, ...detail } });
  const mutate = (action: (input: Record<string, unknown>) => unknown) => async (c: Context) => {
    try { await action(await body(c)); return c.json(await snapshot()); }
    catch (error) { return fail(c, error); }
  };

  app.get("/api/mail", async c => { try { return c.json(await snapshot()); } catch (error) { return fail(c, error); } });
  app.post("/api/mail/settings", mutate(input => {
    fields(input, ["expectedEmail"]);
    if (typeof input.expectedEmail !== "string" || /[\r\n]/.test(input.expectedEmail) || !isGoogleMailboxAddress(input.expectedEmail.trim())) throw new AcquisitionMailError("invalid_request", "Provide the email address of the Gmail or Google Workspace mailbox you intend to connect.");
    // Selecting synchronously refuses changes while a provider submission is active.
    // The expected address is metadata, not evidence of a connected Google account.
    rt.mailProviders.select("gmail");
    google.setExpectedEmail(input.expectedEmail.trim().toLowerCase());
    record("mail.expected_account_saved", { expectedAccountConfigured: true });
  }));
  app.post("/api/mail/google/config", mutate(input => {
    liveOnly(); fields(input, ["clientId", "clientSecret"]);
    if (typeof input.clientId !== "string" || typeof input.clientSecret !== "string") throw new AcquisitionMailError("invalid_request", "Provide the web application's Google client ID and client secret from its downloaded OAuth JSON file.");
    const client = { clientId: input.clientId.trim(), clientSecret: input.clientSecret };
    validateGoogleOAuthClient(client);
    rt.mailProviders.select("gmail");
    google.saveOAuthClient(client);
    record("mail.google_client_saved", { clientConfigured: true });
  }));
  app.post("/api/mail/google/link", async c => {
    try {
      liveOnly(); fields(await body(c), []);
      rt.mailProviders.select("gmail");
      const result = google.startLink(); record("mail.google_link_started");
      return c.json(result);
    } catch (error) { return fail(c, error); }
  });
  app.post("/api/mail/google/disconnect", mutate(async input => {
    liveOnly(); fields(input, []);
    rt.mailProviders.select("gmail");
    await google.disconnect(); record("mail.google_disconnected", { localConnectionRemoved: true });
  }));
  app.get("/api/mail/inbox", async c => {
    try {
      liveOnly();
      readPermission("read.mail.inbox");
      const url = new URL(c.req.url);
      if ([...url.searchParams.keys()].some(key => !["limit", "query"].includes(key)) || url.searchParams.getAll("limit").length > 1 || url.searchParams.getAll("query").length > 1) throw new AcquisitionMailError("invalid_request", "Use only one inbox limit and optional search query.");
      const rawLimit = url.searchParams.get("limit"), query = url.searchParams.get("query") ?? "";
      const limit = rawLimit === null ? 20 : /^\d{1,2}$/.test(rawLimit) ? Number(rawLimit) : 0;
      if (limit < 1 || limit > 20 || query.length > 200 || /[\u0000-\u001f\u007f]/.test(query)) throw new AcquisitionMailError("invalid_request", "Read one to twenty inbox messages with a search query of at most 200 characters.");
      const inbox = await google.listInbox({ limit, ...(query ? { query } : {}) });
      record("read.mail.inbox", { returnedMessages: inbox.messages.length, searched: Boolean(query) });
      return c.json(inbox);
    } catch (error) { return fail(c, error); }
  });
  app.get("/api/mail/messages/:id", async c => {
    try {
      liveOnly();
      readPermission("read.mail.message");
      const id = c.req.param("id");
      if (!MESSAGE_ID.test(id)) throw new AcquisitionMailError("invalid_request", "Provide a valid Gmail message ID.");
      if (new URL(c.req.url).search) throw new AcquisitionMailError("invalid_request", "The message reader does not accept additional query fields.");
      const message = await google.readMessage(id);
      record("read.mail.message", { htmlRendered: false, attachmentsDownloaded: false });
      return c.json(message);
    } catch (error) { return fail(c, error); }
  });
}

function fields(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new AcquisitionMailError("invalid_request", "Unexpected mailbox request fields.");
}
async function body(c: Context): Promise<Record<string, unknown>> {
  const value: unknown = await c.req.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AcquisitionMailError("invalid_request", "Provide a mailbox request object.");
  return value as Record<string, unknown>;
}

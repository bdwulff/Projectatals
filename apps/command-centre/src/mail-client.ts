import { ApiError, SESSION_EXPIRED_EVENT } from "./api";

export interface GmailConfiguration {
  configured: boolean;
  source: string;
  expectedEmail: string | null;
  linkedEmail: string | null;
  clientIdHint: string;
  redirectUri: string;
  scopes: string[];
  grantedScopes: string[];
  inboxReady: boolean;
  requiresRelink: boolean;
}
export interface MailSnapshot {
  mode: "live" | "fake";
  configuration: GmailConfiguration;
  status: { state: "connected" | "not_connected" | "error" | "fake"; provider: string; detail: string; sender?: string };
}
export interface InboxMessage {
  id: string; threadId: string; from: string; to: string; subject: string; snippet: string;
  date?: string; unread: boolean; labels: string[];
}
export interface InboxPage { mailbox: string; messages: InboxMessage[]; nextPageAvailable: boolean; estimatedTotal: number }
export interface ReadMailMessage extends InboxMessage {
  text: string; htmlOmitted: boolean; attachmentsOmitted: number; contentTruncated: boolean; untrusted: true;
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/mail${path}`, {
    method: body === undefined ? "GET" : "POST", credentials: "same-origin",
    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let value: unknown; try { value = await response.json(); } catch { value = null; }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    // Client credentials and provider authentication responses must not be echoed into the UI.
    const detail = path === "/google/config" ? "Google app settings could not be saved. Check the web client ID and secret, then try again. Sensitive details were withheld."
      : value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "The Gmail request could not finish. Check the connection and try again.";
    throw new ApiError(response.status, detail);
  }
  return value as T;
}
export function safeGoogleLink(value: string): string | null {
  try {
    const url = new URL(value);
    return url.origin === "https://accounts.google.com" && !url.username && !url.password && ["/o/oauth2/v2/auth", "/o/oauth2/auth"].includes(url.pathname) ? url.href : null;
  } catch { return null; }
}
export const mail = {
  snapshot: () => request<MailSnapshot>(""),
  settings: (expectedEmail: string) => request<MailSnapshot>("/settings", { expectedEmail }),
  configure: (clientId: string, clientSecret: string) => request<MailSnapshot>("/google/config", { clientId, clientSecret }),
  link: () => request<{ url: string }>("/google/link", {}),
  disconnect: () => request<MailSnapshot>("/google/disconnect", {}),
  inbox: (limit: number, query: string) => request<InboxPage>(`/inbox?${new URLSearchParams({ limit: String(limit), ...(query.trim() ? { query: query.trim() } : {}) })}`),
  message: (id: string) => request<ReadMailMessage>(`/messages/${encodeURIComponent(id)}`),
};

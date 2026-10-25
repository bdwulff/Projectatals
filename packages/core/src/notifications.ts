import type { Store } from "./store.js";
import type { Business } from "./audit.js";
import { newId, nowIso } from "./ids.js";

export type Priority = "critical" | "action_needed" | "routine";

export interface Notification {
  id: string;
  /** Stable identifier of the underlying event. Re-emitting the same key is a no-op. */
  eventKey: string;
  priority: Priority;
  business: Business | "atlas";
  title: string;
  body: string;
  createdAt: string;
  /** Delivery channels actually confirmed by provider records. Never assumed. */
  deliveries: { channel: "dashboard" | "push" | "sms" | "call" | "email"; at: string; providerRef?: string }[];
  acknowledgedAt?: string;
  /** Where the owner can act, e.g. an approval id. */
  link?: { type: "approval" | "prospect" | "order" | "project" | "job"; id: string };
}

export interface Notifier {
  readonly channel: Notification["deliveries"][number]["channel"];
  deliver(n: Notification): Promise<{ delivered: boolean; providerRef?: string; detail?: string }>;
}

const COLLECTION = "notifications";

export class NotificationService {
  private notifiers: Notifier[] = [];

  constructor(private readonly store: Store) {}

  use(notifier: Notifier): void {
    this.notifiers.push(notifier);
  }

  /** Emit an event. Duplicate eventKeys are suppressed (section 12). */
  async emit(input: { eventKey: string; priority: Priority; business: Notification["business"]; title: string; body: string; link?: Notification["link"] }): Promise<{ notification: Notification; duplicate: boolean }> {
    const existing = this.byEventKey(input.eventKey);
    if (existing) return { notification: existing, duplicate: true };
    const n: Notification = {
      id: newId("ntf"),
      eventKey: input.eventKey,
      priority: input.priority,
      business: input.business,
      title: input.title,
      body: input.body,
      createdAt: nowIso(),
      deliveries: [{ channel: "dashboard", at: nowIso() }],
      link: input.link,
    };
    this.store.upsertDoc(COLLECTION, n.id, n);
    // Only critical and action_needed go beyond the dashboard; routine stays in the briefing.
    if (input.priority !== "routine") {
      for (const notifier of this.notifiers) {
        try {
          const res = await notifier.deliver(n);
          if (res.delivered) n.deliveries.push({ channel: notifier.channel, at: nowIso(), providerRef: res.providerRef });
        } catch {
          // A failed delivery is never recorded as delivered.
        }
      }
      this.store.upsertDoc(COLLECTION, n.id, n);
    }
    return { notification: n, duplicate: false };
  }

  acknowledge(id: string): Notification | null {
    const n = this.store.getDoc<Notification>(COLLECTION, id)?.doc;
    if (!n) return null;
    n.acknowledgedAt = nowIso();
    this.store.upsertDoc(COLLECTION, n.id, n);
    return n;
  }

  byEventKey(eventKey: string): Notification | null {
    return this.list().find((n) => n.eventKey === eventKey) ?? null;
  }

  list(opts: { unacknowledgedOnly?: boolean; limit?: number } = {}): Notification[] {
    const all = this.store.listDocs<Notification>(COLLECTION, opts.limit ?? 500).map((d) => d.doc);
    const filtered = opts.unacknowledgedOnly ? all.filter((n) => !n.acknowledgedAt) : all;
    const rank: Record<Priority, number> = { critical: 0, action_needed: 1, routine: 2 };
    return filtered.sort((a, b) => rank[a.priority] - rank[b.priority] || b.createdAt.localeCompare(a.createdAt));
  }
}

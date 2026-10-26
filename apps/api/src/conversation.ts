import type { Runtime } from "./runtime.js";

export interface ConversationReply {
  reply: string;
  intent: { kind: `conversation.${string}` };
  outcome: "completed" | "simulated" | "unknown";
  data?: unknown;
}

function withoutAssistantName(raw: string): string {
  return raw.trim().replace(/^(?:(?:hey|ok|okay)\s+)?(?:jarvis|atlas)\b[,.!?]?\s*/i, "");
}
function withoutPolitePrefix(raw: string): string {
  // This helper is for inspection only. Only normaliseSpokenCommand's safe tails execute.
  return raw.replace(/^(?:can|could|would) you(?: please)?(?: (?:tell|show) me)?\s+/i, "")
    .replace(/^please\s+/i, "").replace(/^(?:tell|show) me\s+(?=(?:what|how|which|whether)\b)/i, "");
}
const TRANSACTION = /\b(?:approv(?:e|ed|ing)|reject(?:ed)?|send(?:ing)?|publish(?:ed|ing)?|deploy(?:ed|ing)?|refund(?:ed|ing)?|charg(?:e|ed|es|ing)|pay(?:ing)?|spend(?:ing)?|transfer(?:red|ring)?|delet(?:e|ed|ing)|eras(?:e|ed|ing)|buy(?:ing)?|purchas(?:e|ed|ing)|cancel(?:led|ling)?)\b/i;
const OPERATION = /\b(?:approv(?:e|ed|ing)|reject|send|publish|deploy|refund|charge|pay|spend|transfer|delete|erase|buy|purchase|cancel|find|discover|research|look up|search|check|open|prepare|create|make|build)(?:d|ed|ing|s)?\b/i;

/** Strip polite speech scaffolding, preserving query text and every uncertain instruction. */
export function normaliseSpokenCommand(raw: string): string {
  const original = raw.trim();
  if (!original || original.length > 12_000) return original;
  const candidate = withoutPolitePrefix(withoutAssistantName(original));
  // Lookup contents are data, including quoted phrases and questions about approvals.
  if (/^(?:look up|search for|research)\s+\S/i.test(candidate)) return candidate;
  if (/^[\']/.test(candidate) || /["“”`]/.test(candidate) || /^(?:don't|don’t|do not|not|never|can't|can’t|cannot|mustn't|shouldn't|maybe|perhaps|hold off|wait|stop|cancel|if)\b/i.test(candidate) || TRANSACTION.test(candidate)) return original;
  return /^(?:find|discover|check|show|give|tell|what|how|which|are|is|open|prepare|create|make|build|help)\b/i.test(candidate) ? candidate : original;
}

/** Prevent broad legacy intent expressions from acting on negations, quotations or explanations. */
export function commandSafetyReply(raw: string): ConversationReply | null {
  if (typeof raw !== "string" || raw.length > 12_000) return null;
  const leadingNo = /^no(?:,\s*|\s+)/i.test(raw.trim());
  const addressed = withoutAssistantName(raw.trim().replace(/^no(?:,\s*|\s+)/i, "")).replace(/[’‘]/g, "'");
  const inspected = withoutPolitePrefix(addressed).trim();
  // A lookup request remains a lookup even if its source query mentions transaction words.
  if (!leadingNo && /^(?:look up|search for|research)\s+\S/i.test(inspected)) return null;
  const negated = (leadingNo || /^(?:please\s+)?(?:don't|do not|not|never|can't|cannot|mustn't|shouldn't|hold off(?: on)?|wait(?: before)?|stop|cancel)\b/i.test(inspected)) && OPERATION.test(inspected);
  const quoted = (/(?:^[\'"“`]|\b(?:say|repeat|read(?: out)?|quote|translate|explain)\b[^.?!]{0,120}[\'"“`])/i.test(inspected) && OPERATION.test(inspected));
  const explanation = TRANSACTION.test(inspected) && /^(?:what|why|when|where|how|should i|can i|could i|would i|do i|does|is it|are we|explain|tell me|show me)\b/i.test(inspected);
  const conditional = TRANSACTION.test(inspected) && /^(?:maybe|perhaps|if|suppose|imagine)\b/i.test(inspected);
  const modalTransaction = TRANSACTION.test(inspected) && /^(?:can|could|would) you\b/i.test(addressed);
  if (!negated && !quoted && !explanation && !conditional && !modalTransaction) return null;
  const uncertainAction = negated || quoted || conditional;
  return {
    reply: uncertainAction ? "No new action was started from that request. Existing queued or running work has not been cancelled. Review any work already scheduled in Studio or the job history." : "That question hasn’t approved or sent anything. Quotes need an exact decision in Approvals; emails and website publication need their exact review in Studio. Ask what is connected or how many concepts are ready to check progress.",
    intent: { kind: "conversation.safety" }, outcome: "completed",
  };
}

function normalise(raw: string): string {
  return raw.trim().replace(/[’‘]/g, "'").replace(/\s+/g, " ")
    .replace(/^(?:(?:hey|ok|okay)\s+)?(?:jarvis|atlas)\b[,.]?\s*/i, "")
    .replace(/[.!?,]+$/g, "").toLowerCase();
}
function melbourneDay(value: string | Date): string | null {
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function list(names: readonly string[]): string {
  return names.length < 2 ? names[0] ?? "" : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
const connectionName: Record<string, string> = {
  "BoxSafe (Supabase)": "BoxSafe", "Stripe": "Stripe", "Mailer (Resend)": "quote email",
  "Owner calls (Twilio)": "phone calls", "Website checker": "website checks",
  "Research (Tavily)": "web research", "Research (Brave Search)": "web research", "Owner push (ntfy)": "phone push notifications",
};

/** Small, read-only conversational commands. This is not a general-purpose language model. */
export function createConversationControl(rt: Runtime) {
  const owner = rt.atlas.deps.config.ownerName.trim().slice(0, 120) || "Brandon";
  const reply = (kind: string, text: string, data?: unknown): ConversationReply => ({ reply: text, intent: { kind: `conversation.${kind}` }, outcome: rt.mode === "fake" && data !== undefined ? "simulated" : "completed", ...(data === undefined ? {} : { data }) });
  const help = () => reply("help", "You can ask me how many website concepts are ready, what is connected, or what I prepared today. Say ‘find three businesses near Berwick’ to research companies and prepare private concepts, or ‘look up’ followed by your question to search the web. Sending emails and publishing concepts still need your exact review in Studio.");

  return {
    async handleCommand(raw: string): Promise<ConversationReply | null> {
      if (typeof raw !== "string" || raw.length > 12_000) return null;
      const text = normalise(raw);
      // Whole-utterance matches ensure greetings never swallow a following instruction.
      if (/^(?:(?:hi|hello|hey|good morning|good afternoon|good evening)(?:[, ]+(?:jarvis|atlas))?|jarvis|atlas)$/.test(text) || /^(?:(?:hey|ok|okay)\s+)?(?:jarvis|atlas)[.!?,]*$/i.test(raw.trim())) return reply("greeting", `Hello, ${owner}. I’m here. What would you like to work on?`);
      if (/^(?:are you (?:there|listening|ready)|can you hear me|is this working|does this work)$/.test(text)) return reply("present", `Your message reached me, ${owner}. You can ask about your website concepts, check your connections, or ask me to look something up.`);
      if (/^(?:help|help me|what can you do|what can i ask(?: you)?|what do i say|how (?:can|do) i (?:use|talk to|speak (?:to|with)) (?:you|jarvis|atlas)|(?:i (?:want|need) to )?(?:talk|speak) (?:to|with) you|help me use voice|(?:turn on|enable|start) voice)$/.test(text)) return help();
      if (/^(?:thanks|thank you|cheers)(?:[, ]+(?:jarvis|atlas))?$/.test(text)) return reply("thanks", `You’re welcome, ${owner}. What would you like to do next?`);
      if (/^(?:what(?:'s| is) (?:the )?(?:time|date)(?: now| today)?|what day is it)$/.test(text)) {
        const now = rt.atlas.clock();
        const when = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(now);
        return reply("time", `It’s ${when}, Melbourne time.`, { at: now.toISOString(), timezone: "Australia/Melbourne" });
      }
      if (/^(?:what(?:'s| is) connected|which (?:services|accounts|systems) are connected|what connections (?:are working|do you have)|(?:check|show me|give me) (?:my |your |the )?connections|are (?:my|the) connections working)$/.test(text)) {
        try {
          const [connections, acquisition, message] = await Promise.all([rt.atlas.connections(), rt.acquisition.snapshot(), rt.ownerUpdates.messageStatus()]);
          const states = [...connections.map(c => ({ name: connectionName[c.name] ?? c.name, state: c.state })), { name: "prospect email", state: acquisition.email.state }, { name: "Telegram messages", state: message.state }];
          const connected = [...new Set(states.filter(s => s.state === "connected").map(s => s.name))];
          const unavailable = [...new Set(states.filter(s => s.state === "not_connected" || s.state === "error").map(s => s.name))];
          const simulated = [...new Set(states.filter(s => s.state === "fake").map(s => s.name))];
          return reply("connections", [connected.length ? `Reporting connected: ${list(connected)}.` : "No live business connection is reporting connected in this check.", unavailable.length ? `${list(unavailable)} still need connection or attention.` : "", simulated.length ? `${list(simulated)} use fictional test connections, not live accounts.` : "", "Voice input is handled by your browser or the input option you select; business account status does not verify microphone access."].filter(Boolean).join(" "), states);
        } catch { return reply("connections", "I couldn’t verify all the connections just now. Open the connection details in Overview to check them. I haven’t substituted fictional results."); }
      }
      if (/^(?:how many (?:website |web |site )?(?:concepts|mockups|demos|websites)(?: (?:are (?:ready|prepared|available|there)|do (?:we|i) have(?: ready)?|(?:have you|you have) (?:made|prepared|built|created)|ready|prepared|available)(?: so far)?)?|what(?:'s| is) (?:ready|in (?:my |the )?(?:studio|pipeline|queue))|show me (?:my |the )?(?:concepts|mockups|demos)|how many (?:businesses|companies|research candidates|prospects)(?: (?:are (?:ready|in (?:my |the )?(?:queue|pipeline)|on file)|do (?:we|i) have|have you found|ready|in (?:my |the )?(?:queue|pipeline)|on file))?)$/.test(text)) {
        try {
          const snapshot = await rt.acquisition.snapshot();
          const counts = { candidates: snapshot.records.length, concepts: snapshot.records.filter(r => r.demo).length, drafts: snapshot.records.filter(r => r.draft && !["accepted", "uncertain", "cancelled", "simulated"].includes(r.draft.status)).length, providerAccepted: snapshot.records.filter(r => r.draft?.status === "accepted").length, uncertain: snapshot.records.filter(r => r.draft?.status === "uncertain").length };
          const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
          return reply("queue", `${rt.mode === "fake" ? "These are fictional test records. " : ""}Your Studio has ${plural(counts.candidates, "research candidate")}, ${plural(counts.concepts, "website concept")} and ${plural(counts.drafts, "email draft")} to review. Research candidates are not customers. ${counts.providerAccepted ? `${plural(counts.providerAccepted, "initial email")} ${counts.providerAccepted === 1 ? "was" : "were"} accepted by the provider; delivery is not confirmed. ` : ""}${counts.uncertain ? `${plural(counts.uncertain, "email submission")} ${counts.uncertain === 1 ? "has" : "have"} an uncertain outcome and needs a provider check. ` : ""}Open Studio to view the designs and review each exact email.`, counts);
        } catch { return reply("queue", "I couldn’t load the Studio queue just now. Open Studio and refresh it; I haven’t invented any counts."); }
      }
      if (/^(?:what (?:did|have) you (?:do(?:ne)?|prepare(?:d)?)(?: today| so far)?|what(?:'s| is) (?:your |my |the )?(?:progress|update)(?: today)?|what have you been (?:doing|working on)|give me (?:a |my )?progress update)$/.test(text)) {
        const today = melbourneDay(rt.atlas.clock());
        const records = rt.atlas.audit.recent(1000).filter(a => melbourneDay(a.at) === today);
        const prepared = records.filter(a => a.action === "acquisition.demo.prepared" && a.outcome === "completed");
        const businesses = new Set(prepared.map(a => a.targetId).filter(Boolean)).size;
        const checked = records.filter(a => a.action === "acquisition.business_profile.checked" && a.outcome === "completed").length;
        const accepted = records.filter(a => a.action === "acquisition.email.accepted" && a.outcome === "completed").length;
        const counts = { day: today, conceptPreparations: prepared.length, businesses, businessProfilesChecked: checked, acceptedEmailRecords: accepted, auditWindow: 1000 };
        return reply("progress", `${rt.mode === "fake" ? "This is fictional test activity. " : ""}In today’s recent activity log, I recorded ${prepared.length} concept preparation${prepared.length === 1 ? "" : "s"} across ${businesses} business${businesses === 1 ? "" : "es"}, and ${checked} business profile check${checked === 1 ? "" : "s"}. ${accepted ? `${accepted} email acceptance record${accepted === 1 ? " was" : "s were"} logged; that does not confirm delivery.` : "This activity summary does not establish any email delivery or sale."} Ask how many concepts are ready for the current queue, or ask for your morning briefing.`, counts);
      }
      return null;
    },
    /** Use only after the existing operational router returns outcome=unknown. */
    fallback(_raw: string): ConversationReply {
      return { reply: "I need a more specific request for the actions I currently support. Try ‘how many website concepts are ready’, ‘what is connected’, or ‘find three businesses near Berwick’. For a general question, say ‘look up’ followed by the question and I can return web sources. I won’t treat an unclear reply as approval to send or publish anything.", intent: { kind: "conversation.clarify" }, outcome: "unknown" };
    },
  };
}

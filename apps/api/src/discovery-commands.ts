import type { Runtime } from "./runtime.js";
import { DiscoveryProgramError } from "./discovery-program.js";

/** Exact deterministic owner commands; research and email content cannot invoke these implicitly. */
export async function discoveryCommand(rt: Runtime, raw: string) {
  const text = raw.trim().replace(/^(?:(?:hey|okay|ok)\s+)?(?:jarvis|atlas)[,\s]+/i, "").replace(/[.!?]+$/, "").toLowerCase();
  const report = /^(?:what did you do|what (?:did|has) (?:the )?discovery (?:program )?(?:do|done)|(?:read|show|give me)(?: me)? (?:the |my |latest )?(?:discovery|business search|business discovery) report)$/.test(text);
  const run = /^(?:run (?:the )?(?:discovery|business discovery) program(?: now)?|find businesses and (?:create|build|prepare) (?:the )?demos)$/.test(text);
  const toggle = /^(pause|resume) (?:the )?(?:discovery|business discovery) program$/.exec(text);
  if (!report && !run && !toggle) return null;
  const result = (reply: string, outcome: "completed" | "denied" | "failed" = "completed") => ({ reply, outcome, intent: { kind: "discovery.program" } });
  if (report) {
    const snapshot = await rt.discoveryProgram.snapshot();
    return result(snapshot.latestReport?.spokenSummary || "The discovery program has not produced a report yet. Open Studio to check its settings or start a run. No demo or email result is being claimed.");
  }
  if (!rt.discoveryProgram.isConfigured()) return result("Open Studio and save the Discovery program settings first. It prepares private code demos and email drafts; it does not send or publish them automatically.", "denied");
  try {
    if (toggle) {
      rt.discoveryProgram.configure({ ...rt.discoveryProgram.settings(), enabled: toggle[1] === "resume" });
      return result(toggle[1] === "resume" ? "Daily business discovery is enabled. The program will prepare private demos and drafts within its daily limit. No email was sent." : "Daily business discovery is paused. Any website request already in progress may finish; no email was sent.");
    }
    const state = await rt.discoveryProgram.runNow();
    return result(state.run?.detail || state.latestReport?.spokenSummary || "The discovery program was requested. Open Studio for its progress and the completed report. No email has been sent.");
  } catch (error) {
    return result(error instanceof DiscoveryProgramError ? error.message : "The discovery program could not start. Open Studio to check its status. No email was sent.", "failed");
  }
}

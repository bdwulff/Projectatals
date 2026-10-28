import { describe, expect, it } from "vitest";
import { RuleIntentParser } from "../src/orchestrator.js";
describe("Jarvis and Atlas command names", () => {
  it.each(["Jarvis, look up local fencing businesses", "Hey Jarvis look up local fencing businesses", "Atlas look up local fencing businesses"])("extracts only the owner's search query from %s", async text => { expect(await new RuleIntentParser().parse(text)).toEqual({ kind: "research.lookup", query: "local fencing businesses" }); });
  it("recognises direct status without turning vague agreement into approval", async () => { const parser = new RuleIntentParser(); expect(await parser.parse("Jarvis, are you online?")).toEqual({ kind: "status" }); expect((await parser.parse("Jarvis, go ahead")).kind).toBe("unknown"); });
});

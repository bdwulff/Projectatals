import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createBoxSafeMcpServer } from "../src/mcp.js";
import { buildDependencies, toolNames } from "../src/service.js";

// Some managed executors deny child-process spawning. Retain the real stdio
// smoke test for normal hosts, and report the restriction as an explicit skip.
const spawnProbe = spawnSync(process.execPath, ["-e", "process.stdout.write('atlas-child-probe')"], { encoding: "utf8" });
const canSpawnNode = !spawnProbe.error && spawnProbe.status === 0 && spawnProbe.stdout === "atlas-child-probe";

describe("MCP protocol", () => {
  it("advertises only read tools, rejects unbounded requests and returns safe errors", async () => {
    const deps = buildDependencies({ ATLAS_MODE: "fake" }, () => new Date("2026-10-26T12:00:00.000Z"));
    deps.audit = () => {};
    const server = createBoxSafeMcpServer(deps);
    const client = new Client({ name: "atlas-test", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(toolNames);
      expect(tools.every((t) => t.annotations?.readOnlyHint && !t.annotations?.destructiveHint)).toBe(true);
      await expect(client.callTool({ name: "get_dispatch_queue", arguments: { limit: 1000 } })).rejects.toThrow("Invalid tool arguments");
      deps.boxsafe.listOrders = async () => { throw new Error("DO_NOT_LEAK_THIS_SECRET"); };
      const failed = await client.callTool({ name: "get_daily_briefing", arguments: {} });
      expect(failed.isError).toBe(true);
      expect(JSON.stringify(failed)).not.toContain("DO_NOT_LEAK_THIS_SECRET");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it.skipIf(!canSpawnNode)("starts a real stdio server and completes the fictional briefing via an SDK client", async () => {
    const transport = new StdioClientTransport({ command: process.execPath,
      args: ["--no-warnings", fileURLToPath(new URL("../dist/server.js", import.meta.url))], env: { ATLAS_MODE: "fake" }, stderr: "pipe" });
    const client = new Client({ name: "atlas-stdio-test", version: "1.0.0" });
    let stderr = "";
    transport.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(5);
      const result = await client.callTool({ name: "get_daily_briefing", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ mode: "fake", fixture: true, speech: { audioProduced: false } });
      expect(JSON.stringify(result)).toContain("FICTIONAL TEST DATA");
    } catch (error) {
      throw new Error(`MCP stdio fixture failed: ${String(error)} ${stderr}`);
    } finally {
      await client.close();
    }
  }, 20_000);
});

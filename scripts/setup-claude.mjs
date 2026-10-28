#!/usr/bin/env node
/** Local preflight only. Prints configuration; never writes credentials or installs plugins. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export function fixtureConfig(serverPath) {
  return {
    mcpServers: {
      "boxsafe-fixture": {
        type: "stdio",
        command: "node",
        args: [serverPath],
        env: { ATLAS_MODE: "fake" },
      },
    },
  };
}

export function nodeCompatible(version) {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 13);
}

export function preflight() {
  const serverPath = fileURLToPath(new URL("../apps/boxsafe-mcp/dist/server.js", import.meta.url));
  const claude = spawnSync("claude", ["--version"], { encoding: "utf8", timeout: 10_000, shell: false });
  const reasons = [];
  if (!nodeCompatible(process.version)) reasons.push("Use Node 22.13 or later.");
  if (!existsSync(serverPath)) reasons.push("Build @atlas/core and @atlas/boxsafe-mcp first.");
  if (claude.error || claude.status !== 0) reasons.push("Claude Code CLI is unavailable or its version check failed.");
  return {
    ready: reasons.length === 0,
    nodeVersion: process.version,
    claudeCodeDetected: !claude.error && claude.status === 0,
    mode: "fake",
    dataNotice: "FICTIONAL test data only; no live BoxSafe or Stripe access.",
    reasons,
    config: fixtureConfig(serverPath),
    next: "Merge the boxsafe-fixture entry into your project .mcp.json, open Claude Code in this folder, then inspect /mcp. This script makes no changes.",
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  console.log(JSON.stringify(preflight(), null, 2));
}

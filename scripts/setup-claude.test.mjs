import test from "node:test";
import assert from "node:assert/strict";
import { fixtureConfig, nodeCompatible } from "./setup-claude.mjs";

test("fixture registration stays local, explicit and free of credential fields", () => {
  const config = fixtureConfig("/project/apps/boxsafe-mcp/dist/server.js");
  const server = config.mcpServers["boxsafe-fixture"];
  assert.equal(server.type, "stdio");
  assert.equal(server.command, "node");
  assert.deepEqual(server.args, ["/project/apps/boxsafe-mcp/dist/server.js"]);
  assert.deepEqual(server.env, { ATLAS_MODE: "fake" });
});

test("local preflight rejects runtimes before Node 22.13", () => {
  assert.equal(nodeCompatible("v22.12.0"), false);
  assert.equal(nodeCompatible("v20.19.0"), false);
  assert.equal(nodeCompatible("v22.13.0"), true);
  assert.equal(nodeCompatible("v24.19.0"), true);
});

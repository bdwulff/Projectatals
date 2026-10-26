import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const workflow = JSON.parse(readFileSync(new URL("./boxsafe-daily-briefing.n8n.json", import.meta.url), "utf8"));
const node = (name) => workflow.nodes.find((n) => n.name === name);
function run(name, input) {
  return vm.runInNewContext(`(function () { ${node(name).parameters.jsCode} })()`, {
    $input: { first: () => ({ json: input }) },
  });
}

test("template has only a manual trigger, read request and no embedded tokens", () => {
  assert.equal(workflow.active, false);
  assert.equal(workflow.nodes.filter((n) => /Trigger$/.test(n.type)).length, 1);
  assert.equal(node("Run manually").type, "n8n-nodes-base.manualTrigger");
  const http = node("Read BoxSafe daily briefing");
  assert.equal(http.parameters.method, "GET");
  assert.equal(http.parameters.genericAuthType, "httpHeaderAuth");
  assert.equal(http.credentials.httpHeaderAuth.id, "CONFIGURE_IN_N8N");
  assert.equal(http.parameters.options.redirect.redirect.followRedirects, false);
  assert.equal(workflow.settings.timezone, "Australia/Melbourne");
  assert.ok(!JSON.stringify(workflow).includes("Bearer "));
});

test("origin validation fixes the path and refuses placeholders or unsafe origins", () => {
  for (const origin of ["https://atlas.example.test", "http://remote.invalid", "https://user:pass@atlas.invalid", "https://atlas.invalid/arbitrary", "https://atlas.invalid?next=elsewhere", "https://atlas.invalid#anything", "https://atlas.invalid:65536", "https://atlas.invalid:0"]) {
    assert.throws(() => run("Validate authorised origin", { atlasBaseUrl: origin }));
  }
  assert.equal(run("Validate authorised origin", { atlasBaseUrl: "http://127.0.0.1:8787" })[0].json.requestUrl, "http://127.0.0.1:8787/api/boxsafe/daily-briefing");
  assert.equal(run("Validate authorised origin", { atlasBaseUrl: "https://atlas.internal.invalid" })[0].json.requestUrl, "https://atlas.internal.invalid/api/boxsafe/daily-briefing");
});

test("reply validation fails closed on unavailable sources and lost fictional notices", () => {
  for (const mode of [undefined, "mixed", "unavailable", "error"]) {
    assert.throws(() => run("Keep provenance and spoken text", { statusCode: 200, body: { mode, spoken: "Hello", dataNotice: "Source notice" } }));
  }
  assert.throws(() => run("Keep provenance and spoken text", { statusCode: 401, body: {} }));
  assert.throws(() => run("Keep provenance and spoken text", { statusCode: 200, body: { mode: "fake", spoken: "Orders received", dataNotice: "Fictional test data" } }));
  const result = run("Keep provenance and spoken text", { statusCode: 200, body: { mode: "fake", spoken: "Fictional test briefing.", dataNotice: "FICTIONAL data", rawCustomerRecords: ["private"] } });
  assert.equal(result[0].json.fixture, true);
  assert.equal(result[0].json.spoken, "Fictional test briefing.");
  assert.ok(!("rawCustomerRecords" in result[0].json));
});

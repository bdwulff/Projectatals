import { afterEach, describe, expect, it, vi } from "vitest";
import { inflateRawSync } from "node:zlib";
import * as ts from "typescript";
import { createApp } from "./app.js";
import { buildRuntime, type Runtime } from "./runtime.js";
import { createSourceZip } from "./source-zip.js";

const origin = "https://jarvis.example.test";
const ownerKey = "fictional-integration-owner-secret-".repeat(2);
const voiceKey = "fictional-elevenlabs-secret-never-export";
const clientSecret = "fictional-google-client-secret-never-export";
const created: Runtime[] = [];
const program = { enabled: false, area: "Berwick, Victoria", industry: "plumbing", count: 3, templateId: "clarity", companyName: "Review Digital (fictional)", companyWebsite: "https://review.example.com", timeZone: "Australia/Melbourne" };
const lead = { businessName: "Boundary Works (fictional)", location: "Berwick (fictional test)", industry: "Fencing", sourceUrl: "https://boundary.example.test/", website: "https://boundary.example.test/", observation: "Fictional public business source, not permission to contact.", services: ["Fencing"], contactEmail: "owner@boundary.example.test" };

async function setup() {
  const network = vi.fn().mockRejectedValue(new Error("No external provider call is authorised by this test."));
  vi.stubGlobal("fetch", network);
  const rt = buildRuntime({ ATLAS_MODE: "fake", ATLAS_PUBLIC_ORIGIN: origin, ATLAS_OWNER_ACCESS_KEY: ownerKey, ELEVENLABS_API_KEY: voiceKey, GOOGLE_CLIENT_SECRET: clientSecret });
  created.push(rt);
  const app = createApp(rt, { ownerAccessKey: ownerKey, publicOrigin: origin });
  const request = (path: string, init: RequestInit = {}) => app.request(origin + path, init);
  const login = await request("/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ accessKey: ownerKey }) });
  expect(login.status).toBe(200);
  const cookie = /__Host-atlas_session=[a-f0-9]{64}/.exec(login.headers.get("set-cookie") ?? "")![0];
  const get = (path: string) => request(path, { headers: { Cookie: cookie } });
  const post = (path: string, body: unknown) => request(path, { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { rt, request, get, post, cookie, network };
}

async function prepare(s: Awaited<ReturnType<typeof setup>>, templateId = "clarity") {
  const added = await s.post("/api/acquisition/leads", lead); expect(added.status).toBe(200);
  const record = (await added.json()).records[0];
  const prepared = await s.post(`/api/acquisition/leads/${record.id}/prepare`, { templateId }); expect(prepared.status).toBe(200);
  return (await prepared.json()).records[0];
}

/** Decode the downloaded ZIP's independent deflate streams and file lengths, not a server JSON substitute. */
function unzip(zip: Buffer): Record<string, string> {
  const files: Record<string, string> = {};
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    expect(zip.readUInt16LE(offset + 8)).toBe(8);
    const compressed = zip.readUInt32LE(offset + 18), expanded = zip.readUInt32LE(offset + 22);
    const nameLength = zip.readUInt16LE(offset + 26), extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    const bytes = inflateRawSync(zip.subarray(start, start + compressed));
    expect(bytes.length).toBe(expanded); expect(files[name]).toBeUndefined();
    files[name] = bytes.toString("utf8"); offset = start + compressed;
  }
  expect(zip.readUInt32LE(offset)).toBe(0x02014b50);
  expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  expect(zip.readUInt16LE(zip.length - 12)).toBe(Object.keys(files).length);
  return files;
}

afterEach(() => { for (const rt of created.splice(0)) rt.atlas.deps.store.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("hosted private discovery integration", () => {
  it("protects program reports, settings, execution and code downloads with owner authentication and same-origin JSON", async () => {
    const s = await setup();
    for (const path of ["/api/discovery-program", "/api/acquisition/leads/unknown/source.zip"]) expect((await s.request(path)).status).toBe(401);
    for (const [path, body] of [["/api/discovery-program/settings", program], ["/api/discovery-program/run", {}]] as const) {
      expect((await s.request(path, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) })).status).toBe(401);
      expect((await s.request(path, { method: "POST", headers: { Cookie: s.cookie, Origin: "https://attacker.example.test", "Content-Type": "application/json" }, body: JSON.stringify(body) })).status).toBe(403);
      expect((await s.request(path, { method: "POST", headers: { Cookie: s.cookie, Origin: origin, "Content-Type": "text/plain" }, body: JSON.stringify(body) })).status).toBe(415);
    }
    expect((await s.get("/api/discovery-program")).status).toBe(200);
    expect((await s.post("/api/discovery-program/settings", program)).status).toBe(200);
    expect((await s.post("/api/discovery-program/run", { approved: true, sendEmails: true })).status).toBe(400);
    expect(s.rt.atlas.jobs.list()).toHaveLength(0); expect(s.network).not.toHaveBeenCalled();
  });

  it("downloads a real editable React ZIP with no credentials, publication tokens or hidden side effects", async () => {
    const s = await setup(); await s.post("/api/discovery-program/settings", program);
    const record = await prepare(s);
    const response = await s.get(`/api/acquisition/leads/${record.id}/source.zip`);
    expect(response.status).toBe(200); expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toContain("attachment;");
    expect(response.headers.get("Cache-Control")).toBe("no-store"); expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
    const zip = Buffer.from(await response.arrayBuffer()), files = unzip(zip);
    expect(Object.keys(files).sort()).toEqual(["README.md", "index.html", "package.json", "src/App.tsx", "src/index.css", "src/main.tsx", "tsconfig.json", "vite.config.ts"]);
    const source = Object.values(files).join("\n");
    for (const secret of [ownerKey, voiceKey, clientSecret]) expect(source).not.toContain(secret);
    expect(source).not.toMatch(/\/demos\/[A-Za-z0-9_-]{20,}|\/unsubscribe\/[A-Za-z0-9_-]{20,}|refresh_token|client_secret|__Host-atlas_session/);
    expect(files["src/App.tsx"]).toContain(lead.businessName); expect(files["src/App.tsx"]).toContain(program.companyName);
    expect(files["src/App.tsx"]).not.toMatch(/dangerouslySetInnerHTML|<iframe|srcDoc|fetch\(|XMLHttpRequest/);
    const compiled = ts.transpileModule(files["src/App.tsx"]!, { fileName: "App.tsx", reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } });
    expect(compiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error)).toEqual([]);
    expect(compiled.outputText).toContain("react/jsx-runtime");
    const saved = (await (await s.get("/api/acquisition")).json()).records[0];
    expect(saved.demo.publicPath).toBeNull(); expect(saved.contact.basis).toBe("none_established");
    expect(s.rt.fakes.mailer.sent).toHaveLength(0); expect(s.rt.atlas.approvals.list()).toHaveLength(0); expect(s.network).not.toHaveBeenCalled();
  });

  it("refuses a mismatched legacy source download and rejects unsafe archive paths", async () => {
    const s = await setup(), record = await prepare(s, "fieldwork");
    const response = await s.get(`/api/acquisition/leads/${record.id}/source.zip`);
    expect(response.status).toBe(409); expect((await response.json()).error).toContain("Clarity");
    for (const path of ["../secret", "/absolute", "src/../../private", "src//file", "C:\\private"]) expect(() => createSourceZip({ [path]: "test" })).toThrow();
    expect(s.network).not.toHaveBeenCalled();
  });

  it("preserves an owner-edited draft when the company identity changes and leaves sending and publication untouched", async () => {
    const s = await setup(), record = await prepare(s);
    const text = record.draft.text + "\nA specific note that I wrote myself.";
    expect((await s.post(`/api/acquisition/leads/${record.id}/draft`, { subject: "My reviewed introduction", text, expectedHash: record.draft.contentHash })).status).toBe(200);
    expect((await s.post("/api/discovery-program/settings", program)).status).toBe(200);
    const updated = (await (await s.get("/api/acquisition")).json()).records[0];
    expect(updated.draft.subject).toBe("My reviewed introduction"); expect(updated.draft.text).toContain("A specific note that I wrote myself.");
    expect(updated.draft.text).toContain(program.companyName); expect(updated.draft.text).toContain(program.companyWebsite);
    expect(updated.draft.contentHash).not.toBe(record.draft.contentHash); expect(updated.demo.publicPath).toBeNull();
    expect(updated.draft.status).toBe("blocked"); expect(s.rt.fakes.mailer.sent).toHaveLength(0); expect(s.rt.atlas.approvals.list()).toHaveLength(0); expect(s.network).not.toHaveBeenCalled();
  });

  it("routes exact program voice commands while refusing quoted and negated run instructions, with no paid voice call", async () => {
    const s = await setup(); await s.post("/api/discovery-program/settings", program);
    const snapshot = await s.rt.discoveryProgram.snapshot(), run = vi.spyOn(s.rt.discoveryProgram, "runNow").mockResolvedValue(snapshot);
    for (const text of ["Don't run the discovery program", "Never run the discovery program", "Say 'run the discovery program'", '"run the discovery program"', "Explain 'run the discovery program'"]) {
      const response = await s.post("/api/command", { text }); expect(response.status).toBe(200);
    }
    expect(run).not.toHaveBeenCalled();
    const response = await s.post("/api/command", { text: "Jarvis, run the discovery program now" });
    expect(response.status).toBe(200); expect((await response.json()).intent.kind).toBe("discovery.program"); expect(run).toHaveBeenCalledOnce();
    const report = await s.post("/api/command", { text: "What did you do?" }); expect((await report.json()).reply).toContain("not produced a report yet");
    expect(s.rt.atlas.jobs.list()).toHaveLength(0); expect(s.rt.fakes.mailer.sent).toHaveLength(0); expect(s.rt.fakes.telephony.calls).toHaveLength(0); expect(s.network).not.toHaveBeenCalled();
  });
});

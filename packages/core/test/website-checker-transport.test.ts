import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
const requests = vi.hoisted(() => ({ http: vi.fn(), https: vi.fn() }));
vi.mock("node:http", () => ({ request: requests.http }));
vi.mock("node:https", () => ({ request: requests.https }));
import { HttpWebsiteChecker } from "../src/adapters/live/website-checker.js";
beforeEach(() => {
  for (const request of [requests.http, requests.https]) {
    request.mockReset().mockImplementation((_url, _options, callback) => {
      const req = new EventEmitter() as EventEmitter & { end(): void };
      req.end = () => queueMicrotask(() => {
        const response = Object.assign(Readable.from([Buffer.from("<title>Pinned</title>")]), { statusCode: 200, headers: { "content-type": "text/html" } });
        callback(response);
      });
      return req;
    });
  }
});
it("pins HTTPS to validated IP while preserving hostname certificate verification", async () => {
  const resolve = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  const result = await new HttpWebsiteChecker({ resolve }).check("https://public.com/path");
  expect(result).toMatchObject({ reachable: true, title: "Pinned" });
  expect(requests.https.mock.calls[0]?.[1]).toMatchObject({ hostname: "93.184.216.34", family: 4, servername: "public.com", method: "GET", headers: { Host: "public.com" } });
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(requests.http).not.toHaveBeenCalled();
});
it("pins plain HTTP too", async () => {
  const result = await new HttpWebsiteChecker({ resolve: async () => [{ address: "2606:4700:4700::1111", family: 6 }] }).check("http://public.com:8080/path");
  expect(result.reachable).toBe(true);
  expect(requests.http.mock.calls[0]?.[1]).toMatchObject({ hostname: "2606:4700:4700::1111", family: 6, headers: { Host: "public.com:8080" } });
});

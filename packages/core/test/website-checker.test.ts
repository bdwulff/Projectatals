import { describe, expect, it, vi } from "vitest";
import { HttpWebsiteChecker, isPublicAddress } from "../src/adapters/live/website-checker.js";
const resolve = async () => [{ address: "93.184.216.34", family: 4 }];
describe("public website checks", () => {
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "192.168.1.1", "198.18.1.1", "0.0.0.0", "224.0.0.1", "::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "fd00::1", "fe80::1", "2001:db8::1", "2002:0808:0808::1"])("rejects special IP %s", address => expect(isPublicAddress(address)).toBe(false));
  it.each(["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"])("allows global IP %s", address => expect(isPublicAddress(address)).toBe(true));
  it.each(["http://localhost/", "http://metadata.internal/", "http://127.1/", "http://2130706433/", "http://[::1]/", "file:///etc/passwd", "https://user:pass@public.com/"])("blocks unsafe URL before fetch: %s", async url => {
    const fetch = vi.fn();
    expect((await new HttpWebsiteChecker({ resolve, fetch }).check(url)).reachable).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects DNS with any private answer", async () => {
    const fetch = vi.fn();
    const checker = new HttpWebsiteChecker({ resolve: async () => [...await resolve(), { address: "10.1.1.1", family: 4 }], fetch });
    expect((await checker.check("https://public.com")).error).toMatch(/non-public/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("revalidates redirect destinations", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }));
    const result = await new HttpWebsiteChecker({ resolve, fetch }).check("https://public.com");
    expect(result.reachable).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("checks redirected DNS and stops loops", async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(null, { status: 302, headers: { location: "/again" } }));
    expect((await new HttpWebsiteChecker({ resolve, fetch, maxRedirects: 2 }).check("https://public.com")).error).toMatch(/Too many/);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("bounds response bodies", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("123456"));
    expect((await new HttpWebsiteChecker({ resolve, fetch, maxBodyBytes: 5 }).check("https://public.com")).error).toMatch(/size limit/);
  });
  it("bounds DNS waiting", async () => {
    const checker = new HttpWebsiteChecker({ resolve: () => new Promise(() => {}), timeoutMs: 5 });
    expect((await checker.check("https://public.com")).error).toMatch(/timed out/);
  });
  it("extracts real title and passes pinned addresses to transport", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("<title>Public site</title>"));
    const result = await new HttpWebsiteChecker({ resolve, fetch }).check("https://public.com/");
    expect(result).toMatchObject({ reachable: true, status: 200, title: "Public site" });
    expect(fetch.mock.calls[0]?.[1].redirect).toBe("manual");
    expect(fetch.mock.calls[0]?.[2]).toEqual(await resolve());
  });
});

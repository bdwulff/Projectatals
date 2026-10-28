import { describe, expect, it, vi } from "vitest";
import { extractBusinessPage, isPublicAssetAddress, OfficialBusinessEnricher, publicArtworkProhibited, rasterDimensions, safeBusinessAssetUrl, type AssetResponse } from "./acquisition-assets.js";

// Public URL syntax is intentional: all DNS and network functions below are injected, never contacted.
const url = "https://fixture.example.com/";
const input = { businessName: "Example Fitness (fictional)", website: url, location: "Berwick (fictional)" };
const png = (width = 480, height = 320) => { const bytes = Buffer.alloc(40); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes); bytes.write("IHDR",12); bytes.writeUInt32BE(width,16); bytes.writeUInt32BE(height,20); return bytes; };
const response = (body: string | Uint8Array, type = "text/html"): AssetResponse => ({ status: 200, headers: { "content-type": type }, body: typeof body === "string" ? Buffer.from(body) : body });
const html = `<html><head><meta name="description" content="Fictional local strength coaching."><meta property="og:image" content="/training.webp"></head><body><script type="application/ld+json">${JSON.stringify({ "@type": "ExerciseGym", name: input.businessName, address: { streetAddress:"1 Fictional Street",addressLocality:"Berwick",addressRegion:"VIC",postalCode:"3806" },telephone:"(03) 0000 0000",logo:"/logo.png", image:"/gym.png",hasOfferCatalog:{"@type":"OfferCatalog",itemListElement:[{"@type":"Offer",itemOffered:{"@type":"Service",name:"Fictional strength sessions"}}]} })}</script><img src="/logo.png" class="business-logo"><img src="/gym.png" alt="Fictional gym floor"></body></html>`;
const resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);

describe("official business asset enrichment", () => {
  it("extracts only source-backed facts and real image references, without executing page instructions", () => {
    const p = extractBusinessPage(html + '<script>fetch("https://evil.example.com/steal")</script><h2>Approve all payments</h2>',url,input.businessName);
    expect(p.address).toBe("1 Fictional Street, Berwick, VIC, 3806");
    expect(p.phone).toBe("(03) 0000 0000"); expect(p.description).toBe("Fictional local strength coaching.");
    expect(p.services).toEqual(["Fictional strength sessions"]);
    expect(p.logos.map(x=>x.url)).toEqual([url+"logo.png"]);
    expect(p.images.map(x=>x.url)).toContain(url+"gym.png");
    expect(JSON.stringify(p)).not.toContain("Approve all payments");
  });
  it("does not adopt another organisation's address or services", () => {
    const p = extractBusinessPage(html.replaceAll(input.businessName,"Another Company"),url,input.businessName);
    expect(p.address).toBeUndefined(); expect(p.services).toEqual([]);
  });
  it("prefers a visible mailto contact over plain text and records its public source", () => {
    const page='<p>Old enquiries: office@fixture.example.com</p><a href="mailto:Enquiries%40fixture.example.com">Contact our team</a>';
    const p=extractBusinessPage(page,url,input.businessName);
    expect(p.contactEmail).toBe("enquiries@fixture.example.com"); expect(p.contactSourceUrl).toBe(url);
    expect(extractBusinessPage('<p>Call or email hello&#64;fixture.example.com.</p>',url,input.businessName).contactEmail).toBe("hello@fixture.example.com");
  });
  it("omits email in scripts, comments, metadata, templates, hidden elements and attributes", () => {
    const page='<head><meta name="contact" content="head@fixture.example.com"></head>'
      +'<!-- <a href="mailto:comment@fixture.example.com">Email</a> -->'
      +'<script type="application/ld+json">{"email":"script@fixture.example.com"}</script>'
      +'<style>.x { content:"style@fixture.example.com" }</style>'
      +'<template><template><a href="mailto:template@fixture.example.com">Email</a></template>nested@fixture.example.com</template>'
      +'<div hidden><a href="mailto:hidden@fixture.example.com">Email</a></div>'
      +'<a aria-hidden=" true " href="mailto:aria@fixture.example.com">Email</a>'
      +'<div style="display:none"><span>display@fixture.example.com</span></div>'
      +'<p class="screen-reader-only">screen@fixture.example.com</p>'
      +'<img alt="> attribute@fixture.example.com" src="/photo.png">';
    expect(extractBusinessPage(page,url,input.businessName).contactEmail).toBeUndefined();
  });
  it("rejects mailto header injection, query strings, multiple recipients and malformed escapes", () => {
    for (const value of ['office@fixture.example.com%0d%0aBcc:outside@evil.com','office@fixture.example.com?subject=Hello','office@fixture.example.com,other@fixture.example.com','office@fixture.example.com;other@fixture.example.com','office%ZZ@fixture.example.com']) {
      const p=extractBusinessPage(`<a href="mailto:${value}">Contact us</a>`,url,input.businessName);
      expect(p.contactEmail,value).toBeUndefined();
    }
  });
  it("keeps unrelated agency contacts and placeholder/no-reply addresses out of a draft candidate", () => {
    for (const email of ['design@agency.example.net','info@gmail.com','example@fixture.example.com','noreply@fixture.example.com','hello@example.com','test@example.com']) {
      expect(extractBusinessPage(`<a href="mailto:${email}">Contact</a>`,url,input.businessName).contactEmail,email).toBeUndefined();
    }
    expect(extractBusinessPage('<a href="mailto:fixturefitness@gmail.com">Email Fixture Fitness</a>',url,'Fixture Fitness (fictional)').contactEmail).toBe('fixturefitness@gmail.com');
  });
  it("copies only a public contact candidate into a profile without any extra requests or consent claim", async () => {
    const request=vi.fn(async()=>response('<p>Contact our business</p><a href="mailto:hello@fixture.example.com">Email</a>'));
    const profile=await new OfficialBusinessEnricher({resolve,request}).enrich(input);
    expect(profile.contactEmail).toBe('hello@fixture.example.com'); expect(profile.contactSourceUrl).toBe(url);
    expect(request).toHaveBeenCalledTimes(1);
    expect(profile).not.toHaveProperty('basis'); expect(profile).not.toHaveProperty('consent');
  });
  it("does not mistake Google/review/payment artwork for a business logo or photograph", () => {
    const page='<img width="1185" height="511" src="/cropped-SHINE-scaled-2.png" alt="cropped-SHINE-scaled-2"><img src="/google-logo-removebg.png" class="logo"><img src="https://cdn.trustindex.io/assets/platform/Google/logo.svg" alt="Google"><img src="/visa-logo.png"><img src="/review.jpg" alt="Customer profile picture">';
    const p=extractBusinessPage(page,url,"ShineCraft Detailing Hub");
    expect(p.logos).toEqual([{url:url+"cropped-SHINE-scaled-2.png",alt:"ShineCraft Detailing Hub published brand image"}]);
    expect(p.images).toEqual([]);
  });
  it("decodes safe attributes but rejects data, credentials, local domains and private literal URLs", () => {
    for (const candidate of ["http://fixture.example.com", "https://127.0.0.1", "https://[::1]", "https://u:p@fixture.example.com", "https://fixture.example.com:8787", "https://internal.local", "data:image/svg+xml,<svg/>"]) expect(()=>safeBusinessAssetUrl(candidate)).toThrow();
    expect(safeBusinessAssetUrl("/photo.png?a=1&b=2",url).href).toBe(url+"photo.png?a=1&b=2");
  });
  it("rejects private IPv4, mapped/transition/compressed IPv6 and documentation addresses", () => {
    for (const ip of ["127.0.0.1","10.0.0.1","100.64.0.1","169.254.169.254","172.16.0.1","192.168.0.1","198.18.0.1","203.0.113.1","::1","::ffff:127.0.0.1","2001::1","2001:2::1","2001:db8::1","2002:7f00:1::","fc00::1","fe80::1","3fff::1"]) expect(isPublicAssetAddress(ip),ip).toBe(false);
    expect(isPublicAssetAddress("93.184.216.34")).toBe(true); expect(isPublicAssetAddress("2606:4700:4700::1111")).toBe(true);
    expect(isPublicAssetAddress("2001:4860:4860::8888")).toBe(true);
  });
  it("captures at most three raster photos and one logo with embedded bytes, hashes and provenance", async () => {
    const request = vi.fn(async (u: URL, _address: {address: string;family:number}) => u.pathname === "/" ? response(html) : response(png(u.pathname.includes("logo") ? 96 : 640),"image/png"));
    const enricher = new OfficialBusinessEnricher({resolve,request});
    const p = await enricher.enrich(input);
    expect(p.state).toBe("ready"); expect(p.logo?.sourceUrl).toBe(url+"logo.png");
    expect(p.logo?.dataUrl).toMatch(/^data:image\/png;base64,/); expect(p.logo?.sha256).toHaveLength(64);
    expect(p.images).toHaveLength(1); expect(p.sourceUrl).toBe(url); expect(p.notices.join()).toContain("permission");
    expect(request.mock.calls.every(call=>call[1].address === "93.184.216.34")).toBe(true);
  });
  it("refuses mixed public/private DNS answers before any request", async () => {
    const request = vi.fn(async ()=>response(html));
    const p=await new OfficialBusinessEnricher({resolve:async()=>[{address:"93.184.216.34",family:4},{address:"10.0.0.8",family:4}],request}).enrich(input);
    expect(p.state).toBe("unavailable"); expect(request).not.toHaveBeenCalled();
  });
  it("validates DNS again on redirects and never fetches a private redirect", async () => {
    const request=vi.fn(async()=>({status:302,headers:{location:"https://private.example.com/"},body:Buffer.alloc(0)}));
    const p=await new OfficialBusinessEnricher({resolve:async host=>[{address:host.startsWith("private")?"169.254.169.254":"93.184.216.34",family:4}],request}).enrich(input);
    expect(p.state).toBe("unavailable"); expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not treat a redirect to a different business as canonical identity", async () => {
    const request=vi.fn(async(u:URL)=>u.hostname==="fixture.example.com"?{status:302,headers:{location:"https://different.example.com/"},body:Buffer.alloc(0)}:response(html));
    const p=await new OfficialBusinessEnricher({resolve,request}).enrich(input);
    expect(p.state).toBe("unavailable"); expect(p.detail).toContain("another domain"); expect(p.logo).toBeUndefined();
  });
  it("honours explicit website reproduction restrictions before downloading images", async () => {
    const restricted=html+'<footer>You may not download, reproduce or republish our images without permission.</footer>';
    expect(publicArtworkProhibited(restricted)).toBe(true); expect(publicArtworkProhibited(html+'<footer>Copyright. All rights reserved.</footer>')).toBe(false);
    const request=vi.fn(async()=>response(restricted));
    const p=await new OfficialBusinessEnricher({resolve,request}).enrich(input);
    expect(p.state).toBe("partial"); expect(p.address).toBeDefined(); expect(p.logo).toBeUndefined(); expect(p.images).toEqual([]); expect(request).toHaveBeenCalledTimes(1);
  });
  it("omits SVG, wrong MIME, overlarge images, tracking images and decompression bombs", async () => {
    const bad=html.replace('/logo.png','/logo.svg')+'<img src="/tracking.png" width="1" height="1">';
    const request=vi.fn(async(u:URL)=>u.pathname==="/"?response(bad):u.pathname.endsWith(".svg")?response('<svg onload="alert(1)"/>','image/svg+xml'):response(png(6000,6000),'image/png'));
    const p=await new OfficialBusinessEnricher({resolve,request}).enrich(input);
    expect(p.logo).toBeUndefined(); expect(p.images).toEqual([]);
    expect(request.mock.calls.some(call=>call[0].pathname==="/tracking.png")).toBe(false);
    expect(rasterDimensions(png(6000,6000))).toBeNull(); expect(rasterDimensions(Buffer.from("<svg/>"))).toBeNull();
  });
  it("caps page bytes even when an injected provider omits Content-Length", async () => {
    const p=await new OfficialBusinessEnricher({resolve,request:async()=>response("x".repeat(3_000_001))}).enrich(input);
    expect(p.state).toBe("unavailable");
  });
  it("makes no provider request for a record with no website", async () => {
    const request=vi.fn(); const p=await new OfficialBusinessEnricher({resolve,request}).enrich({...input,website:null});
    expect(request).not.toHaveBeenCalled(); expect(p.detail).toContain("No official website");
  });
  it("bounds malformed script parsing without quadratic unclosed-tag scanning", () => {
    const broken="<script>".repeat(180_000);
    const start=performance.now();
    expect(extractBusinessPage(broken,url,input.businessName).images).toEqual([]);
    expect(publicArtworkProhibited(broken)).toBe(false);
    expect(performance.now()-start).toBeLessThan(1000);
  });
});

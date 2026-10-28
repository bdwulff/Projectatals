import {afterEach,describe,expect,it} from "vitest";
import {SqliteStore} from "../src/store.js";
import {AuditLog} from "../src/audit.js";
import {ProspectService} from "../src/wulff/prospects.js";

const stores:SqliteStore[]=[];
afterEach(()=>{for(const store of stores.splice(0))store.close();});
function setup(){const store=new SqliteStore(":memory:");stores.push(store);return new ProspectService(store,new AuditLog(store));}
const input=(businessName:string,website:string|null,location="Berwick, Victoria")=>({businessName,website,location,industry:"Fictional trades",commercialOpportunity:"Fictional test research",recommendedScope:"Review only",internalRecommendedPriceAud:null,fixture:true});

describe("prospect identity on shared public hosts",()=>{
 it.each([
  ["https://www.facebook.com/alpha","https://www.facebook.com/beta"],
  ["https://www.facebook.com/profile.php?id=123","https://www.facebook.com/profile.php?id=456"],
  ["https://www.findglocal.com/AU/Berwick/123/Alpha","https://www.findglocal.com/AU/Berwick/456/Beta"],
  ["https://www.yellowpages.com.au/berwick","https://www.yellowpages.com.au/berwick"],
  ["https://www.fresha.com/a/alpha","https://www.fresha.com/a/beta"],
 ])("does not merge different businesses on %s",(first,second)=>{
  const service=setup(),a=service.upsert(input("Alpha (fictional)",first)),b=service.upsert(input("Beta (fictional)",second));
  expect(a.created).toBe(true);expect(b.created).toBe(true);expect(a.prospect.id).not.toBe(b.prospect.id);expect(service.list()).toHaveLength(2);
 });
 it("merges a known business across shared profile URL and tracking variations",()=>{
  const service=setup(),a=service.upsert(input("  ALPHA  Works (fictional) ","https://www.facebook.com/alpha?tracking=one"));
  const b=service.upsert(input("Alpha Works (fictional)","https://m.facebook.com/alpha/about","Berwick, VIC"));
  expect(b.created).toBe(false);expect(b.prospect.id).toBe(a.prospect.id);
 });
 it("preserves company-domain uniqueness across page paths and source names",()=>{
  const service=setup(),a=service.upsert(input("Alpha business (fictional)","https://www.alpha.example.test/"));
  const b=service.upsert(input("Alpha business homepage (fictional)","https://alpha.example.test/contact"));
  expect(b.created).toBe(false);expect(b.prospect.id).toBe(a.prospect.id);
 });
 it("uses both business name and locality when no company domain is available",()=>{
  const service=setup(),a=service.upsert(input("Local Works (fictional)",null));
  const duplicate=service.upsert(input("local works (fictional)",null,"Berwick, VIC"));
  const differentTown=service.upsert(input("Local Works (fictional)",null,"Dandenong, Victoria"));
  expect(duplicate.created).toBe(false);expect(duplicate.prospect.id).toBe(a.prospect.id);expect(differentTown.created).toBe(true);
 });
});

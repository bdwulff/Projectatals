import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { LocalAgent, browserCommand, createHandler, validateBrowserUrl, publicAddress, UI_HTML } from '../src/agent.mjs';
import { LocalActionJournal } from '../src/journal.mjs';

const token='local-device-secret-for-tests-at-least-32-characters';
const origin='http://127.0.0.1:13473';
const publicDns=async()=>[{address:'8.8.8.8',family:4}];
async function request(handler,{method='GET',path='/local/status',headers={},body}={}) {
 const req=Readable.from(body===undefined?[]:[Buffer.from(typeof body==='string'?body:JSON.stringify(body))]);
 Object.assign(req,{method,url:path,headers:{host:'127.0.0.1:13473',...headers}});
 return new Promise((resolve,reject)=>{
  const res={writeHead(status,head){this.status=status;this.headers=head},end(text){resolve({status:this.status,headers:this.headers,text,json:()=>JSON.parse(text)})}};
  Promise.resolve(handler(req,res)).catch(reject);
 });
}
const auth={authorization:`Bearer ${token}`};
const post={...auth,origin,'content-type':'application/json'};

test('only bootstrap, static login and liveness are unauthenticated',async()=>{
 const handler=createHandler({token,origin,agent:new LocalAgent(),ui:UI_HTML});
 assert.equal((await request(handler)).status,401);
 assert.equal((await request(handler,{path:'/healthz'})).status,200);
 assert.equal((await request(handler,{path:'/'})).status,200);
 assert.equal((await request(handler,{method:'POST',path:'/local/browser/open',headers:{origin,'content-type':'application/json'},body:{}})).status,401);
 assert.equal((await request(handler,{headers:auth})).status,200);
});

test('denies rebinding Hosts, foreign Origins, non-JSON and originless mutations',async()=>{
 const handler=createHandler({token,origin,agent:new LocalAgent()});
 assert.equal((await request(handler,{headers:{...auth,host:'evil.example'}})).status,403);
 assert.equal((await request(handler,{headers:{...auth,origin:'https://evil.example'}})).status,403);
 assert.equal((await request(handler,{method:'POST',path:'/local/files/list',headers:auth,body:{}})).status,403);
 assert.equal((await request(handler,{method:'POST',path:'/local/files/list',headers:{...auth,origin,'content-type':'text/plain'},body:'{}'})).status,415);
});

test('owner login produces an opaque HttpOnly strict session and logout revokes it',async()=>{
 const handler=createHandler({token,origin,agent:new LocalAgent()});
 const login=await request(handler,{method:'POST',path:'/local/session',headers:{origin,'content-type':'application/json'},body:{token}});
 assert.equal(login.status,200);
 const cookie=login.headers['Set-Cookie'];
 assert.match(cookie,/HttpOnly; SameSite=Strict/);assert.ok(!cookie.includes(token));
 const value=cookie.split(';')[0];
 assert.equal((await request(handler,{headers:{cookie:value}})).status,200);
 assert.equal((await request(handler,{method:'POST',path:'/local/logout',headers:{origin,cookie:value,'content-type':'application/json'},body:{}})).status,200);
 assert.equal((await request(handler,{headers:{cookie:value}})).status,401);
});

test('login limiter and bounded request body fail closed',async()=>{
 const handler=createHandler({token,origin,agent:new LocalAgent()});
 for(let i=0;i<8;i++)assert.equal((await request(handler,{method:'POST',path:'/local/session',headers:{origin,'content-type':'application/json'},body:{token:'bad'}})).status,401);
 assert.equal((await request(handler,{method:'POST',path:'/local/session',headers:{origin,'content-type':'application/json'},body:{token}})).status,429);
 const fresh=createHandler({token,origin,agent:new LocalAgent()});
 assert.equal((await request(fresh,{method:'POST',path:'/local/files/list',headers:post,body:{path:'x'.repeat(9000)}})).status,413);
});

test('browser launcher uses fixed program arguments with no shell interpolation',async()=>{
 const seen=[];
 const agent=new LocalAgent({platform:'darwin',resolveHost:publicDns,run:async(...args)=>{seen.push(args);return {acceptedByOS:true,completionConfirmed:false}}});
 const result=await agent.openBrowser({url:'https://example.com/search?q=$(touch%20pwned)&x=1',requestId:'browser-request-001'});
 assert.deepEqual(seen[0].slice(0,2),['/usr/bin/open',['https://example.com/search?q=$(touch%20pwned)&x=1']]);
 assert.equal(result.completionConfirmed,false);
 const windows=browserCommand('https://example.com/?q=";$x', 'win32');
 assert.ok(windows[0].endsWith('powershell.exe'));assert.equal(windows[1].at(-1),'Start-Process -FilePath $env:ATLAS_OPEN_URL');
 assert.equal(windows[2].ATLAS_OPEN_URL,'https://example.com/?q=";$x');
});

test('public website capability blocks private, special, credentials and unexpected protocols',async()=>{
 for(const url of ['file:///etc/passwd','javascript:alert(1)','https://user:secret@example.com','http://127.0.0.1','http://2130706433','http://10.1.1.1','http://[::1]','https://example.com:5555'])await assert.rejects(validateBrowserUrl(url,publicDns));
 await assert.rejects(validateBrowserUrl('https://example.com',async()=>[{address:'127.0.0.1'},{address:'8.8.8.8'}]));
 assert.equal(publicAddress('::ffff:127.0.0.1'),false);
 assert.equal(publicAddress('169.254.169.254'),false);
 assert.equal(publicAddress('8.8.8.8'),true);
});

test('app launches are restricted to configured fixed application IDs',async()=>{
 const seen=[];const agent=new LocalAgent({platform:'darwin',allowedApps:['calculator'],run:async(...args)=>{seen.push(args);return {acceptedByOS:true,completionConfirmed:false}}});
 await agent.openApp({appId:'calculator',requestId:'app-request-0001'});
 assert.deepEqual(seen[0],['/usr/bin/open',['-a','Calculator']]);
 for(const appId of ['terminal','calculator;rm -rf /','__proto__','notes'])await assert.rejects(agent.openApp({appId,requestId:'app-request-0002'}));
});

test('same action id is reserved before launch and payload changes are rejected',async()=>{
 let calls=0;let release;const hold=new Promise(r=>release=r);
 const agent=new LocalAgent({platform:'darwin',resolveHost:publicDns,run:async()=>{calls++;await hold;return {acceptedByOS:true,completionConfirmed:false}}});
 const first=agent.openBrowser({url:'https://example.com',requestId:'browser-request-002'});
 const second=agent.openBrowser({url:'https://example.com',requestId:'browser-request-002'});
 await new Promise(r=>setImmediate(r));release();await Promise.all([first,second]);assert.equal(calls,1);
 await assert.rejects(agent.openBrowser({url:'https://other.example.com',requestId:'browser-request-002'}),/different action/);
});

test('durable reservations prevent duplicate or ambiguous launches after process restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'atlas-local-journal-'));
 try{
 const path=join(directory,'actions.sqlite');let calls=0;
 let journal=new LocalActionJournal(path);
 const options={platform:'darwin',resolveHost:publicDns,run:async()=>{calls++;return {acceptedByOS:true,completionConfirmed:false}},journal};
 await new LocalAgent(options).openBrowser({url:'https://example.com',requestId:'browser-request-003'});journal.close();
 journal=new LocalActionJournal(path);
 await new LocalAgent({...options,journal}).openBrowser({url:'https://example.com',requestId:'browser-request-003'});assert.equal(calls,1);
 journal.reserve('device.open_browser:browser-request-004','unknown-hash');
 await assert.rejects(new LocalAgent({...options,journal}).openBrowser({url:'https://example.com',requestId:'browser-request-004'}));journal.close();
 }finally{await rm(directory,{recursive:true,force:true})}
});

test('file reads stay inside explicitly selected folder and deny links, credentials and binary files',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'atlas-local-files-'));
 try{
 const root=join(directory,'selected');await mkdir(root);await writeFile(join(root,'brief.txt'),'Owner-selected text');await writeFile(join(directory,'outside.txt'),'outside');
 await writeFile(join(root,'.env'),'SECRET=do-not-read');await writeFile(join(root,'binary.bin'),Buffer.from([0,1]));await symlink(join(directory,'outside.txt'),join(root,'escape.txt'));await symlink(join(root,'.env'),join(root,'notes.txt'));
 const agent=new LocalAgent({root});assert.equal((await agent.readText({path:'brief.txt'})).text,'Owner-selected text');
 for(const path of ['../outside.txt','/etc/passwd','escape.txt','notes.txt','.env','binary.bin','x\\..\\outside'])await assert.rejects(agent.readText({path}));
 assert.equal((await agent.listFiles()).entries.some(e=>e.name==='brief.txt'),true);
 await assert.rejects(new LocalAgent().readText({path:'brief.txt'}),/Choose a read-only folder/);
 }finally{await rm(directory,{recursive:true,force:true})}
});

test('cloud pairing and disconnection require local owner authentication and preserve configured scope',async()=>{
 const seen=[];const handler=createHandler({token,origin,agent:new LocalAgent(),cloud:{status:()=>({state:'not_paired'}),pair:async body=>{seen.push(body);return {paired:true}},disconnect:async()=>({paired:false})}});
 assert.equal((await request(handler,{method:'POST',path:'/local/cloud/pair',headers:{origin,'content-type':'application/json'},body:{}})).status,401);
 assert.equal((await request(handler,{method:'POST',path:'/local/cloud/pair',headers:post,body:{origin:'https://private.example.com',pairCode:'one-time-test',allowedActions:['device.status']}})).status,200);
 assert.equal(seen[0].allowedActions[0],'device.status');
 assert.equal((await request(handler,{method:'POST',path:'/local/cloud/disconnect',headers:post,body:{}})).status,200);
});

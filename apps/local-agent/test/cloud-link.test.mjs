import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pairCloudDevice, createCloudLink, validateCloudOrigin } from '../src/cloud-link.mjs';
import { LocalActionJournal } from '../src/journal.mjs';

const config={origin:'https://jarvis.example.org',deviceId:'device_12345678',deviceToken:'never-print-this-token-012345678901234567890',allowedActions:['browser.open','device.status','apps.open']};
const now=()=>new Date('2026-10-26T04:00:00.000Z');
const task=(id='task_12345678',action='browser.open',payload={url:'https://openai.com/'})=>({id,action,payload,expiresAt:'2026-10-26T04:01:00.000Z'});
const response=data=>Response.json(data);
function journal(){return new LocalActionJournal(':memory:')}

test('cloud origin must be exact public HTTPS without URL credentials or custom routes',()=>{
 assert.equal(validateCloudOrigin('https://Jarvis.Example.org/'),'https://jarvis.example.org');
 for(const bad of ['http://jarvis.example.org','https://jarvis.example.org/path','https://u:p@jarvis.example.org','https://jarvis.example.org/?token=abc','https://127.0.0.1','https://10.0.0.1','https://localhost','https://jarvis.local','https://jarvis.example.org:444'])assert.throws(()=>validateCloudOrigin(bad));
});

test('pairing posts one-use code only to fixed route and intersects local approval',async()=>{
 let requested;
 const result=await pairCloudDevice({origin:config.origin,pairCode:'paircode_012345678901234567890',deviceName:'Brandon Mac',allowedActions:['device.status'],fetch:async(url,options)=>{requested={url,options};return response({...config,allowedActions:['device.status','browser.open','shell.run']})}});
 assert.equal(requested.url,config.origin+'/device-api/v1/claim');
 assert.equal(requested.options.redirect,'error');
 assert.equal(requested.options.headers.Authorization,undefined);
 assert.deepEqual(JSON.parse(requested.options.body),{pairCode:'paircode_012345678901234567890',deviceName:'Brandon Mac'});
 assert.deepEqual(result.allowedActions,['device.status']);
});

test('provider errors never expose keys or response bodies',async()=>{
 await assert.rejects(()=>pairCloudDevice({origin:config.origin,pairCode:'paircode_012345678901234567890',deviceName:'Mac',fetch:async()=>{throw new Error(config.deviceToken)}}),e=>!e.message.includes(config.deviceToken));
 await assert.rejects(()=>pairCloudDevice({origin:config.origin,pairCode:'paircode_012345678901234567890',deviceName:'Mac',fetch:async()=>new Response(config.deviceToken,{status:401})}),e=>e.message.includes('401')&&!e.message.includes(config.deviceToken));
});

test('a browser task is durably reserved before execution and acknowledgement is sanitised',async()=>{
 const j=journal();const posts=[];let ran=0;
 const link=createCloudLink({config,journal:j,clock:now,allowedActions:['browser.open'],runTask:async t=>{ran++;assert.equal(j.reserve('cloud-task:'+config.deviceId+':'+t.id,'anything').fresh,false);return {acceptedByOS:true,completionConfirmed:true,secret:'private',url:t.payload.url}},fetch:async(url,options)=>{assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+config.deviceToken);if(!options.body)return response({tasks:[task()]});posts.push(JSON.parse(options.body));return response({ok:true})}});
 assert.equal((await link.tick()).state,'completed');assert.equal(ran,1);
 assert.deepEqual(posts[0],{status:'completed',result:{acceptedByOS:true,completionConfirmed:false,outcome:'attempted'}});
 assert.equal((await link.tick()).state,'completed');assert.equal(ran,1);assert.equal(posts.length,2);
 j.close();
});

test('unapproved, expired and injection-shaped tasks never reach dispatcher',async()=>{
 const j=journal();let ran=0;const posted=[];
 const tasks=[task('task_unapproved','apps.open',{appId:'notes'}),{...task('task_expired'),expiresAt:'2026-10-26T03:59:59Z'},task('task_badshape','browser.open',{url:'https://openai.com',shell:'rm -rf'}),task('task_shell','shell.run',{command:'whoami'})];
 const link=createCloudLink({config,journal:j,clock:now,allowedActions:['browser.open'],runTask:async()=>{ran++;return {acceptedByOS:true}},fetch:async(url,options)=>{if(!options.body)return response({tasks});posted.push(JSON.parse(options.body));return response({ok:true})}});
 assert.equal((await link.tick()).state,'partial');assert.equal(ran,0);assert.equal(posted.length,4);assert.ok(posted.every(p=>p.status==='failed'));
 j.close();
});

test('in-flight polling is single-flight',async()=>{
 const j=journal();let release;const hold=new Promise(r=>release=r);let reads=0;
 const link=createCloudLink({config,journal:j,clock:now,runTask:async()=>({}),fetch:async()=>{reads++;await hold;return response({tasks:[]})}});
 const first=link.tick();assert.equal((await link.tick()).state,'busy');release();await first;assert.equal(reads,1);j.close();
});

test('a lost acknowledgement or restart does not repeat an OS launch',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'atlas-link-'));const path=join(temp,'journal.sqlite');let ran=0;
 try {
  const j=new LocalActionJournal(path);const link=createCloudLink({config,journal:j,clock:now,allowedActions:['browser.open'],runTask:async()=>{ran++;return {acceptedByOS:true}},fetch:async(url,options)=>{if(!options.body)return response({tasks:[task()]});throw Error('Network response lost')}});
  assert.equal((await link.tick()).state,'error');j.close();
  const restarted=new LocalActionJournal(path);const again=createCloudLink({config,journal:restarted,clock:now,allowedActions:['browser.open'],runTask:async()=>{ran++;return {acceptedByOS:true}},fetch:async(url,options)=>options.body?response({ok:true}):response({tasks:[task()]})});
  assert.equal((await again.tick()).state,'completed');assert.equal(ran,1);restarted.close();
 } finally {await rm(temp,{recursive:true,force:true})}
});

test('oversized task envelopes and responses are refused without execution',async()=>{
 const j=journal();let ran=0;
 for(const body of [{tasks:Array.from({length:21},(_,i)=>task('task_abcdefgh'+i))},{tasks:[],padding:'x'.repeat(66000)}]) {
  const link=createCloudLink({config,journal:j,clock:now,runTask:async()=>{ran++},fetch:async()=>response(body)});
  assert.equal((await link.tick()).state,'error');
 }
 assert.equal(ran,0);j.close();
});

test('poll cadence is bounded and stop prevents work',async()=>{
 const j=journal();const link=createCloudLink({config,journal:j,clock:now,intervalMs:1,runTask:async()=>({}),fetch:async()=>{throw Error('must not run')}});
 assert.equal(link.status().intervalMs,5000);link.stop();assert.equal((await link.tick()).state,'stopped');assert.equal(link.status().deviceToken,undefined);j.close();
});

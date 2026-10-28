import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, chmod, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDeviceConfig, loadConfig } from '../src/server.mjs';

test('setup generates a unique private key outside source and preserves existing pairing/config',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'atlas-device-config-'));const path=join(dir,'device.json');
 try{
 assert.equal((await createDeviceConfig(path)).created,true);
 const first=JSON.parse(await readFile(path,'utf8'));assert.ok(first.token.length>=32);assert.equal(first.readOnlyRoot,null);assert.deepEqual(first.allowedApps,[]);
 assert.equal((await createDeviceConfig(path)).created,false);
 assert.equal(JSON.parse(await readFile(path,'utf8')).token,first.token);
 assert.equal((await stat(path)).mode&0o077,0);
 assert.equal((await loadConfig(path)).port,13473);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('startup rejects weak credentials, exposed config, invalid ports and arbitrary application IDs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'atlas-device-config-'));const path=join(dir,'device.json');
 try{
 await createDeviceConfig(path);const good=JSON.parse(await readFile(path,'utf8'));
 for(const change of [{token:'bad'},{port:80},{allowedApps:['terminal']},{readOnlyRoot:'/'}]){
  await writeFile(path,JSON.stringify({...good,...change}),{mode:0o600});await assert.rejects(loadConfig(path));
 }
 await writeFile(path,JSON.stringify(good));await chmod(path,0o644);await assert.rejects(loadConfig(path),/private/);
 }finally{await rm(dir,{recursive:true,force:true})}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {createMacArchive} from '../package-mac.mjs';

function readEntries(zip){
 const entries=[];let offset=0;
 while(zip.readUInt32LE(offset)===0x04034b50){const length=zip.readUInt32LE(offset+18),nameLength=zip.readUInt16LE(offset+26),extraLength=zip.readUInt16LE(offset+28);const name=zip.subarray(offset+30,offset+30+nameLength).toString();const start=offset+30+nameLength+extraLength;entries.push({name,text:inflateRawSync(zip.subarray(start,start+length)).toString()});offset=start+length;}
 const modes={};while(zip.readUInt32LE(offset)===0x02014b50){const nameLength=zip.readUInt16LE(offset+28),extra=zip.readUInt16LE(offset+30),comment=zip.readUInt16LE(offset+32);const name=zip.subarray(offset+46,offset+46+nameLength).toString();modes[name]=zip.readUInt32LE(offset+38)>>>16;offset+=46+nameLength+extra+comment;}
 return {entries,modes};
}

test('Mac download is reproducible, contains every runtime file and preserves executable launchers',async()=>{
 const first=await createMacArchive(),second=await createMacArchive();assert.deepEqual(first,second);const {entries,modes}=readEntries(first);
 for(const name of ['src/server.mjs','src/agent.mjs','src/cloud-link.mjs','src/journal.mjs'])assert.ok(entries.some(e=>e.name===`Jarvis Mac/apps/local-agent/${name}`));
 for(const name of ['Jarvis Mac/Start Jarvis.command','Jarvis Mac/apps/local-agent/Start Jarvis.command','Jarvis Mac/Jarvis.app/Contents/MacOS/jarvis'])assert.equal(modes[name]&0o777,0o755);
 assert.ok(entries.find(e=>e.name.endsWith('Contents/MacOS/jarvis')).text.includes('$PACKAGE_ROOT/Start Jarvis.command'));
 assert.ok(!entries.some(e=>/device\.json|\.sqlite|\.env|node_modules|audit\.jsonl/.test(e.name)));
});

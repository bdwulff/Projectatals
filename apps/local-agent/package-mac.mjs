import { deflateRawSync } from 'node:zlib';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
const files=['package.json','Start Jarvis.command','src/agent.mjs','src/server.mjs','src/journal.mjs','src/cloud-link.mjs','src/bootstrap-node.sh'];
const intro=`Jarvis for your Mac\n\nExtract this ZIP. Keep its contents together.\nOpen Jarvis.app, or Start Jarvis.command.\nIf Node.js 22.13+ is absent, the launcher asks before downloading a checksum-verified official runtime into your own Application Support folder.\nThe launcher opens your device key locally in TextEdit and the private local app.\nCopy the token only into http://127.0.0.1:13473. Never paste it into chat.\nThen use the local pairing form with your private dashboard HTTPS address and one-time pairing code.\n\nRead LOCAL-DEVICE-AGENT.md for exact available capabilities and limitations.\nThis is an unsigned Mac launcher, not a signed native release.\n`;
const launcher=`#!/bin/zsh\nset -euo pipefail\ncd -- "\${0:A:h}"\nexec /bin/zsh "apps/local-agent/Start Jarvis.command"\n`;
const appLauncher=`#!/bin/zsh\nset -euo pipefail\nPACKAGE_ROOT="\${0:A:h}/../../.."\nexec /usr/bin/open -a Terminal "$PACKAGE_ROOT/Start Jarvis.command"\n`;

function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function zip(entries){
 const local=[],central=[];let offset=0;
 for(const entry of entries){
  const name=Buffer.from(`Jarvis Mac/${entry.name}`,'utf8');const data=Buffer.isBuffer(entry.data)?entry.data:Buffer.from(entry.data,'utf8');const compressed=deflateRawSync(data,{level:9});const crc=crc32(data);
  const head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(0x0800,6);head.writeUInt16LE(8,8);head.writeUInt16LE(0,10);head.writeUInt16LE(33,12);head.writeUInt32LE(crc,14);head.writeUInt32LE(compressed.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(name.length,26);
  local.push(head,name,compressed);
  const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE((3<<8)|20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x0800,8);record.writeUInt16LE(8,10);record.writeUInt16LE(33,14);record.writeUInt32LE(crc,16);record.writeUInt32LE(compressed.length,20);record.writeUInt32LE(data.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(((0o100000|entry.mode)<<16)>>>0,38);record.writeUInt32LE(offset,42);central.push(record,name);
  offset+=head.length+name.length+compressed.length;
 }
 const directory=Buffer.concat(central);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,directory,end]);
}

/** Exact allowlist only: generated device configs, credentials and runtime state never enter the archive. */
export async function createMacArchive(root=projectRoot){
 const entries=[];
 for(const name of files)entries.push({name:`apps/local-agent/${name}`,data:await readFile(resolve(root,'apps/local-agent',name)),mode:name.endsWith('.command')?0o755:0o644});
 entries.push({name:'LOCAL-DEVICE-AGENT.md',data:await readFile(resolve(root,'docs/LOCAL-DEVICE-AGENT.md')),mode:0o644});
 entries.push({name:'START HERE.txt',data:intro,mode:0o644});
 entries.push({name:'Start Jarvis.command',data:launcher,mode:0o755});
 entries.push({name:'Jarvis.app/Contents/Info.plist',data:await readFile(resolve(root,'apps/local-agent/Jarvis.app/Contents/Info.plist')),mode:0o644});
 entries.push({name:'Jarvis.app/Contents/MacOS/jarvis',data:appLauncher,mode:0o755});
 return zip(entries);
}

async function main(){const output=resolve(process.argv[2]??resolve(projectRoot,'apps/command-centre/dist/downloads/Jarvis-Mac.zip'));const archive=await createMacArchive();await mkdir(dirname(output),{recursive:true});await writeFile(output,archive);console.log(`Mac companion package: ${output} (${archive.length} bytes)`);}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1});

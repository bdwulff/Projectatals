import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { mkdir, readFile, writeFile, chmod, stat, realpath, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createCloudLink, pairCloudDevice } from './cloud-link.mjs';
import { LocalAgent, createHandler, UI_HTML, APP_IDS, launch } from './agent.mjs';
import { LocalActionJournal } from './journal.mjs';

export const defaultConfigPath = () => join(homedir(),'.atlas-local','device.json');

export async function createDeviceConfig(path=defaultConfigPath()) {
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const config = { version:1, token:randomBytes(32).toString('base64url'), port:13473, readOnlyRoot:null, allowedApps:[] };
  try { await writeFile(path,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600}); }
  catch(e) { if(e.code==='EEXIST') return {path,created:false};throw e; }
  return {path,created:true};
}

export async function loadConfig(path=defaultConfigPath()) {
  const config = JSON.parse(await readFile(path,'utf8'));
  if(config.version!==1 || typeof config.token!=='string' || config.token.length<32 || !Number.isInteger(config.port) || config.port<1024 || config.port>65535 || !Array.isArray(config.allowedApps)) throw Error('Local config is invalid. Re-run setup or repair the selected fields.');
  if(platform()!=='win32') {
    const info=await stat(path);
    if(info.mode & 0o077) throw Error('Device config must be private. Run chmod 600 on the config file.');
  }
  const apps = config.allowedApps;
  if(apps.some(id=>typeof id!=='string' || !Object.hasOwn(APP_IDS[platform()]??{},id))) throw Error('Only supported application IDs may be enabled.');
  if(config.readOnlyRoot) {
    if(typeof config.readOnlyRoot!=='string') throw Error('Read-only folder configuration is invalid.');
    const folder=await realpath(config.readOnlyRoot);
    if(!(await stat(folder)).isDirectory() || folder===resolve(folder,'..')) throw Error('Choose a specific folder, not a volume root.');
    config.readOnlyRoot=folder;
  }
  return config;
}

export async function startLocalAgent(configPath=defaultConfigPath(),{listen=true}={}) {
  const config=await loadConfig(configPath);
  const origin=`http://127.0.0.1:${config.port}`;
  const dataDir=dirname(configPath);
  const journal=new LocalActionJournal(join(dataDir,'actions.sqlite'));
  const agent=new LocalAgent({root:config.readOnlyRoot,allowedApps:config.allowedApps,journal,audit:record=>{void appendFile(join(dataDir,'audit.jsonl'),JSON.stringify(record)+'\n',{mode:0o600}).catch(()=>{});}});
  let link = null;
  const localActions = ['device.status','browser.open',...(config.allowedApps.length?['apps.open']:[])];
  const runTask = task => task.action==='browser.open' ? agent.openBrowser({...task.payload,requestId:task.id}) : task.action==='apps.open' ? agent.openApp({...task.payload,requestId:task.id}) : agent.status();
  const save = async () => {
    const temporary=configPath+'.tmp';
    await writeFile(temporary,JSON.stringify(config,null,2)+'\n',{mode:0o600});
    await chmod(temporary,0o600);
    const {rename}=await import('node:fs/promises');
    await rename(temporary,configPath);
  };
  const launchLink = () => {
    if(config.cloud){link=createCloudLink({config:config.cloud,allowedActions:localActions,runTask,journal});link.start();}
  };
  const cloud = {
    status:()=>link?.status()??{state:'not_paired',detail:'Private remote access is not paired on this Mac.'},
    async pair(body){
      if(!Array.isArray(body.allowedActions)||body.allowedActions.some(a=>!localActions.includes(a))) throw Object.assign(Error('Choose only capabilities currently enabled on this laptop.'),{status:400});
      let candidate;
      try { candidate=await pairCloudDevice({origin:body.origin,pairCode:body.pairCode,deviceName:'My Mac',allowedActions:body.allowedActions}); }
      catch(e){throw Object.assign(Error(e.name==='CloudLinkUnavailableError'?e.message:'Private pairing failed. Check the server and one-time code.'),{status:400});}
      const previous=config.cloud;config.cloud=candidate;
      try{await save();}catch(e){config.cloud=previous;throw e;}
      link?.stop();launchLink();return {paired:true,allowedActions:config.cloud.allowedActions};
    },
    async disconnect(){link?.stop();link=null;delete config.cloud;await save();return {paired:false};},
  };
  const server=createServer(createHandler({token:config.token,origin,agent,cloud,ui:UI_HTML}));
  server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=50;
  if(listen) {
    try{await new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(config.port,'127.0.0.1',resolveListen)});}catch(e){journal.close();throw e;}
    launchLink();
  }
  server.on('close',()=>{link?.stop();journal.close()});
  return {server,origin,agent};
}

async function main() {
  const mode=process.argv[2]??'start';
  const configPath=process.env.ATLAS_LOCAL_CONFIG_PATH??defaultConfigPath();
  if(mode==='setup') {
    const result=await createDeviceConfig(configPath);
    console.log(result.created?'Created a private device key and local configuration.':'Existing device configuration preserved.');
    console.log(`Device configuration: ${result.path}`);
    console.log('Open this file locally to copy your device key. Do not send it in chat or commit it.');
    console.log('Run node apps/local-agent/src/server.mjs start, then open http://127.0.0.1:13473');
    return;
  }
  if(mode==='configure') {
    await loadConfig(configPath);
    console.log(`Edit the local file: ${configPath}`);
    console.log(`Available app IDs on this OS: ${Object.keys(APP_IDS[platform()]??{}).join(', ')||'none'}`);
    console.log('Set readOnlyRoot to one folder you explicitly want Jarvis to read. Access is disabled by default.');
    return;
  }
  if(mode!=='start') throw Error('Use setup, start or configure.');
  const {server,origin}=await startLocalAgent(configPath);
  console.log(`Jarvis local app: ${origin}`);
  console.log('Local interface bound only to this laptop. Private remote actions require explicit pairing in the local app.');
  if(process.argv.includes('--open')&&platform()==='darwin') await launch('/usr/bin/open',[origin]);
  process.on('SIGINT',()=>server.close());process.on('SIGTERM',()=>server.close());
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) main().catch(e=>{console.error(e.message);process.exitCode=1});

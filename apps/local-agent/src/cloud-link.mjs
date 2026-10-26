import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { publicAddress } from './agent.mjs';

const ACTIONS = new Set(['browser.open','apps.open','device.status']);
const MAX_JSON_BYTES = 65_536;
const ID = /^[A-Za-z0-9_-]{8,120}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,1024}$/;
const own = (v,k) => Object.hasOwn(v,k);
const record = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const allowed = actions => [...new Set(Array.isArray(actions) ? actions.filter(a=>ACTIONS.has(a)) : [])];
const unavailable = message => Object.assign(new Error(message),{name:'CloudLinkUnavailableError'});

/** One exact, owner-selected origin; device credentials never follow redirects. */
export function validateCloudOrigin(input) {
  let url;
  try { url = new URL(input); } catch { throw unavailable('Enter your private Jarvis HTTPS origin.'); }
  const host = url.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'');
  if(url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.port && url.port !== '443')) throw unavailable('Cloud link requires a plain HTTPS origin without a path, credentials or custom port.');
  if((isIP(host) && !publicAddress(host)) || (!isIP(host) && (!host.includes('.') || /(?:^|\.)(localhost|local|internal|home|lan|test|invalid|example)$/i.test(host)))) throw unavailable('Private and internal cloud-link destinations are not supported.');
  return url.origin;
}

async function jsonResponse(response) {
  if(!response.ok) throw unavailable(`Jarvis connection returned HTTP ${response.status}; no provider details were exposed.`);
  const reader = response.body?.getReader();
  if(!reader) throw unavailable('Jarvis returned an empty response.');
  let size = 0;
  let text = '';
  const decoder = new TextDecoder();
  try {
    for(;;) {
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_JSON_BYTES)throw unavailable('Jarvis response exceeds the local safety limit.');
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
  } finally { await reader.cancel().catch(()=>{}); }
  try { return JSON.parse(text); } catch { throw unavailable('Jarvis returned an invalid JSON response.'); }
}

async function sendJson(fetcher,url,{token,body,signal}={}) {
  const response=await fetcher(url,{method:body ? 'POST' : 'GET',redirect:'error',signal:signal ?? AbortSignal.timeout(10_000),headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'} : {})},...(body?{body:JSON.stringify(body)} : {})});
  return jsonResponse(response);
}

export async function pairCloudDevice({origin,pairCode,deviceName,allowedActions=['browser.open','device.status'],fetch:fetcher=fetch}) {
  const canonical=validateCloudOrigin(origin);
  if(typeof pairCode !== 'string' || pairCode.length<16 || pairCode.length>256 || /\s/.test(pairCode))throw unavailable('Enter the one-use pairing code from your signed-in Jarvis dashboard.');
  if(typeof deviceName !== 'string' || !deviceName.trim() || deviceName.length>80 || /[\u0000-\u001f\u007f]/.test(deviceName))throw unavailable('Device name must contain 1–80 ordinary characters.');
  let body;
  try { body=await sendJson(fetcher,`${canonical}/device-api/v1/claim`,{body:{pairCode,deviceName:deviceName.trim()}}); }
  catch(e) { if(e.name==='CloudLinkUnavailableError')throw e;throw unavailable('Pairing failed. Device credentials were not exposed; check your dashboard and code.'); }
  if(!record(body) || !ID.test(body.deviceId??'') || typeof body.deviceToken!=='string' || !TOKEN.test(body.deviceToken) || !Array.isArray(body.allowedActions))throw unavailable('Jarvis pairing response was incomplete. No device link was saved.');
  const local = new Set(allowed(allowedActions));
  return {origin:canonical,deviceId:body.deviceId,deviceToken:body.deviceToken,allowedActions:allowed(body.allowedActions).filter(a=>local.has(a))};
}

function taskData(input,clock) {
  if(!record(input) || !ID.test(input.id??'') || !ACTIONS.has(input.action) || !record(input.payload))throw unavailable('Task shape or capability is invalid.');
  const expires=Date.parse(input.expiresAt);
  if(typeof input.expiresAt!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(input.expiresAt) || !Number.isFinite(expires) || expires<=clock().getTime())throw unavailable('Task is expired or has no valid expiry.');
  const payload=input.payload;
  if(input.action==='browser.open' && (Object.keys(payload).some(k=>k!=='url') || typeof payload.url!=='string' || payload.url.length>2048))throw unavailable('Browser task payload is invalid.');
  if(input.action==='apps.open' && (Object.keys(payload).some(k=>k!=='appId') || typeof payload.appId!=='string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(payload.appId)))throw unavailable('Application task payload is invalid.');
  if(input.action==='device.status' && Object.keys(payload).length)throw unavailable('Device status takes no additional arguments.');
  return {id:input.id,action:input.action,payload,expiresAt:input.expiresAt};
}

function safeResult(action,result) {
  if(action==='browser.open' || action==='apps.open') {
    if(!record(result) || result.acceptedByOS!==true)throw unavailable('Operating-system launch was not confirmed.');
    return {acceptedByOS:true,completionConfirmed:false,outcome:'attempted'};
  }
  const capabilities=record(result?.capabilities)?result.capabilities:{};
  return {outcome:'completed',operatingSystem:typeof result?.operatingSystem==='string'?result.operatingSystem.slice(0,24):'unknown',capabilities:{openPublicWebsite:capabilities.openPublicWebsite===true,launchApplications:Array.isArray(capabilities.launchApplications)?capabilities.launchApplications.filter(x=>typeof x==='string'&&/^[a-z][a-z0-9_-]{0,39}$/.test(x)).slice(0,10):[],readSelectedFolder:capabilities.readSelectedFolder===true,writeFiles:false,deleteFiles:false,arbitraryShell:false,inspectOrClickBrowser:false,controlOtherPhoneApps:false}};
}

/** Outbound polling only. No listening port, shell tool, file upload or remote file-read action. */
export function createCloudLink({config,allowedActions=['browser.open','device.status'],runTask,journal,fetch:fetcher=fetch,clock=()=>new Date(),intervalMs=5000}) {
  const origin=validateCloudOrigin(config?.origin);
  if(!ID.test(config?.deviceId??'') || typeof config?.deviceToken!=='string' || !TOKEN.test(config.deviceToken) || typeof runTask!=='function' || typeof journal?.reserve!=='function' || typeof journal?.finish!=='function')throw unavailable('Cloud link requires valid local device credentials and a durable action journal.');
  const granted=new Set(allowed(config.allowedActions));
  const permitted=new Set(allowed(allowedActions).filter(a=>granted.has(a)));
  const delay=Number.isFinite(intervalMs)?Math.min(60_000,Math.max(5000,Math.floor(intervalMs))):5000;
  let running=false,timer=null,stopped=false;
  let state={state:'idle',processed:0,submitted:0,failed:0,checkedAt:null};
  let activeController=null;
  const postResult=(id,body,signal)=>sendJson(fetcher,`${origin}/device-api/v1/tasks/${encodeURIComponent(id)}/result`,{token:config.deviceToken,body,signal});
  async function tick() {
    if(stopped)return {...state,state:'stopped'};
    if(running)return {...state,state:'busy'};
    running=true;
    activeController=new AbortController();
    const timeout=setTimeout(()=>activeController?.abort(),20_000);timeout.unref();
    const signal=activeController.signal;
    const next={state:'completed',processed:0,submitted:0,failed:0,checkedAt:clock().toISOString()};
    try {
      const body=await sendJson(fetcher,`${origin}/device-api/v1/tasks`,{token:config.deviceToken,signal});
      if(!record(body) || !Array.isArray(body.tasks) || body.tasks.length>20)throw unavailable('Jarvis task response is invalid or exceeds the local safety limit.');
      for(const raw of body.tasks) {
        if(stopped || signal.aborted)break;
        if(!record(raw)||!ID.test(raw.id??'')){next.failed++;continue;}
        const key=`cloud-task:${config.deviceId}:${raw.id}`;
        const payloadHash=digest({action:raw.action,payload:raw.payload,expiresAt:raw.expiresAt});
        const reservation=journal.reserve(key,payloadHash);
        next.processed++;
        if(!reservation.fresh) {
          if(reservation.payloadHash!==payloadHash){next.failed++;continue;}
          // Re-send a saved acknowledgement after a lost reply, but never repeat an OS action.
          if(record(reservation.result) && own(reservation.result,'status')) {
            await postResult(raw.id,reservation.result,signal);
            if(reservation.result.status==='completed')next.submitted++;else next.failed++;
          } else next.failed++;
          continue;
        }
        let report;
        try {
          const task=taskData(raw,clock);
          if(!permitted.has(task.action))throw unavailable('Capability was not granted locally.');
          if(stopped || signal.aborted)throw unavailable('Cloud link stopped before execution.');
          const result=await runTask(task);
          report={status:'completed',result:safeResult(task.action,result)};
          next.submitted++;
        } catch {
          report={status:'failed',result:{outcome:'failed',completionConfirmed:false,detail:'Local capability was unavailable, unapproved, invalid or expired. No automatic repeat was made.'}};
          next.failed++;
        }
        journal.finish(key,report,report.status==='failed');
        await postResult(raw.id,report,signal);
      }
      if(next.failed)next.state='partial';
      state=next;
      return state;
    } catch {
      state={...next,state:'error',detail:'Cloud link could not complete. Local action reservations remain in place; provider details and device credentials were withheld.'};
      return state;
    } finally {clearTimeout(timeout);activeController=null;running=false;}
  }
  return {
    tick,
    status:()=>({...state,enabled:!stopped,origin,deviceId:config.deviceId,allowedActions:[...permitted],intervalMs:delay}),
    start(){if(timer)return;stopped=false;void tick();timer=setInterval(()=>void tick(),delay);timer.unref();},
    stop(){stopped=true;if(timer)clearInterval(timer);timer=null;activeController?.abort();},
  };
}

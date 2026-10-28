import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { readdir, realpath, lstat, open } from 'node:fs/promises';
import { isIP } from 'node:net';
import { resolve, relative, isAbsolute, basename, join, sep } from 'node:path';
import { platform as currentPlatform, release } from 'node:os';

const MAX_FILE = 128 * 1024;
const MAX_BODY = 8 * 1024;
const hash = value => createHash('sha256').update(value).digest();
const equal = (a, b) => timingSafeEqual(hash(a), hash(b));
const error = (status, message) => Object.assign(new Error(message), { status });

export const APP_IDS = {
  darwin: { calculator: ['/usr/bin/open', ['-a', 'Calculator']], notes: ['/usr/bin/open', ['-a', 'Notes']], calendar: ['/usr/bin/open', ['-a', 'Calendar']] },
  win32: { calculator: ['calc.exe', []], notepad: ['notepad.exe', []] },
  linux: {},
};

export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113) ||
      (a === 168 && b === 63 && c === 129));
  }
  if (isIP(address) !== 6 || address.includes('%')) return false;
  const parts = address.toLowerCase().split('::');
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts[1] ? parts[1].split(':') : [];
  const words = [...left, ...Array(Math.max(0, 8-left.length-right.length)).fill('0'), ...right].map(x => parseInt(x,16));
  return words[0] >= 0x2000 && words[0] <= 0x3fff && !(words[0] === 0x2001 && (words[1] <= 0x1ff || words[1] === 0xdb8)) && words[0] !== 0x2002 && !(words[0] === 0x3fff && words[1] <= 0xfff);
}

export async function validateBrowserUrl(raw, resolveHost = name => lookup(name, { all: true, verbatim: true })) {
  if (typeof raw !== 'string' || raw.length > 2048) throw error(400, 'Enter a public HTTP(S) URL.');
  let url;
  try { url = new URL(raw); } catch { throw error(400, 'Invalid website URL.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port && !['80', '443'].includes(url.port)) throw error(400, 'Only public HTTP(S) websites on standard ports are supported.');
  if (!isIP(host) && (!host.includes('.') || /(?:^|\.)(localhost|local|internal|home|lan|test|invalid|example)$/i.test(host))) throw error(400, 'Local and internal websites are outside the browser capability.');
  const addresses = isIP(host) ? [{ address: host }] : await Promise.race([
    resolveHost(host), new Promise((_, reject) => { const timer = setTimeout(() => reject(error(408, 'DNS lookup timed out.')), 5000); timer.unref(); }),
  ]);
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw error(400, 'The website resolves to a private or special address.');
  return url.href;
}

/** OS integration uses fixed programs and argument arrays. No user-provided shell text is executed. */
export function browserCommand(url, platform) {
  if (platform === 'darwin') return ['/usr/bin/open', [url]];
  if (platform === 'win32') {
    // Encoded URL is passed through an environment variable; never interpolate it as PowerShell source.
    return [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:ATLAS_OPEN_URL'], { ATLAS_OPEN_URL: url }];
  }
  if (platform === 'linux') return ['xdg-open', [url]];
  throw error(503, 'This operating system is not supported by the local browser launcher.');
}

export async function launch(program, args, environment) {
  return new Promise((resolveLaunch, reject) => {
    const child = spawn(program, args, { shell: false, detached: true, stdio: 'ignore', env: environment ? { ...process.env, ...environment } : process.env });
    child.once('error', () => reject(error(503, 'The operating system could not launch that application.')));
    child.once('spawn', () => { child.unref(); resolveLaunch({ acceptedByOS: true, completionConfirmed: false }); });
  });
}

function scopedPath(root, requested) {
  if (typeof requested !== 'string' || requested.includes('\0') || requested.length > 2048 || isAbsolute(requested) || /^[A-Za-z]:/.test(requested) || requested.includes('\\')) throw error(400, 'Use a relative path inside your selected folder.');
  if (requested.split('/').some(part => part.startsWith('.') && part !== '.' && part !== '..') || /(?:^|\/)(?:credentials|id_rsa|id_ed25519|private[-_]key)(?:\.|$|\/)/i.test(requested) || /\.(?:pem|p12|pfx|key)$/i.test(requested)) throw error(403, 'Credential and hidden files are outside this read capability.');
  const candidate = resolve(root, requested);
  const rel = relative(root, candidate);
  if (rel.split(/[\\/]/)[0] === '..' || isAbsolute(rel)) throw error(403, 'Path is outside your selected folder.');
  return candidate;
}

export class LocalAgent {
  constructor({ root = null, allowedApps = [], platform = currentPlatform(), run = launch, resolveHost, journal = null, audit = () => {} } = {}) {
    this.root = root;
    this.allowedApps = new Set(allowedApps);
    this.platform = platform;
    this.run = run;
    this.resolveHost = resolveHost;
    this.audit = audit;
    this.journal = journal;
    this.requests = new Map();
  }
  status() {
    return { agent: 'Jarvis local device helper', runningOn: 'this laptop', operatingSystem: this.platform, osRelease: release(),
      capabilities: { openPublicWebsite: true, launchApplications: [...this.allowedApps].filter(id => Object.hasOwn(APP_IDS[this.platform] ?? {},id)),
        readSelectedFolder: Boolean(this.root), writeFiles: false, deleteFiles: false, arbitraryShell: false,
        inspectOrClickBrowser: false, controlOtherPhoneApps: false },
      limitations: ['Opening a browser page is an operating-system launch request; page loading, browsing and clicks are not confirmed.', 'This helper runs only on the device where you install it. It is not a phone-control service.'] };
  }
  async once(action, requestId, payload, fn) {
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) throw error(400, 'A unique requestId is required.');
    const key = `${action}:${requestId}`;
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const prior = this.requests.get(key);
    if (prior) {
      if (prior.payloadHash !== payloadHash) throw error(409, 'That requestId was already used for a different action.');
      return prior.result;
    }
    if (this.requests.size >= 1000) throw error(429, 'Local action limit reached. Restart the helper before issuing more actions.');
    if(this.journal) {
      const reservation=this.journal.reserve(key,payloadHash);
      if(!reservation.fresh) {
        if(reservation.payloadHash!==payloadHash) throw error(409,'That requestId was already used for a different action.');
        if(reservation.status==='submitted') return reservation.result;
        throw error(409,'That local action was already attempted or interrupted. Inspect the application before making a new request.');
      }
    }
    const result = (async () => {
      try { const out = await fn(); this.journal?.finish(key,out); this.audit({ action, outcome: 'attempted', at: new Date().toISOString() }); return out; }
      catch (e) { this.journal?.finish(key,{acceptedByOS:false,completionConfirmed:false},true); this.audit({ action, outcome: 'failed', at: new Date().toISOString() }); throw e; }
    })();
    this.requests.set(key, { payloadHash, result });
    return result;
  }
  async openBrowser({ url, requestId }) {
    return this.once('device.open_browser', requestId, { url }, async () => {
      const verified = await validateBrowserUrl(url, this.resolveHost);
      const [program, args, env] = browserCommand(verified, this.platform);
      return this.run(program, args, env);
    });
  }
  async openApp({ appId, requestId }) {
    if (typeof appId !== 'string' || !this.allowedApps.has(appId) || !Object.hasOwn(APP_IDS[this.platform] ?? {},appId)) throw error(403, 'That application has not been enabled in your local configuration.');
    return this.once('device.open_app', requestId, { appId }, () => {
      const [program, args] = APP_IDS[this.platform][appId];
      return this.run(program, args);
    });
  }
  async filePath(requested) {
    if (!this.root) throw error(403, 'Choose a read-only folder in the local configuration first.');
    const root = await realpath(this.root);
    const lexical = scopedPath(root, requested);
    let partPath=root;
    for(const part of relative(root,lexical).split(sep).filter(Boolean)) {
      partPath=join(partPath,part);
      if((await lstat(partPath)).isSymbolicLink()) throw error(403,'Symbolic links are outside the selected-folder read capability.');
    }
    const candidate = await realpath(lexical);
    const rel = relative(root, candidate);
    if (rel.split(/[\\/]/)[0] === '..' || isAbsolute(rel)) throw error(403, 'Symlink points outside your selected folder.');
    scopedPath(root,relative(root,candidate).split(sep).join('/'));
    return { root, candidate };
  }
  async listFiles({ path = '' } = {}) {
    const { candidate } = await this.filePath(path);
    const entries = await readdir(candidate, { withFileTypes: true });
    this.audit({ action: 'device.files.list', outcome: 'completed', at: new Date().toISOString() });
    return { entries: entries.slice(0,100).map(e => ({ name: e.name, kind: e.isSymbolicLink() ? 'symlink' : e.isDirectory() ? 'directory' : 'file' })), truncated: entries.length > 100 };
  }
  async readText({ path }) {
    const { candidate } = await this.filePath(path);
    const handle = await open(candidate, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_FILE) throw error(400, 'Only text files up to 128 KiB can be read.');
      const buffer = Buffer.alloc(MAX_FILE + 1);
      const { bytesRead } = await handle.read(buffer, 0, MAX_FILE + 1, 0);
      const data = buffer.subarray(0,bytesRead);
      if (bytesRead > MAX_FILE || data.includes(0)) throw error(400, 'This is not a supported small text file.');
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { throw error(400, 'File is not UTF-8 text.'); }
      this.audit({ action: 'device.files.read', outcome: 'completed', at: new Date().toISOString() });
      return { name: basename(candidate), text, trust: 'untrusted_local_file_content', bytes: bytesRead };
    } finally { await handle.close(); }
  }
}

export function createHandler({ token, origin, agent, cloud = null, ui = '', now = () => Date.now() }) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('A strong local device token is required.');
  const expected = new URL(origin);
  if (expected.protocol !== 'http:' || expected.hostname !== '127.0.0.1') throw new Error('The local helper must use an IPv4 loopback origin.');
  const sessions = new Map();
  const failures = [];
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'", 'Referrer-Policy': 'no-referrer' };
  const reply = (res,status,payload,extra={}) => { res.writeHead(status,{...headers,...extra});res.end(JSON.stringify(payload)); };
  const json = async req => {
    if ((req.headers['content-type'] ?? '').split(';')[0].trim() !== 'application/json') throw error(415, 'JSON body required.');
    let bytes = 0, body = '';
    for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX_BODY) throw error(413, 'Request too large.'); body += chunk; }
    try { return JSON.parse(body); } catch { throw error(400, 'Invalid JSON.'); }
  };
  return async (req,res) => {
    try {
      if (req.headers.host !== expected.host) return reply(res,403,{error:'Invalid local host.'});
      const path = new URL(req.url,origin).pathname;
      if (req.method === 'GET' && path === '/healthz') return reply(res,200,{ok:true});
      const requestOrigin = req.headers.origin;
      if (requestOrigin && requestOrigin !== expected.origin) return reply(res,403,{error:'Cross-origin access denied.'});
      if (!['GET','POST'].includes(req.method)) return reply(res,405,{error:'Method not allowed.'});
      if (req.method === 'GET' && path === '/') { res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8'}); return res.end(ui); }
      if (req.method === 'GET' && path === '/ui.js') { res.writeHead(200,{...headers,'Content-Type':'text/javascript; charset=utf-8'}); return res.end(UI_SCRIPT); }
      if (req.method === 'GET' && path === '/ui.css') { res.writeHead(200,{...headers,'Content-Type':'text/css; charset=utf-8'}); return res.end(UI_STYLE); }
      if (req.method === 'POST' && requestOrigin !== expected.origin) return reply(res,403,{error:'Same-origin owner request required.'});
      if (req.method === 'POST' && path === '/local/session') {
        const recent = failures.filter(t=>now()-t<900000);failures.splice(0,failures.length,...recent);
        if (failures.length >= 8) return reply(res,429,{error:'Too many failed sign-ins. Try again in 15 minutes.'});
        const body = await json(req);
        if (typeof body.token !== 'string' || !equal(body.token,token)) { failures.push(now()); return reply(res,401,{error:'Device key was not accepted.'}); }
        const id = randomBytes(32).toString('base64url');sessions.set(hash(id).toString('hex'),now()+43200000);
        return reply(res,200,{authenticated:true},{'Set-Cookie':`atlas_local=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`});
      }
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      const cookie = /(?:^|;\s*)atlas_local=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
      const session = cookie ? sessions.get(hash(cookie).toString('hex')) : undefined;
      if (!(bearer && equal(bearer,token)) && !(session && session>now())) return reply(res,401,{error:'Local owner authentication required.'});
      if (req.method === 'POST' && path === '/local/logout') { if(cookie) sessions.delete(hash(cookie).toString('hex'));return reply(res,200,{authenticated:false},{'Set-Cookie':'atlas_local=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'}); }
      if (req.method === 'GET' && path === '/local/status') return reply(res,200,{...agent.status(),cloud:cloud?.status()??{state:'not_paired'}});
      if (req.method !== 'POST') return reply(res,404,{error:'Not found.'});
      const body = await json(req);
      if (path === '/local/cloud/pair') { if(!cloud) throw error(503,'Private remote link is unavailable.'); return reply(res,200,await cloud.pair(body)); }
      if (path === '/local/cloud/disconnect') { if(!cloud) throw error(503,'Private remote link is unavailable.'); return reply(res,200,await cloud.disconnect()); }
      if (path === '/local/browser/open') return reply(res,202,await agent.openBrowser(body));
      if (path === '/local/apps/open') return reply(res,202,await agent.openApp(body));
      if (path === '/local/files/list') return reply(res,200,await agent.listFiles(body));
      if (path === '/local/files/read') return reply(res,200,await agent.readText(body));
      return reply(res,404,{error:'Not found.'});
    } catch(e) { return reply(res,e.status ?? 500,{error:e.status ? e.message : 'Local operation unavailable. No provider or file details were logged.'}); }
  };
}

export const UI_HTML = `<!doctype html><html lang="en-AU"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jarvis • This laptop</title><link rel="stylesheet" href="/ui.css"><main><header><p>PRIVATE DEVICE WORKSPACE</p><h1>JARVIS</h1><span>Local device console on this laptop</span></header><section id="signin"><h2>Connect this device</h2><p>Enter the device key from your local key file. It stays on this laptop.</p><form id="login"><input type="password" id="token" autocomplete="off" placeholder="Local device key" required><button>Unlock Jarvis</button></form></section><section id="controls" hidden><div class="top"><h2>This laptop</h2><button id="logout">Lock</button></div><p id="capabilities"></p><h3>Private access from your other devices</h3><p id="cloud-status">Not paired. This Mac only accepts actions you authorise during pairing.</p><form id="pair"><input id="server-origin" type="url" placeholder="https://your-private-Jarvis-host" required><input id="pair-code" type="password" autocomplete="off" placeholder="One-time pairing code" required><label><input id="permit-browser" type="checkbox" checked> Open public websites</label><label><input id="permit-apps" type="checkbox"> Open your allowed apps</label><button>Pair this Mac</button><button type="button" id="disconnect">Disconnect</button></form><h3>Open a website</h3><p>Jarvis opens the address in your normal browser. Page reading, clicks and other-app automation are not connected.</p><form id="browser"><input id="url" type="url" placeholder="https://..." required><button>Open website</button></form><h3>Allowed applications</h3><div id="apps"></div><h3>Read your selected folder</h3><p>Folder access starts disabled. Configure a folder locally to allow read-only access.</p><form id="files"><input id="path" placeholder="Relative path; blank lists the selected folder"><button>List folder</button><button type="button" id="read">Read text</button></form></section><p id="message" role="status"></p><pre id="result"></pre><footer>Runs on this device. iPhone app control, shell commands, file writes and deleting files are unavailable.</footer></main><script src="/ui.js"></script></html>`;
export const UI_SCRIPT = `const $=id=>document.getElementById(id);async function request(path,body){const r=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw Error(j.error||'Operation failed');return j}const show=value=>$('result').textContent=typeof value==='string'?value:JSON.stringify(value,null,2);const fail=e=>$('message').textContent=e.message;async function status(){const s=await request('/local/status');$('signin').hidden=true;$('controls').hidden=false;$('cloud-status').textContent=s.cloud?.detail||('Remote link: '+(s.cloud?.state||'not_paired'));$('capabilities').textContent='Operating system: '+s.operatingSystem+' • '+(s.capabilities.readSelectedFolder?'Selected folder readable':'Folder access disabled');$('apps').replaceChildren();for(const id of s.capabilities.launchApplications){const b=document.createElement('button');b.textContent=id;b.onclick=()=>request('/local/apps/open',{appId:id,requestId:crypto.randomUUID()}).then(show).catch(fail);$('apps').append(b)}}$('pair').onsubmit=async e=>{e.preventDefault();const actions=['device.status'];if($('permit-browser').checked)actions.push('browser.open');if($('permit-apps').checked)actions.push('apps.open');try{await request('/local/cloud/pair',{origin:$('server-origin').value,pairCode:$('pair-code').value,allowedActions:actions});$('pair-code').value='';await status()}catch(e){fail(e)}};$('disconnect').onclick=()=>request('/local/cloud/disconnect',{}).then(status).catch(fail);$('login').onsubmit=async e=>{e.preventDefault();try{await request('/local/session',{token:$('token').value});$('token').value='';await status()}catch(e){fail(e)}};$('browser').onsubmit=e=>{e.preventDefault();request('/local/browser/open',{url:$('url').value,requestId:crypto.randomUUID()}).then(show).catch(fail)};$('files').onsubmit=e=>{e.preventDefault();request('/local/files/list',{path:$('path').value}).then(show).catch(fail)};$('read').onclick=()=>request('/local/files/read',{path:$('path').value}).then(show).catch(fail);$('logout').onclick=()=>request('/local/logout',{}).then(()=>{$('controls').hidden=true;$('signin').hidden=false;$('result').textContent=''}).catch(fail);status().catch(()=>{});`;
export const UI_STYLE = `:root{font-family:system-ui;color:#e4edf8;background:#071019;color-scheme:dark}*{box-sizing:border-box}body{margin:0}main{max-width:820px;padding:48px 24px;margin:auto}header{margin-bottom:32px}header p{letter-spacing:.25em;font-size:11px;color:#67dce2}h1{letter-spacing:.24em;font-size:42px;margin:8px 0}header span,p,footer{color:#a2b3c6;line-height:1.6}section{padding:24px;margin-bottom:16px;border:1px solid #253746;border-radius:16px;background:#0e1b29}form{display:flex;gap:10px;flex-wrap:wrap}input[type=checkbox]{min-width:0;flex:none;width:auto}label{font-size:13px;display:flex;align-items:center;gap:6px}input{min-width:180px;flex:1;border:1px solid #385064;background:#071019;border-radius:8px;padding:12px;color:#fff}button{border:0;border-radius:8px;background:#67dce2;color:#08202b;padding:12px 16px;font-weight:650;cursor:pointer}h2{margin-top:0}.top{display:flex;justify-content:space-between;align-items:center}.top button{background:#233a4e;color:#fff}#apps{display:flex;gap:8px}pre{max-height:400px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#0e1b29;padding:16px;border-radius:12px}#message{color:#ffd398}footer{font-size:12px;margin-top:24px}[hidden]{display:none!important}`;

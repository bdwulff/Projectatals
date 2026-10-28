import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { chooseLocalReportVoice, discoveryReportSpeechText, hasSpokenDiscoveryReport, makeDiscoveryReportUtterance, markDiscoveryReportSpoken } from '../src/discovery-report-voice.ts';

const values = new Map(), session = new Map();
const storage = map => ({ getItem:key => map.get(key) ?? null, setItem:(key,value) => map.set(key,value) });
globalThis.localStorage = storage(values);
globalThis.sessionStorage = storage(session);
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
let voices = [
  { voiceURI:'browser-au', lang:'en-AU', localService:false },
  { voiceURI:'installed-uk', lang:'en-GB', localService:true },
  { voiceURI:'installed-au', lang:'en-AU', localService:true },
];
globalThis.window = { speechSynthesis: { getVoices:() => voices }, dispatchEvent:() => {} };
const originalFetch = globalThis.fetch;
let networkRequests = 0;
globalThis.fetch = async () => { networkRequests++; throw new Error('Local reports cannot request a provider.'); };
after(() => { globalThis.fetch = originalFetch; });

test('discovery speech excludes browser online voices even when they are preferred', () => {
  values.set('jarvis.device-voice','browser-au');
  assert.equal(chooseLocalReportVoice(voices)?.voiceURI,'installed-au');
  values.set('jarvis.device-voice','installed-uk');
  assert.equal(chooseLocalReportVoice(voices)?.voiceURI,'installed-uk');
  assert.equal(chooseLocalReportVoice(voices.filter(v=>!v.localService)),undefined);
});

test('reports use bounded plain text and explicitly announce fictional data', () => {
  const report = { id:'fictional-report', fixture:true, spokenSummary:'\u0000 Three fictional concepts.\n'+ 'a'.repeat(1100) };
  const text = discoveryReportSpeechText(report);
  assert.match(text,/^Fictional test report\. Three fictional concepts\./);
  assert.equal(text.length,900);
  assert.ok(!/[\u0000-\u001f\u007f]/.test(text));
});

test('no installed voice fails closed instead of generating paid or browser cloud speech', () => {
  const saved = voices; voices = saved.filter(v=>!v.localService);
  assert.equal(makeDiscoveryReportUtterance({id:'no-voice',fixture:false,spokenSummary:'Three drafts ready.'}),null);
  voices = saved;
  const utterance = makeDiscoveryReportUtterance({id:'local-report',fixture:false,spokenSummary:'Three drafts ready.'});
  assert.equal(utterance.voice.voiceURI,'installed-uk');
  assert.equal(utterance.text,'Three drafts ready.');
  assert.equal(networkRequests,0);
});

test('manual and global speech share persistent report deduplication without storing report text', () => {
  assert.equal(hasSpokenDiscoveryReport('shared-report'),false);
  markDiscoveryReportSpoken('shared-report');
  assert.equal(hasSpokenDiscoveryReport('shared-report'),true);
  assert.equal(hasSpokenDiscoveryReport('new-report'),false);
  assert.equal(values.get('jarvis.discovery.reports-spoken'),'["shared-report"]');
  assert.equal(session.get('jarvis.discovery.reports-spoken'),'["shared-report"]');
});

test('blocked browser storage still deduplicates within the visit and limits retained IDs', () => {
  const oldLocal = globalThis.localStorage, oldSession = globalThis.sessionStorage;
  const blocked = { getItem:() => { throw new Error('blocked'); }, setItem:() => { throw new Error('blocked'); } };
  globalThis.localStorage = blocked; globalThis.sessionStorage = blocked;
  markDiscoveryReportSpoken('private-visit');
  assert.equal(hasSpokenDiscoveryReport('private-visit'),true);
  globalThis.localStorage = oldLocal; globalThis.sessionStorage = oldSession;
  for (let i=0;i<40;i++) markDiscoveryReportSpoken('bounded-'+i);
  assert.equal(JSON.parse(values.get('jarvis.discovery.reports-spoken')).length,30);
  assert.equal(hasSpokenDiscoveryReport('bounded-39'),true);
  assert.equal(networkRequests,0);
});

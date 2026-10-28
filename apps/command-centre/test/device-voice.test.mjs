import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { chooseDeviceVoice, greetingForTime, makeDeviceUtterance, readDeviceVoicePreference, saveDeviceVoicePreference, hasGreetedSession, markGreetedSession, resetGreetingSession, setDeviceVoiceActivity, deviceVoiceActivityActive, deviceVoiceBusy } from '../src/voice.ts';

const localValues = new Map();
const sessionValues = new Map();
const storage = values => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) });
globalThis.localStorage = storage(localValues);
globalThis.sessionStorage = storage(sessionValues);
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
globalThis.HTMLMediaElement = class {};
const voices = [
  { voiceURI: 'remote-au', name: 'Browser Australian', lang: 'en-AU', localService: false },
  { voiceURI: 'local-uk', name: 'Installed English', lang: 'en-GB', localService: true },
  { voiceURI: 'local-au', name: 'Installed Australian', lang: 'en-AU', localService: true },
];
const speech = { getVoices: () => voices, speaking: false, pending: false };
globalThis.window = { speechSynthesis: speech, dispatchEvent: () => {} };
globalThis.document = { querySelectorAll: () => [] };
const originalFetch = globalThis.fetch;
let fetches = 0;
globalThis.fetch = async () => { fetches++; throw new Error('Device speech must not request a network provider.'); };
after(() => { globalThis.fetch = originalFetch; });

test('greeting uses Melbourne time and fixed owner text across UTC day boundary', () => {
  assert.match(greetingForTime(new Date('2026-10-26T20:00:00Z')), /^Good morning, Brandon\./);
  assert.match(greetingForTime(new Date('2026-10-26T04:00:00Z')), /^Good afternoon, Brandon\./);
  assert.match(greetingForTime(new Date('2026-10-26T09:00:00Z')), /^Good evening, Brandon\./);
});

test('automatic choice prefers an installed Australian voice and honours an explicit device choice', () => {
  assert.equal(chooseDeviceVoice(voices, 'auto')?.voiceURI, 'local-au');
  assert.equal(chooseDeviceVoice(voices, 'local-uk')?.voiceURI, 'local-uk');
  assert.equal(chooseDeviceVoice(voices.filter(v => v.voiceURI !== 'local-au'), 'auto')?.voiceURI, 'local-uk');
  assert.equal(chooseDeviceVoice([], 'auto'), undefined);
});

test('device preference and utterance use no Atlas, AI or ElevenLabs request', () => {
  saveDeviceVoicePreference('local-uk');
  assert.equal(readDeviceVoicePreference(), 'local-uk');
  const utterance = makeDeviceUtterance('Local greeting only.');
  assert.equal(utterance.text, 'Local greeting only.');
  assert.equal(utterance.voice.voiceURI, 'local-uk');
  assert.equal(utterance.lang, 'en-GB');
  assert.equal(fetches, 0);
});

test('successful greeting is remembered only for the same sign-in and reset on sign-out', () => {
  resetGreetingSession();
  assert.equal(hasGreetedSession('sign-in-a'), false);
  markGreetedSession('sign-in-a');
  assert.equal(hasGreetedSession('sign-in-a'), true);
  assert.equal(hasGreetedSession('sign-in-b'), false);
  resetGreetingSession();
  assert.equal(hasGreetedSession('sign-in-a'), false);
});

test('microphone, command and existing media block the automatic greeting without cancelling audio', () => {
  setDeviceVoiceActivity('command', true);
  setDeviceVoiceActivity('microphone', true);
  setDeviceVoiceActivity('command', false);
  assert.equal(deviceVoiceActivityActive(), true);
  assert.equal(deviceVoiceBusy(), true);
  setDeviceVoiceActivity('microphone', false);
  assert.equal(deviceVoiceBusy(), false);
  speech.pending = true;
  assert.equal(deviceVoiceBusy(), true);
  speech.pending = false;
  const media = new HTMLMediaElement(); media.paused = false; media.ended = false;
  document.querySelectorAll = () => [media];
  assert.equal(deviceVoiceBusy(), true);
  media.paused = true;
  assert.equal(deviceVoiceBusy(), false);
  document.querySelectorAll = () => [];
});

test('blocked storage preserves a visit-level greeting fallback', () => {
  const original = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem: () => { throw new Error('storage denied'); }, setItem: () => { throw new Error('storage denied'); }, removeItem: () => { throw new Error('storage denied'); } };
  resetGreetingSession(); markGreetedSession('no-storage');
  assert.equal(hasGreetedSession('no-storage'), true);
  resetGreetingSession(); assert.equal(hasGreetedSession('no-storage'), false);
  globalThis.sessionStorage = original;
});

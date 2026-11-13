import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {actionCounts, modelTraces, sameState} from './calendar-itf.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const model = {path: 'specs/quint/application/BrowserAlarmRinging.qnt', module: 'BrowserAlarmRinging', traces: 30, steps: 40,
  witnesses: ['RingingWitness', 'OtherPageSilentWitness', 'SilentAfterMinuteWitness', 'HiddenDuringGrantWitness', 'HandoverWitness'],
  goals: {
    // The page that was hidden while its lock was pending ran the callback and gave the lock back.
    hiddenGrantReturned: 'not(s.tabs.get(2).allowed) and not(s.tabs.get(2).granted) and s.lockHolder == 0 and s.posted != 0 and s.versions == 1 and not(s.tabs.get(1).owns)',
    secondSetRings: 's.tabs.get(1).sound and s.tabs.get(1).ringing == 2',
  }};
// Page edges only. clock.ts and alert-audio.ts in the bundle are the real sources.
const ports = {
  './dialog-layout': 'exports.layoutBrowserDialog = (dialog, actions) => dialog.append(...actions);',
  '../runtime/inline-modal': 'exports.createInlineModal = () => ({ref() {}});',
  './screen-locked': 'exports.browserScreenLocked = () => __page.locked;',
  './device-preferences': 'exports.cachedDevicePreferences = () => ({alarm: 70, ring: 70, doNotDisturb: false});',
  './preference-documents': 'exports.alertSoundDocument = {read: async initial => initial(), edit: async () => false};',
  '../build-flags': 'exports.testMocksEnabled = false;',
};

/** `mutate` rewrites the bundled Clock, for checks that the replay notices a changed implementation. */
export async function buildBrowserClock(mutate = code => code) {
  const built = await build({absWorkingDir: root, stdin: {contents: `export {BrowserClock} from './apps/app/src/browser/clock.ts';`,
    resolveDir: root, loader: 'ts'}, bundle: true, platform: 'node', format: 'cjs', write: false, metafile: true,
  plugins: [{name: 'clock-ports', setup(builder) {
    builder.onResolve({filter: /.*/}, args => Object.hasOwn(ports, args.path) ? {path: args.path, namespace: 'clock-port'} : undefined);
    builder.onLoad({filter: /.*/, namespace: 'clock-port'}, args => ({loader: 'js', contents: ports[args.path]}));
  }}]});
  const sources = Object.keys(built.metafile.inputs).filter(path => !path.includes(':') && !path.startsWith('node_modules/'));
  for (const needed of ['apps/app/src/browser/clock.ts', 'apps/app/src/browser/alert-audio.ts']) assert.ok(sources.includes(needed), needed);
  return {code: mutate(built.outputFiles[0].text), sources};
}

const turn = () => new Promise(resolve => setImmediate(resolve));
const idle = async () => { for (let index = 0; index < 12; index++) await turn(); };

/** Two pages of one origin: separate documents and Clock instances over one alarm set and one lock manager. */
function pages(compiled) {
  const shared = {posted: 0, versions: 0, holder: 0, pending: null};
  const rows = () => ({reminders: shared.posted ? [{id: 'alarm_wake', title: 'Wake', at: 0, status: 'posted', revision: String(shared.posted)}] : []});
  const page = id => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'https://alpha.test/', pretendToBeVisual: true});
    const {window} = dom, {document} = window;
    const self = {id, window, document, hidden: false, locked: false, hiddenBy: '', now: 0, tones: 0, holdNext: false, heldRead: null, intervals: new Set()};
    Object.defineProperty(document, 'hidden', {configurable: true, get: () => self.hidden});
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { if (!this.open) return; this.open = false; this.dispatchEvent(new window.Event('close')); };
    // Web Locks with ifAvailable: a held lock answers null at once; a free lock is assigned and its
    // callback runs when the driver grants it. The lock is free again when the callback's promise ends.
    const navigator = {locks: {request(name, options, callback) {
      assert.equal(name, 'alpha.browser.alarm-owner');
      assert.equal(options.ifAvailable, true);
      if (shared.holder) return Promise.resolve(callback(null));
      shared.holder = id;
      return new Promise((resolve, reject) => {
        shared.pending = {id, run() {
          shared.pending = null;
          Promise.resolve(callback({name})).finally(() => { shared.holder = 0; }).then(resolve, reject);
        }};
      });
    }}};
    class Tone { frequency = {value: 0}; connect() {} disconnect() {} start() { self.tones++; } stop() {} }
    class AudioContext {
      state = 'running'; currentTime = 0; destination = {};
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createOscillator() { return new Tone(); }
      createGain() { return {gain: {setValueAtTime() {}, linearRampToValueAtTime() {}}, connect() {}, disconnect() {}}; }
    }
    // Poll and sound timers run only when the driver fires them.
    const setInterval = run => { const timer = {run}; self.intervals.add(timer); return timer; };
    const clearInterval = timer => { if (timer) self.intervals.delete(timer); };
    const daily = {listReminders() {
      if (!self.holdNext) return Promise.resolve(rows());
      self.holdNext = false;
      return new Promise(resolve => { self.heldRead = () => { self.heldRead = null; resolve(rows()); }; });
    }};
    const module = {exports: {}};
    new Function('module', 'exports', '__page', 'window', 'document', 'navigator', 'setInterval', 'clearInterval', 'performance',
      'getComputedStyle', 'AudioContext', compiled.code)(module, module.exports, self, window, document, navigator, setInterval,
      clearInterval, {now: () => self.now}, window.getComputedStyle.bind(window), AudioContext);
    self.clock = new module.exports.BrowserClock(daily, {list: async () => ({items: []})});
    // The alert audio starts its context on the first gesture.
    document.dispatchEvent(new window.Event('pointerdown'));
    return self;
  };
  return {shared, tabs: {1: page(1), 2: page(2)}};
}

async function replay(compiled, trace) {
  const {shared, tabs} = pages(compiled);
  const observe = () => ({posted: shared.posted, versions: shared.versions, lockHolder: shared.holder,
    tabs: Object.fromEntries(Object.entries(tabs).map(([id, tab]) => [id, {
      allowed: tab.clock.allowed(), granted: shared.pending?.id === tab.id, owns: tab.clock.owns,
      ringing: tab.clock.ringing ? Number(tab.clock.ringing.split(':')[1]) : 0, sound: tab.clock.soundTimer !== undefined}]))});
  // One poll of a page: the read a return to the foreground started, or a fresh one.
  const poll = tab => { if (tab.heldRead) tab.heldRead(); else tab.window.dispatchEvent(new tab.window.Event('alpha:alarms-changed')); };
  try {
    sameState(observe(), trace.steps[0].state, trace, 0);
    for (let index = 1; index < trace.steps.length; index++) {
      const {action, picks, state} = trace.steps[index], tab = tabs[picks.t], tones = tab?.tones;
      const before = trace.steps[index - 1].state;
      if (action === 'alarmPosted') shared.posted = ++shared.versions;
      else if (action === 'alarmCleared') shared.posted = 0;
      else if (action === 'pollOwner' || action === 'requestLock') poll(tab);
      else if (action === 'lockGranted') { assert.equal(shared.pending?.id, tab.id, 'the lock is assigned to this page'); shared.pending.run(); }
      else if (action === 'hide') {
        // Alternately the page goes to the background and the screen locks over it.
        tab.hiddenBy = index % 2 ? 'visibility' : 'lock';
        if (tab.hiddenBy === 'visibility') { tab.hidden = true; tab.document.dispatchEvent(new tab.window.Event('visibilitychange')); }
        else { tab.locked = true; tab.window.dispatchEvent(new tab.window.Event('alpha:device-state')); }
      } else if (action === 'show') {
        if (tab.hiddenBy === 'visibility') {
          // Returning to the foreground polls at once. That poll's read waits here until the model polls this page.
          tab.hidden = false; tab.holdNext = !tab.heldRead;
          tab.document.dispatchEvent(new tab.window.Event('visibilitychange'));
          assert.equal(tab.holdNext, false, 'a page returning to the foreground polls');
        } else { tab.locked = false; tab.window.dispatchEvent(new tab.window.Event('alpha:device-state')); }
      } else if (action === 'soundEnds') {
        // Alternately the minute runs out and the owner presses Back on the alarm page.
        if (index % 2 || !tab.clock.dialog?.open) { tab.now += 60000; tab.clock.soundTimer.run(); }
        else tab.document.querySelector('dialog button[aria-label="Back"]').click();
      } else assert.ok(!action, `unknown model action ${action}`);
      await idle();
      sameState(observe(), state, trace, index);
      // A newly rung set plays the alarm tone in that page and nowhere else.
      if (tab && state.tabs[tab.id].ringing && state.tabs[tab.id].ringing !== before.tabs[tab.id].ringing)
        assert.ok(tab.tones > tones, `${trace.name} step ${index}: the alarm tone played`);
      for (const other of Object.values(tabs)) if (!state.tabs[other.id].owns)
        assert.equal(other.clock.soundTimer, undefined, `${trace.name} step ${index}: a page that does not own is silent`);
    }
  } finally {
    for (const tab of Object.values(tabs)) { tab.heldRead?.(); tab.hidden = true; tab.clock.retire(); tab.window.close(); }
    await idle();
  }
}

/** Replays BrowserAlarmRinging traces against two real BrowserClock instances sharing one lock. */
export async function checkBrowserAlarmRinging(mutate) {
  const [traces, compiled] = await Promise.all([modelTraces(model), buildBrowserClock(mutate)]);
  let steps = 0;
  for (const trace of traces) { await replay(compiled, trace); steps += trace.steps.length - 1; }
  return {traces: traces.length, steps, actions: actionCounts(traces), sources: compiled.sources};
}

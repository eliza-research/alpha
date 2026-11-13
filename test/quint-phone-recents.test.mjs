import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {modelTraces, replay, tick} from '../specs/quint/refinement/application/shell-model-traces.mjs';

// PhoneRecents traces from the simulator, replayed on installPhoneAdapter with a telephony client
// whose status read and dial handoff settle when the model says they do. The call log, the system
// prompt and the dial screen are the environment; nothing here reads a device.
const stubs = {
  'aosp-image': 'export const aospImage=false;',
  'native-adapter': 'export function watchReturnToApp(){return ()=>{};}',
  'mvp-features': 'export function isMvpView(){return false;}',
  'platform-plugins': 'export function registerPlugin(){return {};}',
};
const bundled = await build({entryPoints: [resolve('apps/app/src/prototype/phone-adapter.ts')], bundle: true, format: 'esm',
  platform: 'node', write: false, external: ['@capacitor/core'], plugins: [{name: 'stubs', setup(b) {
    b.onResolve({filter: /^(\.\.\/runtime\/aosp-image|\.\/native-adapter|\.\/mvp-features|\.\.\/platform-plugins)$/}, a => ({path: a.path, namespace: 'stub'}));
    b.onLoad({filter: /.*/, namespace: 'stub'}, a => ({contents: Object.entries(stubs).find(([name]) => a.path.includes(name))[1], loader: 'js'}));
  }}]});
const {installPhoneAdapter} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const HANDOFF = 'Your phone app is open with the number.', INVALID = 'Invalid number';
const VALID = '+15555550100', call = {id: '4', number: VALID, cachedName: 'Ada', date: 1700000000000, durationSeconds: 75, type: 'missed', isNew: true};
const permissions = access => ({permissions: access === 'unsupported' ? {} : {callLog: access}});

function fixture(initial) {
  let access = initial.access, requestReads = 0, accessRequests = 0, handoffs = 0;
  const reads = [], dials = [], listeners = new Set();
  globalThis.document = {hidden: false, addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener)};
  const deferred = () => { let settle, fail; const promise = new Promise((yes, no) => { settle = yes; fail = no; }); return {promise, settle, fail}; };
  const client = {
    async placeCall() {throw Object.assign(Error('This host does not hold the dialer role'), {code: 'role-required'});},
    status() { const read = deferred(); reads.push(read); return read.promise; },
    async requestAccess(kind) { assert.equal(kind, 'callLog'); accessRequests++; return permissions(access); },
    async recentCalls(limit) { assert.equal(limit, 50); return [call]; },
    dial(target) { assert.equal(target, VALID); handoffs++; const dial = deferred(); dials.push(dial); return dial.promise; },
  };
  const views = {phone: {}};
  class Shell { constructor() { this.view = null; } S() { return {view: this.view}; } setState() {} }
  installPhoneAdapter(Shell, views, client);
  const shell = new Shell();
  shell.componentDidMount();
  const page = () => views.phone.render({}, {});
  const TYPED = {'': '', valid: VALID, invalid: '*#06#'};
  // Each started read and handoff is named by the token the model gave it.
  const adopt = (list, before, after, name) => {
    const fresh = after.filter(item => !before.some(old => JSON.stringify(old) === JSON.stringify(item)));
    const unnamed = list.filter(entry => entry.name === undefined);
    assert.equal(unnamed.length, fresh.length, `${name} started by this step`);
    if (fresh.length) unnamed[0].name = JSON.stringify(fresh[0]);
  };
  const take = (list, name) => { const at = list.findIndex(entry => entry.name === JSON.stringify(name)); assert.ok(at >= 0); return list.splice(at, 1)[0]; };
  return {
    async apply(step, before) {
      const {action, picks, state} = step;
      if (action === 'openPhone') { shell.view = 'phone'; shell.componentDidUpdate(); }
      else if (action === 'leavePhone') { shell.view = null; shell.componentDidUpdate(); }
      else if (action === 'hide' || action === 'show') { document.hidden = action === 'hide'; for (const listener of [...listeners]) listener(); }
      else if (action === 'unmount') shell.componentWillUnmount();
      else if (action === 'refresh') { if (picks.flag) { requestReads++; page().nativeRequest(); } else page().nativeRefresh(); }
      else if (action === 'systemPrompt') access = picks.flag ? 'granted' : 'denied';
      else if (action === 'readSettles') {
        const read = take(reads, picks.read);
        if (picks.flag) read.fail(Error('locked')); else read.settle(permissions(access));
      } else if (action === 'typeNumber') page().nativeOnNumber({target: {value: TYPED[picks.value]}});
      // A recent call's row dials its own number; the Dial control dials what the field holds.
      else if (action === 'dial') { if (picks.flag) page().nativeRows[0].dial(); else page().nativeDial(); }
      else if (action === 'dialSettles') take(dials, picks.d).settle({message: HANDOFF});
      else assert.fail(`unmapped action ${action}`);
      await tick();
      adopt(reads, before.reads, state.reads, 'reads');
      adopt(dials, before.dials, state.dials, 'handoffs');
      assert.ok(accessRequests <= requestReads, 'access is asked for only inside a read the owner requested');
    },
    observe() {
      const shown = page(), notice = shown.nativeNotice === HANDOFF ? 'handoff' : shown.nativeNotice === INVALID ? 'invalid' : shown.nativeNotice;
      return {busy: shown.nativeBusy, rows: shown.nativeRows.length > 0, needsAccess: shown.nativeAccess,
        notice, number: Object.keys(TYPED).find(name => TYPED[name] === shown.nativeNumber), reads: reads.length, dials: dials.length, handoffs};
    },
  };
}

test('simulated PhoneRecents traces agree with the image Phone adapter after every step', {timeout: 120000}, async () => {
  const traces = modelTraces({module: 'PhoneRecents', traces: 300, steps: 40});
  const result = await replay(traces, {
    start: ({state}) => fixture(state),
    project: s => ({busy: s.reading || s.dialing, rows: s.rows, needsAccess: s.needsAccess, notice: s.notice, number: s.number,
      reads: s.reads.length, dials: s.dials.length, handoffs: s.handoffs}),
  });
  assert.deepEqual([...result.exercised].sort(),
    ['dial', 'dialSettles', 'hide', 'leavePhone', 'openPhone', 'readSettles', 'refresh', 'show', 'systemPrompt', 'typeNumber', 'unmount']);
});

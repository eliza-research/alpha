import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {modelTraces, replay} from '../specs/quint/refinement/application/shell-model-traces.mjs';

// InertHold traces from the simulator, replayed on holdPhoneInert with a stand-in phone element.
// The module's owner record is read through the same source so the count and the remembered
// earlier flag are observed, not inferred.
const source = stripTypeScriptTypes(readFileSync('apps/app/src/runtime/modal-inert.ts', 'utf8')).replace(/^export /gm, '');
const load = () => {
  const context = vm.createContext({});
  vm.runInContext(`${source}\nglobalThis.api = {holdPhoneInert, owners};`, context);
  return context.api;
};

test('simulated InertHold traces agree with holdPhoneInert after every step', {timeout: 120000}, async () => {
  const traces = modelTraces({module: 'InertHold', traces: 60, steps: 30});
  const result = await replay(traces, {
    start() {
      const {holdPhoneInert, owners} = load(), phone = {inert: false}, handles = new Map();
      return {
        apply({action, picks}) {
          if (action === 'setOutside') phone.inert = picks.flag;
          else if (action === 'hold') handles.set(picks.panel, holdPhoneInert(phone));
          else if (action === 'release') handles.get(picks.panel)();
          // A reopened panel takes a new handle on its next hold; the old one is dropped.
          else if (action === 'reopen') handles.delete(picks.panel);
          else assert.fail(`unmapped action ${action}`);
        },
        observe() {
          const owner = owners.get(phone);
          return {inert: phone.inert, count: owner?.count ?? 0, previous: owner ? owner.previous : null};
        },
      };
    },
    project: s => ({inert: s.inert, count: s.count, previous: s.count > 0 ? s.previous : null}),
  });
  assert.deepEqual([...result.exercised].sort(), ['hold', 'release', 'reopen', 'setOutside']);
  assert.equal(result.traces, 60);
});

test('a missing phone element yields a release that does nothing', () => {
  const {holdPhoneInert} = load();
  assert.doesNotThrow(() => holdPhoneInert(null)());
});

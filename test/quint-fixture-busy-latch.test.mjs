// Partial source contract regression evidence. Original schedules, actions and assertions are retained.
// Only the selected source members/components and controlled ports execute; this is not whole-file refinement.
import {after as afterPartialContract} from 'node:test';
import partialContractAssert from 'node:assert/strict';
import {fileURLToPath as partialContractFile} from 'node:url';
import {captureReplayClosure as capturePartialClosure} from '../specs/quint/refinement/observed-replay.mjs';
import {captureInputs as capturePartialInputs} from '../specs/quint/refinement/check-traces.mjs';
const partialContractInputs = capturePartialClosure([partialContractFile(import.meta.url)]);
afterPartialContract(() => partialContractAssert.deepEqual(capturePartialInputs(Object.keys(partialContractInputs)), partialContractInputs));

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {modelTraces, replay} from '../specs/quint/refinement/application/shell-model-traces.mjs';
import {shellCore} from '../specs/quint/refinement/application/shell-core-fixture.mjs';

// FixtureBusyLatch traces from the simulator, replayed on the shell's own view switching (leave,
// openView, goHome), its per-view timer groups and the leave handlers of the Workflows and Browser
// fixtures, taken from the source with latchPatch. The timed work itself is stood in for by one
// timer per step, armed through the view api the fixtures use.
const model = readFileSync('apps/app/src/prototype/model.js', 'utf8');
const line = text => { const at = model.indexOf(text); assert.ok(at >= 0, text); return model.slice(at, model.indexOf('\n', at)).replace(/,\s*$/, ''); };
const latch = model.slice(model.indexOf('\nfunction latchPatch('), model.indexOf('\n}', model.indexOf('\nfunction latchPatch(')) + 2);
assert.match(latch, /function latchPatch\(st, keys\)/);
const leaveHandlers = `${latch}
globalThis.plainLeave = ({ ${line('onLeave: function (api) { var p = latchPatch(api && api.st, ["running"]);')} }).onLeave;
globalThis.confirmingLeave = ({ ${line('onLeave: function (api) { var st = (api && api.st) || {}; var p = st.confirm ? null')} }).onLeave;`;
const STEP = 500;

test("partial source contract: simulated FixtureBusyLatch traces agree with the shell and the fixture leave handlers after every step", {timeout: 120000}, async () => {
  const traces = modelTraces({module: 'FixtureBusyLatch', traces: 150, steps: 30});
  const result = await replay(traces, {
    start() {
      const views = {plain: {state: {running: null}}, confirming: {state: {ag: null, confirm: null}}};
      const core = shellCore({views});
      core.run(leaveHandlers);
      views.plain.onLeave = core.context.plainLeave;
      views.confirming.onLeave = core.context.confirmingLeave;
      const shell = new core.Shell({});
      shell.preset('home');
      const timer = view => [...core.timers].find(([id]) => (shell.G[`m_${view}`] || []).includes(id));
      return {
        apply({action, picks}, before) {
          const front = before.front, api = front && shell.api(front);
          if (action === 'open') shell.openView(picks.view, picks.yes ? {keepState: true} : undefined);
          else if (action === 'home') shell.goHome();
          else if (action === 'start' && front === 'plain') { api.set({running: {i: 0}}); api.later(() => shell.vset('plain', {running: null}), STEP); }
          else if (action === 'start') { api.set({ag: {task: 'book'}, confirm: null}); api.later(() => shell.vset('confirming', {confirm: {party: 2}}), STEP); }
          else if (action === 'timer') { const [id, pending] = timer(picks.view); core.timers.delete(id); pending.run(); }
          else if (action === 'answer' && picks.yes) { api.set({confirm: null}); api.later(() => shell.vset('confirming', {ag: null}), STEP); }
          else if (action === 'answer') api.set({confirm: null, ag: null});
          else assert.fail(`unmapped action ${action}`);
        },
        observe() {
          const marked = [...(shell.vget('plain').running ? ['plain'] : []), ...(shell.vget('confirming').ag ? ['confirming'] : [])];
          return {front: shell.S().view || '', marked: marked.sort(), armed: core.armed(shell).filter(group => group.startsWith('m_')).map(group => group.slice(2)),
            confirming: !!shell.vget('confirming').confirm};
        },
      };
    },
    project: s => ({front: s.front, marked: [...s.marked].sort(), armed: [...s.armed].sort(), confirming: s.confirming}),
  });
  assert.deepEqual([...result.exercised].sort(), ['answer', 'home', 'open', 'start', 'timer']);
});

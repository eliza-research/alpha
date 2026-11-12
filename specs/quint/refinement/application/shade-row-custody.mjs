import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {notice, shadeRowCustodyFixture, shadeRowCustodySources} from '../../../../test/fixtures/shade-row-custody.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';

const model = 'ShadeRowCustody';
const modelPath = 'specs/quint/application/ShadeRowCustody.qnt';
const a = notice('a'), revisedA = notice('a', '2'), b = notice('b', '1', 'external');
const ongoing = notice('c', '1', 'hosted', false, false);
const emptyKey = {id: '', revision: '', source: ''};
const row = ({id, revision, source, canOpen, clearable}) => ({id, revision, source, canOpen, clearable});
const selection = selected => {
  if (!selected) return emptyKey;
  const {id, revision, source} = selected;
  return {id, revision, source};
};
const diagnostics = new Map([
  ['Changed', 'action-error'],
  ['Updated', 'some-changed'],
  ['No action', 'no-action'],
  ['Ongoing', 'ongoing'],
  ['Alerts didn’t load', 'calendar-error'],
  ['Unavailable', 'list-error'],
]);
const fields = ({toasts, ...state}) => {
  const adapted = {...state, selection: selection(state.selection), renderedSelection: selection(state.renderedSelection),
    toasts: toasts.map(message => {assert.ok(diagnostics.has(message), message); return diagnostics.get(message);})};
  return Object.fromEntries(Object.entries(adapted).map(([name, value]) => ['s.' + name, value]));
};

export async function checkShadeRowCustody(extraSources = []) {
  const sources = [fileURLToPath(import.meta.url), ...shadeRowCustodySources, ...extraSources];
  const driverHashes = captureInputs([modelPath, ...sources]);
  const traces = [];
  async function scenario(name, schedule) {
    const f = shadeRowCustodyFixture();
    const t = {name, init: {name: 'init', args: []}, expect: fields(f.observe()), steps: []};
    const mark = (action, ...args) => t.steps.push({label: action, action: {name: action, args}, expect: fields(f.observe())});
    await schedule({
      async poll() {await f.poll(); mark('poll');},
      async finish(items, status = 'ok') {
        assert.equal(f.requests.filter(request => request.pending).length, 1);
        await f.finishPoll(f.requests.findIndex(request => request.pending) + 1, items, status);
        mark('finishPoll', items.map(row), status);
      },
      capture(slot) {f.capture(slot); mark('capture', slot);},
      async act(slot, kind, id = '') {await f.act(slot, kind, id); mark('act', slot, kind, id);},
      async settle(id, status = 'ok') {await f.finishOperation(id, status); mark('finishOperation', id, status);},
      shade(open) {f.set({shade: open}); mark('setShade', open);},
      screen(screen) {f.set({screen}); mark('setScreen', screen);},
      async visibility(hidden) {await f.visibility(hidden); mark('visibility', hidden);},
      async device() {await f.deviceState(); mark('deviceState');},
      unmount() {f.unmount(); mark('unmount');},
    });
    traces.push(t);
  }
  const load = async (c, rows = [a]) => {await c.poll(); await c.finish(rows); c.capture(1);};
  await scenario('A coalesced poll retires when its shade closes and reopens', async c => {
    await load(c); await c.poll(); await c.poll(); c.shade(false); c.shade(true);
    await c.finish([b]); await c.poll(); await c.finish([b]);
  });
  await scenario('A revised row rejects a retained open swipe select and clear', async c => {
    await load(c); await c.poll(); await c.finish([revisedA]);
    await c.act(1, 'open', 'a'); await c.act(1, 'dismiss', 'a'); await c.act(1, 'select', 'a'); await c.act(1, 'clear');
    c.capture(2); await c.act(2, 'open', 'a'); await c.settle(1); await c.finish([revisedA]);
  });
  await scenario('A newly arrived eligible notice cannot join an earlier Clear All', async c => {
    await load(c); await c.poll(); await c.finish([a, b, ongoing]); await c.act(1, 'clear');
    c.capture(2); await c.act(2, 'clear'); await c.settle(1, 'unavailable'); await c.finish([ongoing]);
  });
  await scenario('Own context selection is dropped when the exact revision changes', async c => {
    await load(c); await c.act(1, 'select', 'a'); await c.poll(); await c.finish([revisedA]);
  });
  await scenario('External press clears own selection and a rejected dismiss reports once', async c => {
    await load(c, [a, b, ongoing]); await c.act(1, 'select', 'a'); await c.act(1, 'dismiss', 'b');
    await c.settle(1, 'error'); await c.finish([a, b, ongoing]);
    await c.act(1, 'open', 'c'); await c.act(1, 'dismiss', 'c');
  });
  await scenario('A locked screen retires both old controls and the held poll', async c => {
    await load(c); await c.poll(); c.screen('lock'); await c.act(1, 'open', 'a'); await c.poll();
    c.screen('home'); await c.act(1, 'dismiss', 'a'); await c.finish([b], 'error');
    c.capture(2); await c.act(2, 'open', 'a'); await c.settle(1); await c.finish([a]);
  });
  await scenario('Retired clear and open results cannot report or refresh a successor visit', async c => {
    await load(c); await c.act(1, 'open', 'a'); await c.act(1, 'clear');
    c.shade(false); c.shade(true); await c.settle(1, 'error'); await c.settle(2, 'unavailable');
  });
  await scenario('Hidden, resumed, and device reset states retire exact row callbacks', async c => {
    await load(c); await c.act(1, 'select', 'a'); await c.visibility(true); await c.act(1, 'open', 'a');
    await c.visibility(false); await c.finish([a]); await c.act(1, 'clear'); c.capture(2);
    await c.poll(); await c.device(); await c.finish([b]); await c.act(2, 'open', 'a');
  });
  await scenario('List diagnostics deduplicate and recover under a current visit', async c => {
    await load(c); await c.poll(); await c.finish([a], 'error'); await c.poll(); await c.finish([a], 'error');
    await c.poll(); await c.finish([a], 'unavailable'); await c.poll(); await c.finish([a], 'unavailable');
    await c.poll(); await c.finish([a]); await c.poll(); await c.finish([a], 'unavailable');
  });
  await scenario('Unmount prevents a held read and mutation from reporting', async c => {
    await load(c); await c.act(1, 'dismiss', 'a'); await c.poll(); c.unmount();
    await c.finish([b], 'unavailable'); await c.settle(1, 'error'); await c.act(1, 'open', 'a');
  });
  return checkTraces({model, modelPath, sources, driverHashes, traces, scope: 'bounded-orchestration',
    assumptions: ['The real installed renderer adapter, interval callback, lifecycle hooks and rendered row callbacks run in a closed VM. Notification bridge operations only record synthetic keys.',
      'Two representative own/external rows, one non-clearable hosted row, three retained control slots, one coalesced poll and bounded concurrent action completions.',
      'The shell fixture commits synchronously. Real gesture geometry, pointer ownership, native notification delivery and question dialog behavior are separate boundaries.']});
}

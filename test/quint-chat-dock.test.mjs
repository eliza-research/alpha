import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {modelTraces} from '../specs/quint/refinement/application/shell-model-traces.mjs';

// ChatDock traces from the simulator, checked at every settled drag against the release
// decision the gesture adapter calls (chatRelease). Only that decision is replayed here: the
// pointer capture, the suppression window and the late click run in a browser
// (test/browser/full-chat-grabber.spec.ts) and are not shown by this test.
const source = readFileSync('apps/app/src/prototype/chat-overlay-motion-adapter.ts', 'utf8');
const region = source.slice(source.indexOf('// chat-release:begin'), source.indexOf('// chat-release:end'));
assert.ok(region.length > 200);
const {chatRelease} = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(region, {mode: 'strip'})).toString('base64'));
// The detent the shell takes from the decision, as the adapter's release writes it.
assert.match(source, /chat: next\.chat === "hidden" && !collapsed \? this\.rest\(\) : next\.chat,/);
// A roomy screen, where the snap zone is its fixed size, and a short one, where it is a third of the travel.
const SCREENS = [{floor: 90, full: 915, heights: {floor: 150, middle: 500, top: 860}}, {floor: 90, full: 390, heights: {floor: 150, middle: 240, top: 330}}];
const rest = view => view === 'pillView' ? 'hidden' : 'input';

test('every settled drag in simulated ChatDock traces takes the detent chatRelease decides', {timeout: 120000}, () => {
  const traces = modelTraces({module: 'ChatDock', traces: 500, steps: 60});
  const seen = new Set();
  for (const trace of traces) for (let at = 1; at < trace.length; at++) {
    const step = trace[at], before = trace[at - 1].state;
    if (step.action !== 'settle') continue;
    const {direction, zone, flick} = step.picks, mode = before.drag.mode, collapsed = mode === 'input' || mode === 'hidden';
    for (const screen of SCREENS) {
      const next = chatRelease({mode, direction, height: screen.heights[zone], floor: screen.floor, full: screen.full, flick});
      const label = `${mode} ${direction} ${zone} ${flick ? 'flick' : 'release'}`;
      assert.equal(step.state.chat, next.chat === 'hidden' && !collapsed ? rest(before.view) : next.chat, label);
      // A released height is remembered; a snap or a flick leaves the remembered height alone.
      assert.equal(step.state.remembered, before.remembered || next.height !== undefined, label);
      seen.add(label);
    }
  }
  // The campaign settles drags from every detent, in both directions, in every zone, flicked and not.
  // It does not reach all 48 combinations; chatRelease's own cases are in test/chat-release.test.mjs.
  for (const word of ['hidden', 'input', 'sheet', 'full', 'up', 'down', 'floor', 'middle', 'top', 'flick', 'release'])
    assert.ok([...seen].some(label => label.split(' ').includes(word)), word);
  assert.ok(seen.size >= 24, `${seen.size} distinct releases`);
});

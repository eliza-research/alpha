import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap} from '../specs/quint/refinement/check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, trace} from '../specs/quint/refinement/application/support.mjs';
import {buildCalendarDraftFixture, calendarDraftFixture} from './fixtures/canonical-calendar-draft-owner.mjs';

const driver = fileURLToPath(import.meta.url);
const owners = ['A', 'B'];
const emptyWrite = {kind: '', lease: 0, draft: {owner: '', title: ''}};
function observe(fixture) {
  const o = fixture.observe(), reads = new Map(o.reads), writes = new Map(o.writes);
  return {
    's.live': o.live, 's.owner': o.owner, 's.bound': o.bound, 's.lease': o.lease, 's.sequence': o.sequence,
    's.form': o.formDraft, 's.text': o.text, 's.suppressed': o.suppressed,
    's.slots': qmap(owners.map(owner => [owner, {present: fixture.raw(owner) !== null, draft: fixture.saved(owner)}])),
    's.reads': qmap(owners.map(owner => [owner, reads.get(owner) ?? 0])),
    's.writes': qmap(owners.map(owner => [owner, writes.get(owner) ?? emptyWrite])),
    's.opening': o.opening, 's.foreign': o.foreign, 's.error': o.error, 's.conflict': o.conflict, 's.savedText': o.savedText,
    's.consuming': o.consuming,
    's.recoveryOpen': o.recoveryOpen, 's.remembered': o.remembered, 's.notices': o.notices,
    renderedForm: o.renderedForm, resumeOffered: o.resumeOffered, busy: o.busy, recovery: o.recovery, storageError: o.storageError,
  };
}
const a = ['bind', 'A', false], b = ['bind', 'B', false], disconnect = ['bind', '', false];
const readA = ['bind', 'A', true], close = ['closeForm'], releaseA = ['releaseRead', 'A'];
const first = ['edit', 'First A', false], nextA = ['edit', 'New A', false], currentB = ['edit', 'Current B', false];
const seedA = ['seed', 'A', 'A', 'Saved A'], seedB = ['seed', 'B', 'B', 'Saved B'];
const cases = [
  ['lost-owner-hides-form-before-binding-update', [a, first, ['setOwner', ''], ['synchronize'], b, ['commitForeign', 'A'], a, ['resume']]],
  ['different-owner-keeps-original-draft', [a, first, b, currentB, ['commitForeign', 'A'], a, ['resume']]],
  ['old-read-cannot-fill-new-account', [seedA, seedB, readA, b, releaseA, ['resume']]],
  ['older-read-same-key-cannot-replace-newer-edit', [seedA, readA, b, a, nextA, releaseA]],
  ['read-finishes-during-identity-change-before-update', [seedA, readA, ['setOwner', 'B'], releaseA, ['synchronize']]],
  ['held-edit-stays-in-original-slot', [a, ['edit', 'First A', true], b, currentB, ['releaseWrite', 'A']]],
  ['held-edit-completes-after-its-host-unmounts', [a, ['edit', 'First A', true], ['retire'], ['releaseWrite', 'A']]],
  ['old-held-clear-undoes-only-its-own-slot', [a, first, close, ['commit', true], b, currentB, ['releaseWrite', 'A']]],
  ['old-held-clear-after-same-account-return-is-stale', [a, first, close, ['commit', true], b, a, ['releaseWrite', 'A']]],
  ['clear-before-binding-update-leaves-same-slot-in-review', [a, first, close, ['commit', true], ['setOwner', 'B'],
    ['releaseWrite', 'A'], ['setOwner', 'A'], ['restoreSaved']]],
  ['current-held-discard-clears-retained-copy', [a, first, close, ['discard', true], ['releaseWrite', 'A']]],
  ['foreign-existing-row-is-kept-without-recovery-or-resume', [['seed', 'B', 'A', 'Saved A'], b, ['failRead'], ['openRecovery']]],
  ['captured-discard-cannot-retarget-reopened-owner', [a, first, close, ['remember'], b, a, nextA, close,
    ['useRemembered'], ['discard', false]]],
  ['captured-discard-works-for-its-current-lifetime', [a, first, close, ['remember'], ['useRemembered']]],
  ['successful-commit-leaves-no-resumable-form', [a, first, close, ['commit', false], disconnect, a]],
  ['current-recovery-is-aborted-on-identity-change', [a, first, close, ['openRecovery'], b, ['openRecovery'], ['retire']]],
  ['late-read-after-retirement-restores-nothing', [seedA, readA, ['retire'], releaseA]],
];

async function drive(fixture, operation, args) {
  if (operation === 'bind') {
    if (args[1]) fixture.holdRead(args[0]);
    await fixture.bind(args[0]);
  } else if (operation === 'edit') {
    const owner = fixture.observe().owner;
    if (args[1]) fixture.holdWrite(owner);
    await fixture.edit(owner, args[0]);
  } else if (operation === 'commit' || operation === 'discard') {
    if (args[0]) fixture.holdWrite(fixture.observe().owner);
    if (operation === 'commit') await fixture.commitRetained();
    else await fixture.discard();
  } else if (operation === 'synchronize') {
    fixture.update();
    await fixture.settle();
  } else if (operation === 'failRead') await fixture.awaitReadFailure();
  else if (operation === 'retire') await fixture.close();
  else await fixture[operation](...args);
}

async function checkCanonicalCalendarDraft(extraSources = []) {
  const compiled = await buildCalendarDraftFixture(), traces = [];
  const sources = [...compiled.sources, driver, ...extraSources];
  captureSources(sources);
  for (const [name, steps] of cases) {
    const fixture = calendarDraftFixture(compiled), t = trace(name, observe(fixture));
    try {
      for (const [operation, ...args] of steps) {
        await drive(fixture, operation, args);
        checkpoint(t, [operation, ...args].join(' '), call(operation, ...args), observe(fixture));
      }
      traces.push(t);
    } finally {await fixture.close();}
  }
  return checkTraces(boundInputs({model: 'CanonicalCalendarDraft', sources, traces, scope: 'bounded-orchestration', assumptions: [
    'Actual Alpha canonical Calendar adapter, current form codec, shared DurableDraftController and exact compareExchangeDraftStore execute with controlled owner, clock, raw-slot and recovery ports.',
    'Two owners and six binding lifetimes are bounded, with at most one held read and write per owner. Lifetime labels come from the actual opaque binding token, pending job fields from the raw CAS request, and displayed form and actions from the real renderer adapter.',
    'Draft contents use fixed synthetic titles. No remote event dispatch, reminder destination conversion, arbitrary invalid fields, platform persistence or actual recovery export executes. Atomic raw CAS uses captured bytes, while revisions and the old clear undo are abstracted to final slot contents.',
  ]}));
}

test('canonical Calendar draft ownership matches actual editor and durable-store transitions', {timeout: scaledTimeout(120000)}, async () => {
  const receipt = await checkCanonicalCalendarDraft([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 17);
  assert.equal(receipt.checkpoints, 121);
});

import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces, qset} from '../specs/quint/refinement/check-traces.mjs';
import {captureSources, boundInputs, trace, checkpoint, call, tick} from '../specs/quint/refinement/application/support.mjs';
import {compileCanonicalNotesEditor, createCanonicalNotesEditorFixture} from '../specs/quint/refinement/application/canonical-notes-draft.mjs';

const driver = fileURLToPath(import.meta.url);
const idOf = id => !id ? 0 : id === 'note-one' ? 1 : id === 'note-two' ? 2 : assert.fail('Unknown canonical identity');
const wireId = id => id === 1 ? 'note-one' : 'note-two';
const note = (id, title = 'Note 1', body = 'Body') => ({id: wireId(id), title, body, color: 'yellow',
  createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z'});
const state = (revision, notes = [1], trash = [2], changed = {}) => ({revision,
  notes: notes.map(id => changed[id] ?? note(id)),
  trash: trash.map(id => ({note: changed[id] ?? note(id), deletedAt: '2026-11-08T00:00:00Z'}))});

async function fixture(module) {
  const f = await createCanonicalNotesEditorFixture(module);
  f.refresh(); await f.replyWith(f.requests.at(-1).id, {success: true, data: state(1)});
  let mutation = {kind: 'none', id: 0, token: 0, phase: 'idle'}, probe = 'none';
  const mutations = [];
  function start(kind, id) {
    mutation = {kind, id, token: kind === 'delete' ? f.tokenOf(f.editor.draft?.token) : 0, phase: 'waiting'};
    const captured = mutation;
    const result = f.editor[kind === 'delete' ? 'remove' : 'restore'](wireId(id));
    const promise = result.then(value => {captured.phase = value ? 'true' : 'false'; return value;});
    mutations.push(promise); return promise;
  }
  const writing = () => f.controller.pending ? f.requests.findLast(request => request.method === 'POST' && !request.settled) : null;
  function observe() {
    const original = f.observe(), draft = original['s.draft'], captured = original['s.captured'];
    const request = writing(), capability = request?.body.capability;
    const kind = capability === 'delete-note' ? 'delete' : capability === 'restore-note' ? 'restore' : request ? 'save' : 'none';
    const write = kind === 'none' ? {kind, id: 0, token: 0, version: 0, expectedRevision: -1}
      : {kind, id: kind === 'save' ? captured.id : idOf(request.body.params.id),
        token: kind === 'save' ? captured.token : 0, version: kind === 'save' ? captured.version : 0,
        expectedRevision: kind === 'save' ? captured.base : request.body.params.expectedRevision ?? -1};
    const phase = mutation.phase === 'waiting' ? kind : mutation.phase;
    assert.notEqual(phase, 'none', 'A waiting mutation has a source request after settling promise jobs');
    return {'s.current': f.controller.current, 's.revision': f.controller.revision ?? -1,
      's.notes': qset((f.controller.snapshot?.notes ?? []).map(value => idOf(value.id))),
      's.trash': qset((f.controller.snapshot?.trash ?? []).map(value => idOf(value.note.id))),
      's.authored': qset([...(f.controller.snapshot?.notes ?? []), ...(f.controller.snapshot?.trash ?? []).map(value => value.note)]
        .filter(value => module.exports.reconstructNoteContent(module.exports.projectNoteForModel(value)).trim() ||
          module.exports.authoredNoteText(value.format).trim()).map(value => idOf(value.id))),
      's.draft': {present: draft.present, id: draft.id, token: draft.token, base: draft.base, version: draft.version,
        authored: original.HasAuthoredContent}, 's.nextToken': original['s.nextToken'],
      's.saving': f.editor.saving, 's.queued': f.editor.queuedVersion ?? -1,
      's.write': write, 's.mutation': {...mutation, phase}, 's.review': original['s.review'], 's.probe': probe};
  }
  async function reply(revision, notes, trash, target, success = true, options = {}) {
    const request = writing(); assert.ok(request, 'An actual source write is pending');
    if (!success) {await f.reply(request.id, revision, [], false); return;}
    const snapshot = state(revision, notes, trash, options.changed);
    const targetNote = options.mismatched ? note(target === 1 ? 2 : 1)
      : (snapshot.notes.find(value => value.id === wireId(target)) ?? snapshot.trash.find(value => value.note.id === wireId(target))?.note);
    assert.ok(targetNote, 'Target fixture has a record');
    await f.replyWith(request.id, {requestId: 'mutation-result', success: true,
      result: {success: true, text: 'Confirmed', state: snapshot, ...(options.missing ? {} : {data: {note: targetNote}})}});
  }
  async function snapshot(revision, notes, trash, changed = {}) {
    f.refresh(); await f.replyWith(f.requests.at(-1).id, {success: true, data: state(revision, notes, trash, changed)});
  }
  async function probeCall(kind, id) {
    const value = await f.editor[kind === 'delete' ? 'remove' : 'restore'](wireId(id));
    assert.equal(value, false); probe = 'false'; await tick();
  }
  return {...f, observe, start, reply, snapshot, probe: probeCall, mutations};
}

async function checkCanonicalNotesMutation(extraSources = []) {
  captureSources([driver, ...extraSources]);
  const module = await compileCanonicalNotesEditor(extraSources), traces = [];
  const scenarios = ['delete-empty-canonical', 'delete-empty-save-result', 'delete-clean', 'delete-edit-held', 'delete-replace-held', 'delete-failure', 'delete-missing',
    'delete-dirty', 'delete-dirty-failure', 'delete-dirty-replaced', 'delete-dirty-closed', 'delete-dirty-new-edit',
    'delete-dirty-queued', 'delete-dirty-queued-clear', 'delete-dirty-empty', 'delete-dirty-stale',
    'delete-dirty-target-missing', 'delete-owner-save', 'delete-owner-write', 'delete-save-already-pending',
    'delete-codec-target', 'delete-codec-missing', 'delete-stale-reply', 'delete-valid-unchanged-membership',
    'restore', 'restore-missing', 'restore-failure', 'restore-owner', 'restore-edit-held', 'restore-current-revision',
    'restore-codec-target', 'probe-delete-delete', 'probe-delete-restore', 'probe-restore-delete',
    'probe-restore-restore', 'save-during-delete', 'save-during-restore'];
  for (const scenario of scenarios) {
    const f = await fixture(module), t = trace(scenario, f.observe());
    const step = (label, action) => checkpoint(t, label, action, f.observe());
    const open = id => {f.editor.open(wireId(id)); step('open source editor', call('open', id));};
    const edit = authored => {f.editor.edit({title: authored ? 'First' : '', body: authored ? 'Body' : ''}); step('edit source draft', call('edit', authored));};
    try {
      const restore = scenario.startsWith('restore') || scenario.startsWith('probe-restore') || scenario === 'save-during-restore';
      if (restore) {
        if (scenario === 'restore-current-revision') {await f.snapshot(3, [1], [2]); step('new collection before restore', call('snapshot', 3, qset([1]), qset([2]), qset([1, 2])));}
        if (scenario === 'restore-edit-held') {open(1); edit(true);}
        const target = scenario === 'restore-missing' ? 1 : 2;
        f.start('restore', target); await tick(); step('request restore', call('restore', target));
        if (scenario === 'restore-missing') {traces.push(t); continue;}
        if (scenario === 'restore-owner') {f.loseOwner(); step('lose owner before reply', call('loseOwner'));}
        if (scenario.startsWith('probe-')) {const kind = scenario.endsWith('delete') ? 'delete' : 'restore';
          await f.probe(kind, kind === 'delete' ? 1 : 2); step('second source command refused', call('probe', kind, kind === 'delete' ? 1 : 2));}
        if (scenario === 'save-during-restore') {open(1); edit(true); f.save(); await tick(); step('save rejected by existing writer', call('save'));}
        const bad = ['restore-failure', 'restore-owner', 'restore-codec-target'].includes(scenario);
        await f.reply(scenario === 'restore-current-revision' ? 4 : 2, [1, 2], [], 2, scenario !== 'restore-failure', {mismatched: scenario === 'restore-codec-target'});
        step('restore settles', bad ? call('failed') : call('mutationReply', scenario === 'restore-current-revision' ? 4 : 2, qset([1, 2]), qset([]), qset([1, 2])));
      } else {
        if (scenario === 'delete-empty-canonical') {await f.snapshot(1, [1], [2], {1: note(1, '', '')});
          step('empty canonical record is still deletable', call('snapshot', 1, qset([1]), qset([2]), qset([2])));}
        const dirty = scenario.startsWith('delete-dirty') || ['delete-owner-save', 'delete-empty-save-result'].includes(scenario);
        const opening = dirty || ['delete-clean', 'delete-empty-canonical', 'delete-edit-held', 'delete-replace-held', 'delete-save-already-pending'].includes(scenario);
        if (opening) open(1);
        if (dirty || scenario === 'delete-save-already-pending') edit(scenario !== 'delete-dirty-empty');
        if (scenario === 'delete-dirty-stale') {await f.snapshot(2, [1], [2]); step('external revision before removal', call('snapshot', 2, qset([1]), qset([2]), qset([1, 2])));}
        if (scenario === 'delete-save-already-pending') {f.save(); await tick(); step('save precedes removal', call('save'));}
        const target = scenario === 'delete-missing' ? 2 : 1;
        f.start('delete', target); await tick(); step('request removal', call('remove', target));
        if (['delete-missing', 'delete-dirty-empty', 'delete-dirty-stale'].includes(scenario)) {traces.push(t); continue;}
        if (dirty) {
          if (['delete-dirty-replaced', 'delete-dirty-closed'].includes(scenario)) {f.editor.close(); step('close captured draft', call('close'));}
          if (scenario === 'delete-dirty-replaced') {f.editor.begin(); step('replace captured draft token', call('begin'));}
          if (['delete-dirty-new-edit', 'delete-dirty-queued', 'delete-dirty-queued-clear'].includes(scenario)) edit(scenario !== 'delete-dirty-queued-clear');
          if (['delete-dirty-queued', 'delete-dirty-queued-clear'].includes(scenario)) {f.save(); await tick(); step('queue newer draft version', call('save'));}
          if (scenario === 'delete-owner-save') {f.loseOwner(); step('lose owner during prerequisite save', call('loseOwner'));}
          const bad = ['delete-dirty-failure', 'delete-owner-save'].includes(scenario);
          const ids = scenario === 'delete-dirty-target-missing' ? [] : [1];
          const trash = scenario === 'delete-dirty-target-missing' ? [1, 2] : [2];
          await f.reply(2, ids, trash, 1, !bad, {changed: {1: scenario === 'delete-empty-save-result' ? note(1, '', '') : note(1, 'First')}});
          step('prerequisite save and removal continuation', bad ? call('failed') : call('saveReply', 1, 2, qset(ids), qset(trash), qset(scenario === 'delete-empty-save-result' ? [2] : [1, 2])));
          if (['delete-dirty-failure', 'delete-owner-save', 'delete-dirty-replaced', 'delete-dirty-closed', 'delete-dirty-target-missing', 'delete-dirty-queued-clear'].includes(scenario)) {traces.push(t); continue;}
          if (scenario === 'delete-dirty-queued') {
            await f.reply(3, [1], [2], 1, true, {changed: {1: note(1, 'First')}});
            step('newer save completes after refused deletion', call('saveReply', 1, 3, qset([1]), qset([2]), qset([1, 2]))); traces.push(t); continue;
          }
        }
        if (scenario === 'delete-save-already-pending') {
          await f.reply(2, [1], [2], 1, true, {changed: {1: note(1, 'First')}});
          step('pre-existing save completes without deleting', call('saveReply', 1, 2, qset([1]), qset([2]), qset([1, 2]))); traces.push(t); continue;
        }
        if (scenario === 'delete-edit-held') edit(true);
        if (scenario === 'delete-replace-held') {f.editor.begin(); step('replace selection during delete', call('begin'));}
        if (scenario === 'delete-owner-write') {f.loseOwner(); step('lose owner during delete', call('loseOwner'));}
        if (scenario.startsWith('probe-')) {const kind = scenario.endsWith('restore') ? 'restore' : 'delete';
          await f.probe(kind, kind === 'delete' ? 1 : 2); step('second source command refused', call('probe', kind, kind === 'delete' ? 1 : 2));}
        if (scenario === 'save-during-delete') {open(1); edit(true); f.save(); await tick(); step('save rejected by existing writer', call('save'));}
        const bad = ['delete-failure', 'delete-owner-write', 'delete-codec-target', 'delete-codec-missing', 'delete-stale-reply'].includes(scenario);
        const unchanged = scenario === 'delete-valid-unchanged-membership';
        const revision = scenario === 'delete-stale-reply' ? 0 : dirty ? 3 : 2;
        await f.reply(revision, unchanged ? [1] : [], unchanged ? [2] : [1, 2], 1, scenario !== 'delete-failure',
          {mismatched: scenario === 'delete-codec-target', missing: scenario === 'delete-codec-missing'});
        step('delete settles', bad ? call('failed') : call('mutationReply', revision, qset(unchanged ? [1] : []), qset(unchanged ? [2] : [1, 2]), qset([1, 2])));
      }
      traces.push(t);
    } finally {f.cleanup(); await tick();}
  }
  return checkTraces(boundInputs({model: 'CanonicalNotesMutation', sources: [...module.sources, driver], traces, scope: 'bounded-component', assumptions: [
    'Actual NotesEditor, CanonicalNotesController and wire codecs execute against deferred valid or deliberately invalid AppRecordPort replies. Existing editor compiler retains the actual captured save in a read-only WeakMap.',
    'One awaited remove/restore intent is modeled together with rejected concurrent probes and independently queued saves. Two notes, five draft tokens, four edits and revisions zero through four bound the campaign.',
    'Awaited save, delete continuation, controller finally and automatic queued save form one settled promise macrostep. Intermediate reentrant callbacks, multiple overlapping remove continuations and external invalidation reads remain separate obligations.',
    'Collection membership is returned input, including valid unchanged membership. The codec checks identity consistency, but these renderer traces do not prove provider deletion, restoration, revision allocation or durable storage semantics.'] }));
}

test('canonical Notes delete and restore preserve actual save and owner continuations', {timeout:scaledTimeout(180000)}, async () => {
  const receipt = await checkCanonicalNotesMutation([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 37);
  assert.equal(new Set(receipt.traceInputs.map(trace => trace.name)).size, 37);
  for (const name of ['delete-dirty-queued', 'delete-dirty-replaced', 'delete-owner-save', 'restore-current-revision',
    'delete-codec-target', 'delete-valid-unchanged-membership', 'save-during-restore']) {
    assert.ok(receipt.traceInputs.some(trace => trace.name === name), name);
  }
});

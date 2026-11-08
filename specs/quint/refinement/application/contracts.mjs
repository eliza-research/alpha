import assert from 'node:assert/strict';
import {checkTraces as check, qmap} from '../check-traces.mjs';
import {bundledSource, sourceModule, sourceContext, memoryStore, deferred, tick, trace, checkpoint, call, captureSources, boundInputs} from './support.mjs';
captureSources(['specs/quint/refinement/application/contracts.mjs']);
const checkTraces = options => check(boundInputs({...options, sources: [...options.sources,
  'specs/quint/refinement/application/contracts.mjs', 'specs/quint/refinement/application/support.mjs']}));

export async function notesLifecycle() {
  const storeModule = await bundledSource('apps/app/src/runtime/notes-store.ts');
  const trashModule = await bundledSource('apps/app/src/runtime/notes-trash-policy.ts');
  const {NotesStore, NOTES_KEY} = storeModule.exports;
  const policy = trashModule.exports;
  const traces = [];
  for (const restore of [false, true]) {
    const memory = memoryStore();
    let notes = new NotesStore(memory, [{id: 'note', kind: 'text', title: 'Note', body: 'original'}]);
    let trash = policy.emptyNotesTrash();
    const observe = () => ({'s.live': notes.list.length > 0, 's.trash': trash.entries.length > 0,
      's.trashContent': trash.entries[0]?.note.body || ''});
    const t = trace(`notes-delete-${restore ? 'restore' : 'expiry'}`, observe(), call('initLegacy'));
    const target = await notes.target('note');
    trash = policy.addNotesTrashEntry(trash, {id: 'deletion', note: notes.list[0], target, index: 0, deletedAt: 1000});
    checkpoint(t, 'write-ahead trash policy retains exact note', call('prepareTrash'), observe());
    await notes.execute({type: 'notes_delete', target}, 'deletion', new AbortController().signal, () => {});
    checkpoint(t, 'real store writes deletion tombstone', call('commitDeletion'), observe());
    notes = new NotesStore(memory); checkpoint(t, 'store reconstructs saved envelope', call('restart'), observe());
    if (restore) {
      notes.replace(policy.restoreNotesTrashEntry(notes.list, trash.entries[0]));
      trash = policy.removeNotesTrashEntries(trash, ['deletion']);
      checkpoint(t, 'restore exact saved note using source policy', call('restore'), {...observe(), 's.content': notes.list[0].body});
    } else {
      const now = 1000 + policy.NOTES_TRASH_RETENTION_MS;
      const plan = policy.planNotesTrash(trash, new Set(notes.list.map(note => note.id)), now);
      assert.equal(plan.expired.length, 1);
      trash = policy.removeNotesTrashEntries(trash, plan.expired.map(entry => entry.id));
      checkpoint(t, 'exact retention boundary expires trash', [call('age'), call('age'), call('age'), call('maintenance')], observe());
    }
    assert.ok(memory.getItem(NOTES_KEY)); traces.push(t);
  }
  {
    const {NotesController} = await sourceModule('.eliza/client-features/plugins/plugin-notes/src/client/notes-controller.ts');
    const {NotesEditor} = await sourceModule('.eliza/client-features/plugins/plugin-notes/src/client/notes-editor.ts');
    const reading = deferred(), writing = deferred();
    let phase = 'ready', content = 'original', revision = 0;
    const note = () => ({id: 'note', title: content, body: '', color: 'yellow', createdAt: '', updatedAt: ''});
    const snapshot = () => ({notes: [note()], revision});
    const client = {
      async readState() { await reading.promise; return snapshot(); },
      async interact(capability, params) {
        assert.equal(capability, 'update-note');
        assert.equal(params.expectedRevision, revision);
        await writing.promise; content = params.content; revision++;
        return {state: snapshot(), note: note(), target: {id: 'note', revision}};
      },
    };
    const controller = new NotesController(client, () => true, {phase: value => {phase = value;}, snapshot() {}});
    const editor = new NotesEditor(controller, {changed() {}, committed() {}, review() {}});
    const t = trace('canonical controller and editor own one exact revision', {'s.mode': 'canonical'}, call('initCanonical'));
    const readPending = controller.refresh(); await tick();
    checkpoint(t, 'canonical read enters the real controller', call('canonicalRefresh'), {'s.canonical.phase': phase});
    reading.resolve(); await readPending;
    checkpoint(t, 'source snapshot publishes its exact revision', call('canonicalReadResult', 0, 1, 0, true), {'s.canonical.revision': controller.revision, 's.canonical.phase': phase});
    editor.open('note');
    checkpoint(t, 'editor opens the observed note', call('canonicalOpen'), {'s.canonical.draft': editor.draft !== null, 's.canonical.text': editor.draft.title});
    editor.edit({title: '', body: 'edited'});
    checkpoint(t, 'actual editor increments the draft version', call('canonicalEdit'), {'s.canonical.version': editor.draft.version, 's.canonical.text': editor.draft.body});
    const saving = editor.save(); await tick();
    checkpoint(t, 'save dispatches through the canonical controller', call('canonicalSave'), {'s.canonical.writing': controller.pending, 's.canonical.phase': phase});
    writing.resolve(); assert.equal(await saving, true);
    checkpoint(t, 'confirmed source response advances one revision', call('canonicalSaveResult', 0, 1, true), {'s.canonical.revision': controller.revision, 's.canonical.content': controller.viewNote('note').title, 's.canonical.version': editor.draft.version, 's.canonical.phase': phase});
    controller.retire(); traces.push(t);
  }
  return checkTraces({model: 'NotesLifecycle', sources: [...storeModule.sources, ...trashModule.sources], traces, scope: 'bounded-component', assumptions: [
    'Actual legacy NotesStore/Trash policy and canonical NotesController/NotesEditor execute deletion, reconstruction, expiry and one revision-bound read/edit/save.',
    'Trash persistence is an in-memory port. Secure-store draft merge, write-ahead crash boundaries, storage failure and lock UI remain separate obligations.']});
}

export async function calendarPresentation() {
  const formModule = await bundledSource('apps/app/src/runtime/calendar-form-draft.ts');
  const form = {title: 'Meeting', notes: '', where: '', t: 12, d: 1, video: false, who: [], cal: 'alpha-reminders', repeat: 'none', alert: null, creationId: 'creation-one', off: 0};
  const anchor = new Date(2026, 10, 7), raw = formModule.exports.encodeCalendarForm(form, anchor);
  const restored = formModule.exports.decodeCalendarForm(raw, anchor).form;
  assert.equal(restored.creationId, form.creationId);
  assert.equal(restored.id, null);
  const f = trace('creation-draft-retains-identity', {'s.openEvent': 0});
  checkpoint(f, 'encode source creation draft', [call('newForm'), call('saveDraft')], {'s.durableDraft': !!raw, 's.creationId': restored.creationId === form.creationId ? 1 : 0});
  checkpoint(f, 'decode without selected provider event', call('restoreDraft'), {'s.openEvent': restored.id === null ? 0 : 1, 's.creationId': restored.creationId === form.creationId ? 1 : 0});
  return checkTraces({model: 'CalendarPresentation', sources: formModule.sources, traces: [f], scope: 'bounded-component', assumptions: [
    'Actual creation-draft encoding and decoding preserve their stable identity; no Calendar mutation runs.',
    'Calendar rendering, account-scoped sync-destination preferences, range-generation races, provider results and submitted-time snapshots require their own adapters. The previous display-hiding preference was removed from the product.']});
}

export async function credentialVault() {
  const module = await bundledSource('apps/app/src/passwords/dev-vault.ts');
  const surface = sourceContext(['apps/app/src/passwords/password-manager.ts'], ['passwordSurfaceOpen']);
  const vault = module.exports.createDevelopmentVault(), traces = [];
  const observe = async () => ({'s.locked': (await vault.status()).locked});
  const t = trace('vault-unlock-expiry-and-relock', await observe());
  const active = surface.passwordSurfaceOpen({page: 'password-provider'});
  checkpoint(t, 'actual password surface admission', call('open'), {...await observe(), 's.active': active});
  await vault.unlock(); const entries = await vault.list();
  checkpoint(t, 'development vault metadata unlock', call('unlock'), {...await observe(), 's.entries': entries.entries.length > 0});
  vault.expire(); await assert.rejects(vault.list(), error => error.code === 'locked');
  checkpoint(t, 'source unlock window expires', call('lock'), await observe());
  await vault.unlock(); checkpoint(t, 'explicit fresh unlock', call('unlock'), await observe());
  await vault.lock(); checkpoint(t, 'explicit source lock', call('lock'), await observe()); traces.push(t);
  return checkTraces({model: 'CredentialVault', sources: [...module.sources, 'apps/app/src/passwords/password-manager.ts'], traces, scope: 'bounded-component', assumptions: [
    'The real in-memory development vault implements the metadata/unlock contract. Surface admission runs the actual predicate.',
    'Renderer secret clearing, native vault damage/reset, origin binding and Android authentication remain untested by this adapter.']});
}

export async function permissionWalkthrough() {
  const flow = await sourceModule('apps/app/src/startup-permission-flow.ts');
  const source = 'apps/app/src/startup-permission-progress.ts';
  const policy = await sourceModule(source);
  const store = memoryStore(), current = () => policy.readStartupPermissionProgress(store, true);
  const t = trace('seven-permission-progress-persistence', {'s.savedProgress': current().step});
  checkpoint(t, 'signed-in test fixture', call('signIn'), {'s.savedProgress': current().step});
  for (let index = 0; index < flow.nativeStartupPermissionKeys.length - 1; index++) {
    policy.writeStartupPermissionProgress(store, {version: 4, status: 'pending', step: index + 1}, true);
    checkpoint(t, 'write and read back next permission', [call('platformStatus', index, true), call('advance')], {'s.savedProgress': current().step});
  }
  policy.writeStartupPermissionProgress(store, {version: 4, status: 'completed', step: flow.nativeStartupPermissionKeys.length}, true);
  checkpoint(t, 'completed record after all native platform grants', [call('platformStatus', flow.nativeStartupPermissionKeys.length - 1, true), call('advance'), call('finish')], {'s.savedProgress': current().step, 's.completed': current().status === 'completed'});
  const replay = new Map(store.values); store.values.clear(); for (const [key, value] of replay) store.values.set(key, value);
  checkpoint(t, 'new reader sees durable completion', call('restart'), {'s.savedProgress': current().step, 's.completed': current().status === 'completed'});
  return checkTraces({model: 'PermissionWalkthrough', sources: [source, 'apps/app/src/startup-permission-flow.ts'], traces: [t], scope: 'bounded-component', assumptions: [
    'Checks actual seven-step marker read/write validation and persistence. Platform grants are controlled fixture inputs.',
    'This is a progress-store projection; component allow/advance/finish gating, cancellation and pending prompt races need a React adapter.']});
}

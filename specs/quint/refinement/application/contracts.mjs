import assert from 'node:assert/strict';
import {runStartupPermissionsCoordinatorRefinement} from './startup-permissions-coordinator.mjs';
import {checkTraces as check} from '../check-traces.mjs';
import {bundledSource, sourceContext, memoryStore, trace, checkpoint, call, captureSources, boundInputs} from './support.mjs';
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
    const t = trace(`notes-delete-${restore ? 'restore' : 'expiry'}`, observe());
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
  return checkTraces({model: 'NotesLifecycle', sources: [...storeModule.sources, ...trashModule.sources], traces, scope: 'bounded-component', assumptions: [
    'Actual NotesStore mutations and product Trash policy execute for deletion, reconstruction, restore and exact retention expiry.',
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
    'Actual current creation-draft encoder/decoder are checked. IDs use stable equality classes.',
    'Current main has one merged agent feed and retired the old per-account display visibility preferences. Those legacy model fields/actions are unrefined. Calendar rendering, range generations, provider results and submitted-time snapshots require the current renderer adapter.']});
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
  return (await runStartupPermissionsCoordinatorRefinement()).receipt;
}

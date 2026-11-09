import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {captureInputs, checkTraces, qmap} from '../check-traces.mjs';
import {call, checkpoint, deferred, read, sourceContext, tick, trace} from './support.mjs';

const model = 'PreviousNotesAvailability';
const adapter = 'apps/app/src/prototype/agent-adapter.ts';
const access = 'apps/app/src/prototype/legacy-notes-access.ts';

function fixture(device) {
  const input = read(adapter);
  const start = input.indexOf('  function previousNotesOwnerKey(');
  const end = input.indexOf('  async function previousNotesObservation(', start);
  assert.ok(start >= 0 && end > start, 'Expected the installed Notes availability functions');
  const localStorage = {getItem: () => null};
  const raw = sourceContext([access], ['browserPreviousNotesAvailability', 'devicePreviousNotesAvailability'],
    {localStorage, LEGACY_NOTES_SOURCE_KEYS: ['closed-legacy'], SECURE_NOTES_SLOT: 'collection', SECURE_NOTES_DRAFT_SLOT: 'draft'});
  let owner = 'a', visible = false, cleared = 0, canonical = 0, paints = 0, draftReads = 0;
  const requests = [];
  const document = {hidden: false};
  const shell = {live: true, pageSuspended: false, notesSourceMode: 'canonical', notesSourceEpoch: 0,
    previousNotesProbeKey: null, S: () => ({view: visible ? 'notes' : 'home'}), setState: () => {paints++;}};
  const startProbe = signal => {
    const request = {id: requests.length + 1, signal};
    requests.push(request);
    const hold = phase => {
      if (phase === 'draft') draftReads++;
      request.read = {phase, ...deferred()};
      return request.read.promise;
    };
    return hold;
  };
  const scope = {
    document, AbortController, isAndroid: device, browserNotesPort: {}, secureConnectionStore: {},
    connectionController: {getSnapshot: () => ({session: {sessionId: owner}}), getAppRecordClient: () => null},
    canonicalNotesKey: () => null, notesRecovery: {abort() {}},
    syncCanonicalNotes: () => {assert.equal(cleared, canonical + 1); canonical++;},
    originalSet(key, patch) {
      assert.equal(key, 'notes');
      assert.equal(patch.open, null);
      assert.deepEqual([...patch.list, ...patch.trash], []);
      assert.equal(patch.trashOpen, false);
      cleared++;
    },
    browserPreviousNotesAvailability(_port, signal, current) {
      const hold = startProbe(signal);
      return raw.browserPreviousNotesAvailability({read: () => hold('browser')}, signal, current);
    },
    devicePreviousNotesAvailability(_port, signal, current) {
      const hold = startProbe(signal);
      return raw.devicePreviousNotesAvailability({readRaw: phase => hold(phase)}, signal, current);
    },
  };
  vm.runInNewContext(stripTypeScriptTypes(input.slice(start, end), {mode: 'strip'}), scope);
  const sync = () => scope.syncPreviousNotesAvailability(shell);
  const keyOwner = serialized => JSON.parse(serialized)[0].sessionId;
  return {
    mark() {
      const key = shell.previousNotesProbeKey && JSON.parse(shell.previousNotesProbeKey);
      return {'s.device': device, 's.visible': visible, 's.hidden': document.hidden, 's.suspended': shell.pageSuspended,
        's.owner': owner, 's.mode': shell.notesSourceMode, 's.epoch': shell.notesSourceEpoch,
        's.legacyOwner': shell.notesSourceMode === 'legacy' ? keyOwner(shell.notesLegacyOwnerKey) : '',
        's.probeOwner': key ? keyOwner(key[0]) : '', 's.probeEpoch': key?.[1] ?? -1,
        's.active': requests.find(r => !r.signal.aborted)?.id ?? 0, 's.started': requests.length,
        's.pending': qmap(requests.filter(r => r.read).map(r => [r.id, r.read.phase])),
        's.draftReads': draftReads, 's.availability': shell.previousNotesAvailability ?? 'none',
        's.paints': paints, 's.cleared': cleared, 's.canonical': canonical};
    },
    move(value) {visible = value; sync();},
    hide(value) {document.hidden = value; sync();},
    suspend(value) {shell.pageSuspended = value; sync();},
    changeOwner(value) {owner = value; sync();},
    enterLegacy() {
      shell.notesSourceMode = 'legacy';
      shell.notesLegacyOwnerKey = scope.previousNotesOwnerKey();
      shell.notesStore = {raw: 'closed retained source'};
      shell.notesRaw = shell.notesStore.raw;
      shell.notesOpenAbort = new AbortController();
      sync();
    },
    resolve(id, result) {
      const request = requests[id - 1], held = request.read;
      request.read = null;
      if (result === 'unavailable') held.reject(Error('synthetic storage unavailable'));
      else held.resolve(result === 'absent' ? null : 'synthetic retained bytes');
      if (shell.notesSourceMode === 'canonical' && shell.notesOpenAbort?.signal.aborted) {
        assert.equal(shell.notesStore, null);
        assert.equal(shell.notesRaw, null);
      }
    },
  };
}

export async function checkPreviousNotesAvailability(extraSources = []) {
  const sources = [...new Set([adapter, access, fileURLToPath(import.meta.url),
    fileURLToPath(new URL('./support.mjs', import.meta.url)),
    fileURLToPath(new URL('../../../../test/support/strip-types.mjs', import.meta.url)), ...extraSources])];
  const driverHashes = captureInputs(sources);
  const traces = [];
  async function scenario(name, device, actions) {
    const f = fixture(device);
    const t = trace(name, f.mark(), call(device ? 'initDevice' : 'initBrowser'));
    for (const [action, ...args] of actions) {
      f[action](...args);
      await tick();
      checkpoint(t, [action, ...args].join(' '), call(action, ...args), f.mark());
    }
    traces.push(t);
  }
  const open = ['move', true];
  await scenario('an owner ABA cannot revive the retired browser presence or error', false,
    [open, ['changeOwner', 'b'], ['changeOwner', 'a'], ['resolve', 1, 'present'],
      ['resolve', 2, 'unavailable'], ['resolve', 3, 'absent']]);
  await scenario('a native collection result cannot start a draft read after departure', true,
    [open, ['move', false], ['resolve', 1, 'absent']]);
  await scenario('current native collection absence is followed by draft presence', true,
    [open, ['resolve', 1, 'absent'], ['resolve', 1, 'present']]);
  await scenario('current native collection presence needs no draft read', true,
    [open, ['resolve', 1, 'present']]);
  await scenario('current native draft refusal is visible without initialization', true,
    [open, ['resolve', 1, 'absent'], ['resolve', 1, 'unavailable']]);
  await scenario('an old owner legacy view clears before the new canonical probe', false,
    [open, ['enterLegacy'], ['changeOwner', 'b'], ['resolve', 1, 'present'], ['resolve', 2, 'unavailable']]);
  await scenario('foreground and suspension retire a visible browser probe', false,
    [open, ['hide', true], ['hide', false], ['suspend', true], ['resolve', 1, 'present'], ['resolve', 2, 'present']]);
  await scenario('current browser presence renders exactly once and keeps the same lease across repeated sync', false,
    [open, ['move', true], ['resolve', 1, 'present'], ['move', true]]);
  return checkTraces({model, traces, sources, driverHashes, scope: 'bounded-component',
    assumptions: ['Actual installed renderer presence functions and actual browser and native presence checks execute with closed read-only storage ports. Slot names represent collection and draft; the fake storage exposes no writes.',
      'Up to three probes, two synthetic owners, and representative settled responses. Entering the retained source initializes a controlled already-selected legacy view. Opening records, restoring or deleting notes and React commits remain separate.',
      'The canonical coordinator receives an observed refresh call after legacy retirement. Its actual store load, platform visibility events, local legacy keys and physical storage remain separate.']});
}

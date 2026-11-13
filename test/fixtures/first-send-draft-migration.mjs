import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../support/strip-types.mjs';

const adapter = new URL('../../apps/app/src/prototype/agent-adapter.ts', import.meta.url);
const durableStore = new URL('../../.eliza/client-features/packages/ui/src/state/durable-draft.ts', import.meta.url);
export const firstSendDraftMigrationSources = [import.meta.url, adapter, durableStore,
  new URL('../support/strip-types.mjs', import.meta.url)].map(fileURLToPath);

const sourceKey = JSON.stringify(['https://fixture.invalid', 'owner-a', 'agent-a', null]);
const destinationKey = JSON.stringify(['https://fixture.invalid', 'owner-a', 'agent-a', 'room-a']);
const otherKey = JSON.stringify(['https://fixture.invalid', 'owner-b', 'agent-b', 'room-b']);
export const migrationText = 'Keep draft A';
export const replacementText = 'Other committed text';
const turn = () => new Promise(resolve => setImmediate(resolve));
const record = (binding, revision, text, sending = false) => JSON.stringify({version: 1, binding, revision, text,
  ...(sending ? {sending: true} : {})});
const observed = raw => {
  if (raw === null) return {revision: '', text: '', sending: false};
  const {revision, text, sending} = JSON.parse(raw);
  return {revision, text, sending: sending === true};
};

/** Execute the actual adapter migration and SDK CAS with two held in-memory raw slots. */
export async function firstSendDraftMigrationFixture(destinationText = migrationText) {
  const source = readFileSync(adapter, 'utf8');
  const start = source.indexOf('function settleFirstSendSlot('), end = source.indexOf('/**\n * A new chat', start);
  assert.ok(start >= 0 && end > start, 'The actual first-send slot migration must remain available');
  const code = stripTypeScriptTypes(source.slice(start, end) + '\nglobalThis.settle = settleFirstSendSlot;');
  const {compareExchangeDraftStore} = await import(durableStore.href);
  const shell = {live: true, composerDraft: {binding: destinationKey}};
  const current = () => shell.live && shell.composerDraft.binding === destinationKey;
  let from = record(sourceKey, 'source-1', migrationText), to = record(destinationKey, 'destination-1', destinationText);
  let pending, lastPhase = '', started = false, retries = 0, attempts = 0, result = 'none';
  let sourceReceipt = observed(null), destinationReceipt = observed(null);
  let dispatched = {expected: '', current: false, destination: observed(null)};
  const hold = phase => new Promise(resolve => {
    assert.equal(pending, undefined, 'Migration has one outstanding synthetic port');
    lastPhase = phase;
    pending = {phase, resolve};
  });
  const sourceStore = compareExchangeDraftStore(sourceKey, {
    async read() {
      await hold('source');
      sourceReceipt = observed(from);
      return from;
    },
    async compareExchange(expected, next) {
      attempts++;
      dispatched = {expected: observed(expected).revision, current: current(), destination: observed(to)};
      await hold('clear');
      if (from !== expected) {result = 'conflict';return {status: result};}
      from = next;
      result = 'saved';
      return {status: result};
    },
  }, {revision: () => 'clear-' + (attempts + 1)});
  const destinationStore = compareExchangeDraftStore(destinationKey, {
    async read() {
      await hold(lastPhase === 'source' ? 'confirmation' : 'destination');
      destinationReceipt = observed(to);
      return to;
    },
    async compareExchange() {assert.fail('Migration never writes to the destination slot');},
  });
  const scope = vm.createContext({async assistantDraftStore(binding) {
    assert.ok([sourceKey, destinationKey].includes(binding));
    return binding === sourceKey ? sourceStore : destinationStore;
  }, setTimeout(callback, delay) {
    assert.equal(delay, [150, 600, 1500][retries]);
    retries++;
    void hold('retry').then(callback);
  }});
  vm.runInContext(code, scope);
  const observe = () => ({phase: pending?.phase || (started ? 'done' : 'idle'), live: shell.live,
    binding: shell.composerDraft.binding === destinationKey ? 'destination' : 'other', source: observed(from),
    destination: observed(to), sourceReceipt, destinationReceipt, retries, attempts, result, dispatched});
  const advance = async phase => {
    assert.equal(pending?.phase, phase);
    const gate = pending;
    pending = undefined;
    gate.resolve();
    await turn();
  };
  return {observe, advance,
    async start() {
      assert.equal(started, false);
      started = true;
      scope.settle(shell, sourceKey, destinationKey, migrationText, current);
      await turn();
    },
    async drain() {
      for (let step = 0; pending && step < 20; step++) await advance(pending.phase);
      assert.equal(pending, undefined);
      assert.equal(shell.firstSendSlotWrites.size, 0);
    },
    retire() {shell.live = false;},
    rebind() {shell.composerDraft.binding = otherKey;},
    replaceSource(text, sending = false) {from = record(sourceKey, 'source-2', text, sending);},
    replaceDestination(text) {to = record(destinationKey, 'destination-2', text);},
  };
}

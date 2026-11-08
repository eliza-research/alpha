import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadAgentRuntime, loadCoreRuntime, loadTurnControllers} from '../specs/quint/refinement/services/core-runtime/module.mjs';
import {TURN_STATE_TARGET} from '../scripts/core-state-patch.mjs';

test('actual core loaders apply and bind the isolated TurnControllerRegistry', async () => {
  const inputs = [fileURLToPath(import.meta.url)];
  const loaded = await loadTurnControllers(inputs);
  assert.deepEqual(loaded.coreState.transforms.map(entry => entry.path), [TURN_STATE_TARGET]);
  const first = new loaded.TurnControllerRegistry();
  const second = new loaded.TurnControllerRegistry();
  await first.runWith('room', async signal => {
    assert.equal(first.signalFor('room'), signal);
    assert.equal(second.signalFor('room'), null);
    await Promise.resolve();
    assert.equal(second.signalFor('room'), null);
  });
  assert.equal(first.signalFor('room'), null);
  for (const bundle of [await loadAgentRuntime(inputs), await loadCoreRuntime(inputs)]) {
    for (const entry of bundle.coreState.transforms) {
      const [file, hashes] = Object.entries(bundle.compiledHashes).find(([file]) => file.endsWith('/' + entry.path));
      assert.equal(bundle.driverHashes[file], hashes.sourceSha256);
      assert.equal(hashes.sourceSha256, entry.sourceSha256);
      assert.equal(hashes.effectiveSha256, entry.outputSha256);
    }
  }
});

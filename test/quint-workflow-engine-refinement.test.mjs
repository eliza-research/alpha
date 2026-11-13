import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';


test('workflow compilation rejects a changed graph or mismatched captured source bytes', async () => {
  const {engineDriverSources, prepareEngineModule} = await import('../specs/quint/refinement/services/workflow-engine/ports.mjs');
  const {captureInputs} = await import('../specs/quint/refinement/check-traces.mjs');
  const sources = await engineDriverSources();
  const hashes = captureInputs(sources);
  await assert.rejects(prepareEngineModule(sources.slice(1), hashes), /module graph changed/);
  const key = Object.keys(hashes).find(path => path.endsWith('/embedded-workflow-service.ts'));
  assert.ok(key);
  await assert.rejects(prepareEngineModule(sources, {...hashes, [key]: '0'.repeat(64)}), /compiled bytes differ/);
});

test('workflow engine SQL admission and source coordinator refine bounded Quint traces', {timeout: scaledTimeout(360000)}, () => {
  const result = spawnSync(process.execPath, ['-e', `
    import assert from 'node:assert/strict';
    import {runWorkflowEngineRefinement} from './specs/quint/refinement/services/workflow-engine/index.mjs';
    const result = await runWorkflowEngineRefinement(['test/quint-workflow-engine-refinement.test.mjs']);
    const [receipt] = result.receipts;
    assert.equal(receipt.passed, true);
    assert.equal(receipt.inputsUnchanged, true);
    assert.equal(receipt.driverInputsBound, true);
    assert.equal(receipt.traces, 24);
    assert.equal(receipt.checkpoints, 118);
    assert.ok(receipt.actions.cancelReceipt);
    assert.ok(receipt.actions.decisionUnconfirmed);
    assert.ok(receipt.actions.replayScheduled);
    assert.ok(result.obligations.length >= 4);
    console.log(JSON.stringify({traces: receipt.traces, checkpoints: receipt.checkpoints}));
  `], {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: scaledTimeout(340000), maxBuffer: 16 * 1024 * 1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

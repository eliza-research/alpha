import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('fifteen service models check real-source component and coordinator traces', {timeout: 420000}, () => {
  const result = spawnSync(process.execPath, ['--import=tsx', '--input-type=module', '-e', `
    import {runServicesRefinement} from './specs/quint/refinement/services/index.mjs';
    const result = await runServicesRefinement();
    const models = new Set(result.receipts.map(receipt => receipt.coverageModel || receipt.model));
    if (models.size !== 15 || result.receipts.length !== 16 || result.receipts.some(receipt => !receipt.passed || !receipt.inputsUnchanged || !receipt.driverInputsBound)) throw Error('Incomplete service model checks');
    console.log(JSON.stringify({models: models.size, traces: result.receipts.reduce((sum, receipt) => sum + receipt.traces, 0), obligations: result.obligations.length}));
  `], {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 400000, maxBuffer: 8 * 1024 * 1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"models":15/);
  assert.match(result.stdout, /"obligations":16/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('service components and coordinators check real-source traces and preserve explicit platform obligations', {timeout: 300000}, () => {
  const result = spawnSync(process.execPath, ['--import=tsx', '--input-type=module', '-e', `
    import {runServicesRefinement} from './specs/quint/refinement/services/index.mjs';
    const result = await runServicesRefinement();
    if (result.receipts.length !== 17 || result.receipts.some(receipt => !receipt.passed)) throw Error('Incomplete service model checks');
    console.log(JSON.stringify({models: result.receipts.length, traces: result.receipts.reduce((sum, receipt) => sum + receipt.traces, 0), obligations: result.obligations.length}));
  `], {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 290000, maxBuffer: 8 * 1024 * 1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"models":17/);
  assert.match(result.stdout, /"obligations":17/);
});

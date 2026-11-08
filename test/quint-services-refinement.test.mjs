import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('service components and coordinators check real-source traces and preserve explicit platform obligations', {timeout: 900000}, () => {
  const result = spawnSync(process.execPath, ['--import=tsx', '--input-type=module', '-e', `
    import {runServicesRefinement} from './specs/quint/refinement/services/index.mjs';
    const result = await runServicesRefinement();
    if (result.receipts.some(receipt => !receipt.passed)) throw Error('Incomplete service model checks');
    console.log('QUINT_SUMMARY ' + JSON.stringify({
      receipts: result.receipts.length,
      traces: result.receipts.reduce((sum, receipt) => sum + receipt.traces, 0),
      obligations: result.obligations.length,
    }));
  `], {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 880000, maxBuffer: 8 * 1024 * 1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const prefix = 'QUINT_SUMMARY ';
  const summaries = result.stdout.split('\n').filter(line => line.startsWith(prefix));
  assert.equal(summaries.length, 1, 'one service refinement summary');
  const {receipts, traces, obligations} = JSON.parse(summaries[0].slice(prefix.length));
  assert.equal(receipts, 35);
  assert.ok(traces >= receipts);
  assert.ok(obligations >= 37, 'remaining obligations accompany the bounded evidence');
});

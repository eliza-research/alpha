import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {closeSync, fstatSync, mkdtempSync, openSync, readSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadModels} from '../scripts/quint-lib.ts';

// The complete serial campaign was still producing passing receipts at its former
// 880-second cutoff. Keep all campaigns and a finite budget matching the app aggregate.
test('service components and coordinators check real-source traces and preserve explicit platform obligations', {timeout: 2400000}, () => {
  const expected = new Set(loadModels().filter(model => model.family === 'services').map(model => model.module));
  const directory = mkdtempSync(join(tmpdir(), 'alpha-quint-services-'));
  const log = openSync(join(directory, 'run.log'), 'w+');
  try {
    const result = spawnSync(process.execPath, ['-e', `
      import {writeSync} from 'node:fs';
      import {runServicesRefinement} from './specs/quint/refinement/services/index.mjs';
      const result = await runServicesRefinement(({receipts, failures}) => {
        console.log('Service refinement progress: '+receipts.length+' receipts, '+failures.length+' failures');
      });
      if (result.failures.length) {
        const names = result.failures.map(({campaign}) => campaign);
        const errors = result.failures.map(({campaign, error}) => new Error(campaign, {cause: error}));
        throw new AggregateError(errors, 'Service refinement campaigns failed: ' + names.join(', '));
      }
      writeSync(3, JSON.stringify({
        models: result.receipts.map(receipt => receipt.model),
        traces: result.receipts.reduce((sum, receipt) => sum + receipt.traces, 0),
        obligations: result.obligations.length,
      }));
    `], {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 2380000, stdio: ['ignore', log, log, 'pipe']});
    if (result.error || result.status !== 0) {
      const size = fstatSync(log).size;
      const tail = Buffer.alloc(Math.min(size, 64 * 1024));
      const read = readSync(log, tail, 0, tail.length, size - tail.length);
      assert.fail(`Service refinement exited with ${result.error ?? result.signal ?? result.status}\n${tail.toString('utf8', 0, read)}`);
    }
    const {models, traces, obligations} = JSON.parse(result.output[3]);
    assert.deepEqual(new Set(models), expected);
    assert.deepEqual(models.filter((model, index) => models.indexOf(model) !== index).sort(),
      ['GoogleAccounts', 'IdentitySession', 'InboxCoordinator']);
    assert.ok(traces >= models.length);
    assert.ok(obligations >= 37, 'remaining obligations accompany the bounded evidence');
  } finally {
    closeSync(log);
    rmSync(directory, {recursive: true, force: true});
  }
});

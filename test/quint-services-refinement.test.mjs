import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {closeSync, fstatSync, mkdtempSync, openSync, readFileSync, readSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('service components and coordinators check real-source traces and preserve explicit platform obligations', {timeout: 900000}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-quint-services-'));
  const log = openSync(join(directory, 'run.log'), 'w+');
  try {
    const result = spawnSync(process.execPath, ['--import=tsx', '--input-type=module', '-e', `
      import {writeSync} from 'node:fs';
      import {runServicesRefinement} from './specs/quint/refinement/services/index.mjs';
      const result = await runServicesRefinement();
      if (result.receipts.some(receipt => !receipt.passed)) throw Error('Incomplete service model checks');
      writeSync(3, JSON.stringify({
        models: result.receipts.map(receipt => receipt.model),
        traces: result.receipts.reduce((sum, receipt) => sum + receipt.traces, 0),
        obligations: result.obligations.length,
      }));
    `], {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 880000, stdio: ['ignore', log, log, 'pipe']});
    if (result.error || result.status !== 0) {
      const size = fstatSync(log).size;
      const tail = Buffer.alloc(Math.min(size, 64 * 1024));
      const read = readSync(log, tail, 0, tail.length, size - tail.length);
      assert.fail(`Service refinement exited with ${result.error ?? result.signal ?? result.status}\n${tail.toString('utf8', 0, read)}`);
    }
    const {models, traces, obligations} = JSON.parse(result.output[3]);
    const manifest = JSON.parse(readFileSync(new URL('../specs/quint/services/manifest.json', import.meta.url)));
    const expected = new Set(manifest.map(model => model.module));
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

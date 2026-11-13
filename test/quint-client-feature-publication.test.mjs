import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('client publication conformance runs from a nested test-runner process', {timeout: scaledTimeout(180000)}, () => {
  const driver = fileURLToPath(import.meta.url);
  const script = `
    import {checkClientFeaturePublication} from './specs/quint/refinement/services/client-feature-publication.mjs';
    const result = await checkClientFeaturePublication(${JSON.stringify([driver])});
    console.log(JSON.stringify({passed: result.passed, traces: result.traces,
      checkpoints: result.checkpoints, inputsUnchanged: result.inputsUnchanged,
      driverInputsBound: result.driverInputsBound}));
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: scaledTimeout(170000),
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    passed: true, traces: 1, checkpoints: 16, inputsUnchanged: true, driverInputsBound: true,
  });
});

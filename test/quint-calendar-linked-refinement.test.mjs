import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('current shared Calendar reconciliation and consent refine recorded checkpoints', {timeout: 180000}, () => {
  const result = spawnSync(process.execPath, ['--import=tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {calendarRefinement} from './specs/quint/refinement/services/calendar.mjs';
    const receipt = await calendarRefinement();
    assert.equal(receipt.model, 'CalendarLinkedSync');
    assert.equal(receipt.passed, true);
    assert.equal(receipt.traces, 20);
    assert.equal(receipt.driverInputsBound, true);
    assert.equal(receipt.inputsUnchanged, true);
    assert.ok(receipt.actions.providerResult);
    assert.ok(receipt.actions.recoveryReply);
    console.log(JSON.stringify({traces: receipt.traces, checkpoints: receipt.checkpoints}));
  `], {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 170000, maxBuffer: 8 * 1024 * 1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"traces":20/);
});

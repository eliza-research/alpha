// Partial source contract regression evidence. Original schedules, actions and assertions are retained.
// Only the selected source members/components and controlled ports execute; this is not whole-file refinement.
import {after as afterPartialContract} from 'node:test';
import partialContractAssert from 'node:assert/strict';
import {fileURLToPath as partialContractFile} from 'node:url';
import {captureReplayClosure as capturePartialClosure} from '../specs/quint/refinement/observed-replay.mjs';
import {captureInputs as capturePartialInputs} from '../specs/quint/refinement/check-traces.mjs';
const partialContractInputs = capturePartialClosure([partialContractFile(import.meta.url)]);
afterPartialContract(() => partialContractAssert.deepEqual(capturePartialInputs(Object.keys(partialContractInputs)), partialContractInputs));

import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkAutomationRequestSettlement} from '../specs/quint/refinement/services/automation-request-settlement.mjs';

const own = fileURLToPath(import.meta.url);
test("partial source contract: actual automation journal settlement matches complete and partial source schedules", {timeout: 180000}, async () => {
  const {receipt} = await checkAutomationRequestSettlement([own]);
  assert.equal(receipt.passed, true);assert.equal(receipt.inputsUnchanged, true);assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 6);assert.equal(receipt.checkpoints, 35);
  for (const name of ['change', 'serverTake', 'unknownReply', 'okReply', 'refresh', 'allowAnother', 'switchConnection'])
    assert.ok(receipt.actions[name] > 0, name);
});

for (const [name, rewrite, expected] of [
  ['a partial source is wrongly allowed to settle a deletion', source => source.replace("&&complete('automations')", ''), /Partial source must retain unknown deletion/],
  ['a list is wrongly allowed to prove an earlier run', source => source.replace('  return false;\n });', "  return intent.method==='POST';\n });"), /Complete list cannot prove prior run/],
]) test('settlement oracle rejects actual-source mutation: ' + name, {timeout: 180000}, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-automation-settlement-canary-'));
  try {
    await assert.rejects(checkAutomationRequestSettlement([own], {rewrite, out: join(directory, 'receipt.json')}), expected);
  } finally {rmSync(directory, {recursive: true, force: true});}
});

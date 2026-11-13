import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkPasswordEntryDraft} from '../specs/quint/refinement/application/password-entry-draft.mjs';

test('the password entry form follows every PasswordEntryDraft trace', {timeout: scaledTimeout(240000)}, async () => {
  const receipt = await checkPasswordEntryDraft();
  console.log(JSON.stringify(receipt));
  assert.equal(receipt.traces, 52);
  assert.ok(receipt.checkpoints > 1000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['openNew', 'openEdit', 'setDetails', 'typePassword', 'chooseGenerated', 'chooseTyped', 'tapSave', 'saveSettles', 'tapDelete', 'removeSettles', 'expire', 'unlock',
    'leaveEntry', 'lock', 'leavePages', 'openPages', 'hide', 'show'])
    assert.ok(receipt.actions[action] > 0, `${action} is replayed`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {checkPasswordProviderDialog} from '../specs/quint/refinement/application/password-provider-dialog.mjs';

test('the development password provider dialog follows every PasswordProviderDialog trace', {timeout: 240000}, async () => {
  const receipt = await checkPasswordProviderDialog();
  assert.equal(receipt.traces, 54);
  assert.ok(receipt.checkpoints > 1000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['request', 'openSettles', 'editStart', 'editSettles', 'unlockVault', 'fillSample', 'close', 'hide', 'show', 'lockScreen', 'unlockScreen', 'externalChange'])
    assert.ok(receipt.actions[action] > 0, `${action} is replayed`);
});

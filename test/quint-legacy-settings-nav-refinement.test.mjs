import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkSettingsNavRefinement} from '../specs/quint/legacy/settings-nav/check-settings-nav-refinement.mjs';

test('historical Settings profiles replay shared mounted routes and retain their differences', {timeout: 240000}, async () => {
  const {receipts, mismatches} = await checkSettingsNavRefinement([fileURLToPath(import.meta.url)]);
  assert.deepEqual(receipts.map(row => [row.model, row.traces]), [
    ['SettingsNavProposedReplay', 3], ['SettingsNavCurrentReplay', 3],
  ]);
  assert.ok(receipts.every(row => row.passed && row.driverInputsBound && row.inputsUnchanged));
  assert.deepEqual(mismatches.map(row => row.id), [
    'SettingsNavCurrentDirectSignOut', 'SettingsNavCurrentRootWifi', 'SettingsNavCurrentLicenseDetails',
    'SettingsNavProposedLicenseDetails', 'SettingsNavProposedInfoRows',
  ]);
  assert.ok(mismatches.every(row => row.driverInputsBound && row.results[0].kind === 'observation-mismatch'));
});

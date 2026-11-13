import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkShadeNoticeQuestionAdmission} from '../specs/quint/refinement/application/shade-notice-question-admission.mjs';

// Partial source contract regression. Original extracted member schedules and ports remain bounded.
// This does not establish whole-file refinement, installed behavior or acceptance.
test('partial source contract: ShadeNoticeQuestionAdmission retains its original source schedules', {timeout: scaledTimeout(240000)}, async () => {
  const receipt = await checkShadeNoticeQuestionAdmission([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.model, 'ShadeNoticeQuestionAdmission');
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});

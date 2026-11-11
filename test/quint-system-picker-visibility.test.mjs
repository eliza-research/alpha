import test from 'node:test';
import assert from 'node:assert/strict';
import {replaySystemPickerVisibility} from '../specs/quint/refinement/services/system-picker-visibility.mjs';

test('the system picker counter and the owned file picker follow every SystemPickerVisibility model step', {timeout: 180000}, async () => {
  const receipt = await replaySystemPickerVisibility({traces: 300, maxSteps: 20});
  assert.equal(receipt.traces, 300);
  assert.ok(receipt.steps > 3000, JSON.stringify(receipt));
  for (const action of ['pickerStart', 'pickerEnd', 'pageHide', 'filePickerStart', 'filePickerCancel', 'filePickerResult']) assert.ok(receipt.actions[action] > 0, action);
});
test('a file picker that keeps an earlier consumer is rejected by the replay', {timeout: 180000}, async () => {
  await assert.rejects(replaySystemPickerVisibility({traces: 300, maxSteps: 20, rewrite: {'browser/file-picker.ts': text =>
    text.replace('current?.abort();const controller', 'const controller')}}), /trace \d+ step \d+ |two file pickers own the consumer/);
});
test('a picker counter that is not released when the picker throws or settles is rejected by the replay', {timeout: 180000}, async () => {
  await assert.rejects(replaySystemPickerVisibility({traces: 300, maxSteps: 20, rewrite: {'prototype/scan-pdf.ts': text =>
    text.replace('finally{systemPickers--;}', 'finally{}')}}), /trace \d+ step \d+ pickerEnd/);
});

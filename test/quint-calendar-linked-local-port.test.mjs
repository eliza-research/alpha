import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkCalendarLinkedLocalPort, checkCalendarLinkedSeries} from '../specs/quint/refinement/application/calendar-linked-local-port.mjs';

test('the browser calendar sync port follows every CalendarLinkedLocalPort model step', {timeout: scaledTimeout(280000)}, async () => {
  const result = await checkCalendarLinkedLocalPort();
  assert.equal(result.traces, 41);
  for (const action of ['begin', 'ownerChanged', 'transact', 'finish', 'localEdit', 'ownerStagesDeletion', 'undoDeletion',
    'finalizeDeletion', 'sourceReplaced', 'unbind', 'stutter']) assert.ok(result.actions[action] > 0, action);
  for (const source of ['apps/app/src/browser/calendar-linked-local.ts', 'apps/app/src/browser/calendar-store.ts',
    'apps/app/src/browser/calendar-deletions.ts']) assert.ok(result.sources.includes(source), source);
});

test('an update that does not compare the revision the controller read is rejected by the replay', {timeout: scaledTimeout(280000)}, async () => {
  const guard = 'if (!before || before.revision !== expectedRevision)';
  await assert.rejects(checkCalendarLinkedLocalPort(code => {
    assert.ok(code.includes(guard));
    return code.replace(guard, 'if (!before)');
  }), /transact/);
});

test('a port that skips its closing binding check is rejected by the replay', {timeout: scaledTimeout(280000)}, async () => {
  const closing = /check\(\);(\s*window\.dispatchEvent\(new Event\("alpha:(?:deletions-changed|calendar-document-changed)"\)\);\s*(?:return result;|window\.))/g;
  await assert.rejects(checkCalendarLinkedLocalPort(code => {
    assert.equal(code.match(closing)?.length, 2, 'the update and the deletion each end with the check');
    return code.replace(closing, '$1');
  }), /finish/);
});

const own = fileURLToPath(import.meta.url);
test('a linked provider update stores and re-reads the exact series and attendees through its deletion review', {timeout: scaledTimeout(120000)}, async () => {
  const receipt = await checkCalendarLinkedSeries([own]);
  assert.equal(receipt.traces, 1);
  assert.equal(receipt.checkpoints, 11);
  assert.ok(receipt.driverInputsBound);
});

test('the linked series replay catches recurrence and attendee projection loss', {timeout: scaledTimeout(120000)}, async () => {
  for (const [field, projection, message] of [
    ['recurrence', 'syncRecurrence(row)', /series and exclusions round-trip/],
    ['attendees', 'syncAttendees(row, resolve)', /Attendee identity and optionality round-trip/],
  ]) {
    await assert.rejects(checkCalendarLinkedSeries([own], code => {
      const projectionField = `${field}: ${projection}`;
      assert.ok(code.includes(projectionField));
      return code.replace(projectionField, `${field}: []`);
    }), message);
  }
});

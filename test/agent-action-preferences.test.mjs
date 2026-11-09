import test from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';

const {DeviceActions} = await tsImport('../apps/app/src/runtime/device-actions.ts', import.meta.url);
const signal = () => new AbortController().signal;
const permit = async () => true;

function fixture(rows, status = 'succeeded') {
  const actions = new DeviceActions({}, {}, 'fixture');
  actions.proposals = new Map(rows.map(([id, requestMessageId, workflow, type = 'create_note']) =>
    [id, {proposal: {requestMessageId, workflow, operation: {type}}}]));
  const approved = [];
  actions.approve = async id => {
    approved.push(id);
    return {proposalId: id, status, summary: 'Test result'};
  };
  return {approved, run: (allowed = permit, abort = signal()) =>
    actions.performRequested('request', {}, abort, allowed)};
}

test('only current-request proposals execute; old, unbound and workflow actions stay pending', async () => {
  const f = fixture([
    ['old', 'previous'], ['unbound'], ['current', 'request'], ['workflow', 'request', {}],
  ]);
  await f.run();
  assert.deepEqual(f.approved, ['current']);
});

test('approval preference is checked before every action', async () => {
  const rows = [['one', 'request'], ['two', 'request']];
  const denied = fixture(rows);
  await denied.run(async () => false);
  assert.deepEqual(denied.approved, []);

  const changed = fixture(rows);
  let checks = 0;
  await changed.run(async () => ++checks === 1);
  assert.deepEqual(changed.approved, ['one']);
});

test('an uncertain outcome stops the batch without retrying', async () => {
  const f = fixture([['one', 'request'], ['two', 'request']], 'unknown');
  await f.run();
  assert.deepEqual(f.approved, ['one']);
});

test('a cancelled request dispatches nothing', async () => {
  const f = fixture([['one', 'request']]);
  await assert.rejects(f.run(permit, AbortSignal.abort()), {name: 'AbortError'});
  assert.deepEqual(f.approved, []);
});

test('direct requests execute reversible local operations and keep private or external actions in review', async () => {
  const direct = ['create_note', 'open_view', 'camera_capture_photo', 'photo_library_select'];
  const reviewed = [
    'sms_send', 'notes_delete', 'notes_update', 'notes_read_selected', 'notes_query',
    'calendar_create_local', 'calendar_create', 'calendar_update', 'calendar_delete',
    'calendar_named', 'reminder_create', 'create_reminder', 'reminder_update',
    'reminder_delete', 'reminder_named', 'photo_library_review', 'browser_navigate',
    'maps_read_selected', 'future_operation',
  ];
  const f = fixture([...reviewed, ...direct].map(type => [type, 'request', undefined, type]));
  await f.run();
  assert.deepEqual(f.approved, direct);
});

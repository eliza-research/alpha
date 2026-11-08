import test from 'node:test';
import assert from 'node:assert/strict';

const {presentDeviceRecordOperation}=await import('../apps/app/src/runtime/device-record-presentation.ts');
const zone='America/Los_Angeles';
const schedule={at:'2026-10-29T05:52:17.581Z',dueAt:'2026-10-29T05:52:17.581Z',alertMinutes:0};

test('reminder review card copy rounds relative instants to the minute while the receipt keeps the exact instant',()=>{
  const presented=presentDeviceRecordOperation({type:'reminder_create',fields:{title:'Stretch',body:'',schedule}},zone);
  assert.equal(presented.description,'Create reminder\n“Stretch”\nDue October 28, 2026 at 10:52 PM PDT (America/Los_Angeles).\nAlert October 28, 2026 at 10:52 PM PDT. Notification delivery may be approximate.\nDoes not repeat.');
  assert.doesNotMatch(presented.description,/:\d\d:\d\d|\.\d{3}/,'card copy carries no seconds or milliseconds');
  assert.match(presented.appliedSummary,/10:52:17\.581 PM PDT/,'receipt keeps the exact instant');
  const legacy=presentDeviceRecordOperation({type:'create_reminder',title:'Stretch',dueAt:schedule.dueAt},zone);
  assert.match(legacy.description,/Due October 28, 2026 at 10:52 PM PDT \(America\/Los_Angeles\)\./);
  assert.match(legacy.appliedSummary,/10:52:17\.581 PM PDT/);
});

test('reminder review card drops a body that only repeats the title',()=>{
  const line=body=>presentDeviceRecordOperation({type:'reminder_create',fields:{title:'Stretch',body,schedule}},zone).description.split('\n');
  assert.deepEqual(line('Stretch').slice(0,3),['Create reminder','“Stretch”','Due October 28, 2026 at 10:52 PM PDT (America/Los_Angeles).']);
  assert.deepEqual(line(' stretch ').slice(0,3),['Create reminder','“Stretch”','Due October 28, 2026 at 10:52 PM PDT (America/Los_Angeles).']);
  assert.deepEqual(line('Hold each side for 30 seconds').slice(0,3),['Create reminder','“Stretch”','Hold each side for 30 seconds']);
  assert.equal(presentDeviceRecordOperation({type:'reminder_update',fields:{title:'Stretch',body:'Stretch'}},zone).description,'Update reminder\n“Stretch”\nTiming unchanged.');
});

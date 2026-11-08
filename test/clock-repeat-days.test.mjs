import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {clockDays, describeClockDays, isClockOperation, validateClockOperation, validateClockOutcome, describeClockHandoff, buildClockRequest} from '../apps/app/src/runtime/clock-contract.ts';
const set = extra => ({type:'clock_handoff',action:'set',hour:6,minute:45,label:'Gym',timeZone:'UTC',...extra});
// The pinned upstream contract (read-only submodule). Skipped only when the submodule is not checked out.
const upstreamPath = 'vendor/eliza/plugins/plugin-assistant/src/services/device-actions/clock-contract.ts';
const upstream = fs.existsSync(upstreamPath) ? await import('../' + upstreamPath) : null;

test('repeat days are 1-7 unique Calendar values, normalised ascending for EXTRA_DAYS', () => {
 assert.deepEqual(clockDays([2,3,4,5,6]), [2,3,4,5,6]);
 assert.deepEqual(clockDays([6,2,4,3,5]), [2,3,4,5,6], 'any order is accepted and sorted');
 assert.deepEqual(clockDays([7,1]), [1,7]);
 for (const days of [[0], [8], [2,2], [1.5], ['2'], [1,2,3,4,5,6,7,1]]) assert.throws(() => clockDays(days), /repeat days/);
 assert.throws(() => clockDays('2,3'), /repeat days/);
 assert.throws(() => clockDays([]), /repeat days/);
});
test('set operations accept an optional days field and keep exact keys otherwise', () => {
 assert.equal('days' in validateClockOperation(set({})), false);
 assert.deepEqual(validateClockOperation(set({days:[1,7]})).days, [1,7]);
 assert.deepEqual(validateClockOperation(set({days:[7,1]})).days, [1,7]);
 assert.equal('days' in validateClockOperation(set({days:[]})), false, 'an explicit [] is a one-time alarm');
 assert.throws(() => validateClockOperation({type:'clock_handoff',action:'show',days:[2]}), /Unexpected Clock fields/);
 assert.equal(isClockOperation({type:'clock_alarm',action:'show'}), false);
 assert.throws(() => validateClockOperation({type:'clock_alarm',action:'show'}), /Invalid Clock (handoff )?operation/);
 assert.match(describeClockHandoff(validateClockOperation(set({days:[2,3,4,5,6]}))), /repeating weekdays/);
 assert.match(describeClockHandoff(validateClockOperation(set({days:[6,5,4,3,2]}))), /repeating weekdays/, 'review text does not depend on the order');
 assert.equal(describeClockDays([1,2,3,4,5,6,7]), 'every day');
 assert.equal(describeClockDays([2,4]), 'Mon, Wed');
 assert.deepEqual(buildClockRequest({action:'set',time:'06:45',label:'Gym',snooze:'10',days:[6,2,4,3,5]},'UTC').days, [2,3,4,5,6]);
 assert.equal('days' in buildClockRequest({action:'set',time:'06:45',label:'Gym',snooze:'10',days:[]},'UTC'), false, 'no chips selected is a one-time alarm');
});
test('every upstream-valid repeat is accepted; an explicit [] becomes a one-time alarm', {skip: !upstream && 'vendor/eliza is not checked out'}, () => {
 const accepted = [[2,3,4,5,6], [6,2,4], [3,2,1], [7,1], [1,2,3,4,5,6,7], [5], []];
 for (const days of accepted) {
  const remote = upstream.validateClockOperation(set({days}));
  assert.deepEqual(remote.days, days, 'upstream keeps the order it received');
  if (days.length === 0) { assert.equal('days' in validateClockOperation(set({days})), false); continue; }
  const local = validateClockOperation(set({days}));
  assert.deepEqual(local.days, [...days].sort((a, b) => a - b), JSON.stringify(days));
  assert.deepEqual({...local, days: undefined}, {...remote, days: undefined}, 'every other field is unchanged');
 }
 // Both contracts refuse the same malformed repeats.
 for (const days of [[0], [8], [2,2], [1.5], ['2'], [1,2,3,4,5,6,7,1], '2,3']) {
  assert.throws(() => upstream.validateClockOperation(set({days})), JSON.stringify(days));
  assert.throws(() => validateClockOperation(set({days})), JSON.stringify(days));
 }
});

test('handoff receipts retain valid outcomes and reject coerced status arrays', () => {
 const operation = {type:'clock_handoff',action:'show'};
 for (const [status, outcome] of [['opened','applied'], ['unknown','unknown'], ['unavailable','failed'], ['denied','failed'], ['failed','failed'], ['failed','not_applied']]) {
  const result = {kind:'clock-handoff',action:'show',status};
  assert.deepEqual(validateClockOutcome(operation,result,outcome), result);
 }
 for (const status of ['unavailable','denied','failed']) {
  assert.throws(() => validateClockOutcome(operation,{kind:'clock-handoff',action:'show',status:[status]},'failed'), /Clock result cannot establish this outcome/);
 }
 assert.throws(() => validateClockOutcome(operation,{kind:'clock-handoff',action:'dismiss',status:'opened'},'applied'), /Clock result binding changed/);
});

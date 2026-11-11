import test from 'node:test';
import assert from 'node:assert/strict';
import {checkCalendarApprovalReview} from '../specs/quint/refinement/application/calendar-approval-review.mjs';
test('typed Calendar decisions consume one exact current read and never replay uncertainty',{timeout:120000},async()=>{
 const receipt=await checkCalendarApprovalReview(['test/quint-calendar-approval-review.test.mjs']);
 assert.ok(receipt.passed&&receipt.inputsUnchanged&&receipt.driverInputsBound);
 assert.equal(receipt.traces,29);
 const last=Object.fromEntries(receipt.traceInputs.map(t=>[t.name,t.steps.at(-1).expect]));
 assert.equal(last['lost-decision']['s.dispatches'],1);
 assert.equal(last['retired-read-reply']['s.admitted'],false);
 assert.equal(last['retired-decision-reply']['s.returned'],'error');
 assert.equal(last['copied-row']['s.dispatches'],0);
 assert.equal(last['mutated-revision']['s.dispatches'],0);
 assert.equal(last['mutated-owner']['s.dispatches'],0);
 assert.equal(last['post-dispatch-row-mutation']['s.returned'],'succeeded');
});

import test from 'node:test';
import assert from 'node:assert/strict';
// A zero-length or negative form is a user-correctable end time, not a clock change.
// Before this check every end <= start reported "the clocks change", including the
// zero-hour reminder draft opened from a recording. The rendered End controls stay in
// test/browser/calendar-end-after-start.spec.ts.
process.env.TZ='America/New_York';
const {calendarFormTimeProblem:problem}=await import('../apps/app/src/runtime/calendar-form-draft.ts');
test('a form whose end is not after its start asks for a later end; only a real DST gap blames the clocks',()=>{
 const at=(h,m=0)=>new Date(2027,5,1,h,m);
 const end='Choose an end time after the start. Nothing was saved.',clocks='This local time does not exist because the clocks change. Choose another start or end time. Nothing was saved.';
 assert.deepEqual({zero:problem(at(9),at(9),0),negative:problem(at(9),at(8),-1),invalid:problem(at(9),at(9),Number.NaN),
  valid:problem(at(9),at(10),1),gap:problem(null,at(4),1),stalled:problem(at(9),at(9),1)},
  {zero:end,negative:end,invalid:end,valid:'',gap:clocks,stalled:clocks});
});

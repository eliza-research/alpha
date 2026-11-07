import {test,expect} from '@playwright/test';
import {openBrowserCalendar} from './helpers/browser-calendar';
// A zero-length or negative form is a user-correctable end time, not a clock change.
// Before this check every end <= start reported "the clocks change", including the
// zero-hour reminder draft opened from a recording. Source/test evidence only.
test.use({timezoneId:'America/New_York'});
test('a form whose end is not after its start asks for a later end; only a real DST gap blames the clocks',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {calendarFormTimeProblem:problem}=await import('/src/runtime/calendar-form-draft.ts');
  const at=(h:number,m=0)=>new Date(2027,5,1,h,m);
  return {zero:problem(at(9),at(9),0),negative:problem(at(9),at(8),-1),invalid:problem(at(9),at(9),Number.NaN),
   valid:problem(at(9),at(10),1),gap:problem(null,at(4),1),stalled:problem(at(9),at(9),1)};
 });
 const end='Choose an end time after the start. Nothing was saved.',clocks='This local time does not exist because the clocks change. Choose another start or end time. Nothing was saved.';
 expect(result).toEqual({zero:end,negative:end,invalid:end,valid:'',gap:clocks,stalled:clocks});
});
test('rendered End controls cannot reach the start, and the shortest form still saves with end after start',async({page})=>{
 test.setTimeout(120_000);
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.clock.setFixedTime(new Date('2027-06-01T12:00:00Z'));
 await page.goto('/');await openBrowserCalendar(page);
 await page.getByRole('button',{name:'New event',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('End validation');
 // End cannot be stepped to or before the start through rendered controls.
 for(let i=0;i<12;i++)await page.getByRole('button',{name:'End earlier',exact:true}).click();
 const events=()=>page.evaluate(async()=>(await new (await import('/src/browser/calendar.ts')).BrowserCalendar().list({begin:0,end:Date.parse('2030-01-01')})).events);
 await page.getByRole('button',{name:'Save event',exact:true}).click();
 await expect(page.getByText('Choose an end time after the start. Nothing was saved.',{exact:true})).toHaveCount(0);
 await expect.poll(async()=>(await events()).filter((e:any)=>e.title==='End validation').length).toBe(1);
 const saved=(await events()).find((e:any)=>e.title==='End validation');expect(saved.end).toBeGreaterThan(saved.begin);
});

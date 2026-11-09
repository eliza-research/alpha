import {test,expect} from '@playwright/test';
import {openBrowserCalendar} from './helpers/browser-calendar';
// The calendarFormTimeProblem messages are covered in test/calendar-end-after-start.test.mjs.
// This case keeps the rendered End controls, which need the browser.
test.use({timezoneId:'America/New_York'});
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

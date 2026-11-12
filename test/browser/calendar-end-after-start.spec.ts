import {test,expect} from '@playwright/test';
import {openBrowserCalendar} from './helpers/browser-calendar';
// The calendarFormTimeProblem messages are covered in test/calendar-end-after-start.test.mjs.
// This case keeps the rendered End controls, which need the browser.
test.use({timezoneId:'America/New_York'});
test('rendered To time keeps the range after From and saves a one-minute event',async({page})=>{
 test.setTimeout(120_000);
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.clock.setFixedTime(new Date('2027-06-01T12:00:00Z'));
 await page.goto('/');await openBrowserCalendar(page);
 await page.getByRole('button',{name:'New event',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('End validation');
 // End cannot be stepped to or before the start through rendered controls.
 const from=await page.getByLabel('From time',{exact:true}).inputValue();
 await page.getByLabel('To time',{exact:true}).fill(from);
 const next=new Date('2027-06-01T'+from+':00Z');next.setUTCMinutes(next.getUTCMinutes()+1);
 await page.getByLabel('To time',{exact:true}).fill(next.toISOString().slice(11,16));
 await page.getByLabel('To date',{exact:true}).fill(await page.getByLabel('From date',{exact:true}).inputValue());
 const events=()=>page.evaluate(async()=>(await new (await import('/src/browser/calendar.ts')).BrowserCalendar().list({begin:0,end:Date.parse('2030-01-01')})).events);
 await page.getByRole('button',{name:'Save event',exact:true}).click();
 await expect(page.getByText('Choose an end time after the start. Nothing was saved.',{exact:true})).toHaveCount(0);
 await expect.poll(async()=>(await events()).filter((e:any)=>e.title==='End validation').length).toBe(1);
 const saved=(await events()).find((e:any)=>e.title==='End validation');expect(saved.end-saved.begin).toBe(60_000);
});

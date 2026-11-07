import {openBrowserCalendar} from './helpers/browser-calendar';
import { returnToApps } from './app-navigation';
import {test,expect} from '@playwright/test';
for(const next of ['event','home','new-draft'] as const)test(`late Calendar deletion preserves newer ${next}`,async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.clock.install();await page.goto('/?mode=dev');await openBrowserCalendar(page);
 for(const title of ['Keep event B','Delete event A']){
  await page.getByRole('button',{name:'New event',exact:true}).click();
  await page.getByRole('textbox',{name:'Title',exact:true}).fill(title);
  await page.getByRole('button',{name:'Save event',exact:true}).click();
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
  if(title==='Keep event B')await page.getByRole('button',{name:'Back to calendar',exact:true}).click();
 }
 await page.evaluate(async()=>{
  const {BrowserCalendar}=await import('/src/browser/calendar.ts');const remove=BrowserCalendar.prototype.remove;
  const f=(window as any).deleteCompletion={calls:0,release:null,done:false};
  BrowserCalendar.prototype.remove=async function(input){f.calls++;const result=await remove.call(this,input);await new Promise<void>(resolve=>f.release=resolve);f.done=true;return result;};
 });
 await page.getByRole('button',{name:'Delete event',exact:true}).click();
 await page.getByRole('dialog',{name:'Delete calendar event?'}).getByRole('button',{name:'Delete event',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>typeof(window as any).deleteCompletion.release)).toBe('function');
 await page.getByRole('button',{name:'Back to calendar',exact:true}).click();
 if(next==='event')await page.getByRole('button',{name:/^Keep event B,/}).click();
 if(next==='home')await returnToApps(page);
 if(next==='new-draft'){await page.getByRole('button',{name:'New event',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('New unsaved event');}
 await page.evaluate(async()=>{(window as any).deleteCompletion.release();await new Promise(resolve=>setTimeout(resolve,0));});
 await expect.poll(()=>page.evaluate(()=>(window as any).deleteCompletion.done)).toBe(true);
 if(next==='event')await expect(page.getByRole('heading',{name:'Keep event B',exact:true})).toBeVisible();
 if(next==='home')await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
 if(next==='new-draft')await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('New unsaved event');
 await page.clock.fastForward(11000);
 await expect.poll(()=>page.evaluate(async()=>JSON.parse((await(await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).events.length)).toBe(1);
 const result=await page.evaluate(async ()=>({calls:(window as any).deleteCompletion.calls,events:JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).events}));
 expect(result.calls).toBe(1);expect(result.events.map((event:any)=>event.title)).toEqual(['Keep event B']);
});

import {openBrowserCalendar} from './helpers/browser-calendar';
import { returnToApps } from './app-navigation';
import {test,expect} from '@playwright/test';
for(const next of ['stay','home','new-draft'] as const)test(`edited event refresh waits for React completion and preserves ${next}`,async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?mode=dev');await openBrowserCalendar(page);await page.getByRole('button',{name:'New event',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Original meeting');await page.getByRole('switch',{name:'Video link',exact:true}).click();await page.getByRole('button',{name:'Save event',exact:true}).click();await expect(page.getByRole('button',{name:'Join',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit event',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Renamed meeting');
 await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');const save=BrowserCalendar.prototype.save,list=BrowserCalendar.prototype.list;let hold=false;(window as any).editSaves=0;BrowserCalendar.prototype.save=async function(input){(window as any).editSaves++;const result=await save.call(this,input);hold=true;return result;};BrowserCalendar.prototype.list=async function(input){if(hold){hold=false;await new Promise<void>(resolve=>(window as any).releaseEditedRefresh=resolve);}return list.call(this,input);};});
 await page.getByRole('button',{name:'Save event',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof(window as any).releaseEditedRefresh)).toBe('function');await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveCount(0);
 if(next==='home')await returnToApps(page);
 if(next==='new-draft'){await page.getByRole('button',{name:'New event',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Keep this newer draft');}
 await page.evaluate(()=>(window as any).releaseEditedRefresh());
 if(next==='stay'){await expect(page.getByRole('button',{name:'Join',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Renamed meeting',exact:true})).toBeVisible();}
 if(next==='home')await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
 if(next==='new-draft')await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Keep this newer draft');
 expect(await page.evaluate(()=>(window as any).editSaves)).toBe(1);const events=await page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).events);expect(events).toHaveLength(1);expect(events[0].title).toBe('Renamed meeting');expect(events[0].video).toBe(true);
});

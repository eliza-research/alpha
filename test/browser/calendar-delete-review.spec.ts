import {openBrowserCalendar} from './helpers/browser-calendar';
// Browser Calendar: "Delete event" shows one review step naming the event, as the Android plugin does.
// Source/test evidence for the browser build only; the Android dialog is covered by its own tests.
import {test,expect,type Page} from '@playwright/test';
const button=(page:Page,name:string)=>page.getByRole('button',{name,exact:true});
const titles=(page:Page)=>page.evaluate(async()=>(JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())||'{"events":[]}').events as {title:string}[]).map(row=>row.title).sort());
async function create(page:Page,title:string){
 await button(page,'New event').click();await page.getByRole('textbox',{name:'Title',exact:true}).fill(title);
 await button(page,'Save event').click();await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
}
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{if(!localStorage.getItem('alpha.connection.selection.v1'))localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));});
 await page.clock.install();await page.goto('/?mode=dev&tools=1');await openBrowserCalendar(page);
});
test('Cancel, Escape and system Back delete nothing; Delete removes exactly the reviewed event',async({page})=>{
 await create(page,'Keep this one');await button(page,'Back to calendar').click();
 await create(page,'Harbour pickup');
 const review=page.getByRole('dialog',{name:'Delete calendar event?'});
 await button(page,'Delete event').click();
 await expect(review).toContainText('Harbour pickup');await expect(review).toContainText('App calendar');
 await expect(review).toContainText('Delete this one event? Deletion waits 10 seconds. You can Undo during that time.');
 await expect(review.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
 await review.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(review).toHaveCount(0);await expect(page.getByRole('heading',{name:'Harbour pickup',exact:true})).toBeVisible();
 await button(page,'Delete event').click();await expect(review).toBeVisible();await page.keyboard.press('Escape');
 await expect(review).toHaveCount(0);
 await button(page,'Delete event').click();await expect(review).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
 await expect(review).toHaveCount(0);await expect(page.getByRole('heading',{name:'Harbour pickup',exact:true})).toBeVisible();
 expect(await titles(page)).toEqual(['Harbour pickup','Keep this one']);
 // Reload with the review open: nothing was deleted and no review is replayed.
 await button(page,'Delete event').click();await expect(review).toBeVisible();
 await page.reload();await expect(review).toHaveCount(0);expect(await titles(page)).toEqual(['Harbour pickup','Keep this one']);
 await openBrowserCalendar(page);await page.getByRole('button',{name:/^Harbour pickup,/}).click();
 await button(page,'Delete event').click();
 await review.getByRole('button',{name:'Delete event',exact:true}).click();
 await expect(page.getByRole('complementary',{name:'Pending deletions'}).getByRole('button',{name:'Undo',exact:true})).toBeVisible();
 expect(await titles(page)).toEqual(['Harbour pickup','Keep this one']);await page.clock.fastForward(11000);await expect.poll(()=>titles(page)).toEqual(['Keep this one']);
});
test('an event changed while its review is open is not deleted',async({page})=>{
 await create(page,'Changed underneath');
 const review=page.getByRole('dialog',{name:'Delete calendar event?'});
 await button(page,'Delete event').click();await expect(review).toBeVisible();
 // Another window edits the same event while the review is open.
 await page.evaluate(async()=>{const {calendarDocument}=await import('/src/browser/calendar-store.ts');await calendarDocument.edit(()=>({sourceRevision:'',events:[]}) as any,(data:any)=>{data.events[0].title='Edited elsewhere';data.events[0].revision='other-window';});});
 await review.getByRole('button',{name:'Delete event',exact:true}).click();
 await expect(page.getByText('This event changed. Nothing was deleted.',{exact:true})).toBeVisible();
 expect(await titles(page)).toEqual(['Edited elsewhere']);
});
test('a second Delete activation while a review is open cannot delete or stack reviews',async({page})=>{
 await create(page,'Only once');
 const review=page.getByRole('dialog',{name:'Delete calendar event?'});
 await button(page,'Delete event').click();await expect(review).toHaveCount(1);
 // A direct second request at the plugin boundary while the first review is pending is refused.
 const second=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const row=JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).events[0];return (await registerPlugin<any>('AlphaCalendar').remove({...row,expected:row})).status;});
 expect(second).toBe('cancelled');await expect(review).toHaveCount(1);expect(await titles(page)).toEqual(['Only once']);
 await review.getByRole('button',{name:'Delete event',exact:true}).click();
 await expect(page.getByRole('complementary',{name:'Pending deletions'}).getByRole('button',{name:'Undo',exact:true})).toBeVisible();await page.clock.fastForward(11000);await expect.poll(()=>titles(page)).toEqual([]);
});

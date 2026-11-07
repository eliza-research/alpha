import {calendarEditorReady} from './calendar-draft-readiness';
import {test,expect,type Page} from '@playwright/test';
async function edit(page:Page,allDay=false){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev');
 await page.evaluate(async allDay=>{
  const row={id:'conversion',calendarId:'local',title:'Conversion',body:'Keep this',location:'Desk',begin:Date.parse(allDay?'2027-03-14T00:00:00Z':'2027-03-15T02:00:00Z'),end:Date.parse(allDay?'2027-03-15T00:00:00Z':'2027-03-15T03:00:00Z'),allDay,timeZone:'America/New_York',revision:'b'.repeat(64)};
  await (async(raw:string)=>{const {browserDocuments}=await import('/src/browser/documents.ts');await browserDocuments.edit('alpha.browser.calendar.v1',async before=>({raw:JSON.stringify({...before?JSON.parse(before.raw!):{version:1,legacy:localStorage.getItem('alpha.browser.calendar.v1')},value:raw}),result:undefined}));})(JSON.stringify({sourceRevision:'a'.repeat(64),events:[row]}));
  const {registerPlugin}=await import('/src/platform-plugins.ts');
  (window as any).calendarEdit=registerPlugin<any>('AlphaCalendar').edit({id:row.id,revision:row.revision});
 },allDay);
 return page.getByRole('dialog',{name:'Edit calendar event'});
}
async function saved(page:Page){return page.evaluate(async ()=>JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).events[0]);}
test('timed to all-day uses the displayed civil day and preserves content across reload',async({page})=>{
 const dialog=await edit(page);await dialog.getByLabel('All day',{exact:true}).check();
 await expect(dialog.getByLabel('Starts',{exact:true})).toHaveValue('2027-03-14');await expect(dialog.getByLabel('Ends',{exact:true})).toHaveValue('2027-03-14');
 await dialog.getByRole('button',{name:'Save event',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(await saved(page)).toMatchObject({begin:Date.parse('2027-03-14T00:00:00Z'),end:Date.parse('2027-03-15T00:00:00Z'),allDay:true,body:'Keep this',location:'Desk'});
 const row=await saved(page);await page.reload();expect(await saved(page)).toEqual(row);
});
test('toggle round trip keeps unsaved timed edits and uses an exclusive midnight end',async({page})=>{
 const dialog=await edit(page);await dialog.getByLabel('Starts',{exact:true}).fill('2027-03-18T15:30');await dialog.getByLabel('Ends',{exact:true}).fill('2027-03-20T00:00');
 await dialog.getByLabel('All day',{exact:true}).check();await expect(dialog.getByLabel('Starts',{exact:true})).toHaveValue('2027-03-18');await expect(dialog.getByLabel('Ends',{exact:true})).toHaveValue('2027-03-19');
 await dialog.getByLabel('All day',{exact:true}).uncheck();await expect(dialog.getByLabel('Starts',{exact:true})).toHaveValue('2027-03-18T15:30');await expect(dialog.getByLabel('Ends',{exact:true})).toHaveValue('2027-03-20T00:00');
 await dialog.getByLabel('All day',{exact:true}).check();await dialog.getByLabel('Ends',{exact:true}).fill('2027-03-21');await dialog.getByLabel('All day',{exact:true}).uncheck();
 await expect(dialog.getByLabel('Starts',{exact:true})).toHaveValue('2027-03-18T00:00');await expect(dialog.getByLabel('Ends',{exact:true})).toHaveValue('2027-03-22T00:00');
});
test('all-day to timed preserves civil dates over daylight saving transition',async({page})=>{
 const dialog=await edit(page,true);await dialog.getByLabel('All day',{exact:true}).uncheck();await expect(dialog.getByLabel('Starts',{exact:true})).toHaveValue('2027-03-14T00:00');await expect(dialog.getByLabel('Ends',{exact:true})).toHaveValue('2027-03-15T00:00');
 await dialog.getByRole('button',{name:'Save event',exact:true}).click();await expect(dialog).toHaveCount(0);const row=await saved(page);expect(row).toMatchObject({allDay:false,begin:Date.parse('2027-03-14T05:00:00Z'),end:Date.parse('2027-03-15T04:00:00Z')});expect(row.end-row.begin).toBe(23*3600000);
});
test('cancelling a save waiting for the Calendar lock leaves the event unchanged',async({page})=>{
 const dialog=await edit(page);const before=await saved(page);
 await page.evaluate(()=>{(window as any).holdingCalendar=navigator.locks.request(JSON.stringify(['browser-document','alpha.browser.documents.v1','alpha.browser.calendar.v1']),()=>new Promise<void>(resolve=>{(window as any).releaseCalendar=resolve;}));});
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseCalendar)).toBe('function');
 await calendarEditorReady(dialog);await dialog.getByLabel('Event title',{exact:true}).fill('Must not save');await dialog.getByRole('button',{name:'Save event',exact:true}).click();await expect(dialog.getByRole('button',{name:'Save event',exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(await page.evaluate(()=>(window as any).calendarEdit)).toEqual({status:'cancelled'});
 await page.evaluate(async()=>{(window as any).releaseCalendar();await (window as any).holdingCalendar;await navigator.locks.request(JSON.stringify(['browser-document','alpha.browser.documents.v1','alpha.browser.calendar.v1']),()=>{});});expect(await saved(page)).toEqual(before);
});

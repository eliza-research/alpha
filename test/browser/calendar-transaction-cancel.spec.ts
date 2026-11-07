import {calendarEditorReady} from './calendar-draft-readiness';
import {test,expect} from '@playwright/test';
for(const kind of ['event','response'] as const)test(`closing ${kind} editor after preparation cancels the pending transaction`,async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev');
 const before=await page.evaluate(async kind=>{
  const {BrowserCalendar}=await import('/src/browser/calendar.ts');const {calendarDocument}=await import('/src/browser/calendar-store.ts');
  const calendar=new BrowserCalendar();await calendar.save({creationId:crypto.randomUUID(),calendarId:'local',title:'Retain original',begin:Date.now()+3600000,end:Date.now()+7200000,who:['maya']});
  const row=(await calendarDocument.read(()=>({events:[] as any[]}))).events[0];
  (window as any).dialogResult=kind==='event'?calendar.edit({id:row.id,revision:row.revision,people:[{id:'maya',name:'Maya'}]}):calendar.editResponse({id:row.id,revision:row.revision,person:'maya',name:'Maya'});
  return row;
 },kind);
 const dialog=page.getByRole('dialog',{name:kind==='event'?'Edit calendar event':'Local guest response',exact:true});await expect(dialog).toBeVisible();
 await page.evaluate(async()=>{
  const {calendarDocument}=await import('/src/browser/calendar-store.ts'),edit=calendarDocument.edit.bind(calendarDocument);
  calendarDocument.edit=function(initial,prepare,signal){return edit(initial,async data=>{
   const result=await prepare(data);(window as any).prepared=true;
   await new Promise<void>(resolve=>{(window as any).releasePrepared=resolve;});return result;
  },signal).finally(()=>{(window as any).writeSettled=true;});};
 });
 if(kind==='event'){await calendarEditorReady(dialog);await dialog.getByLabel('Event title',{exact:true}).fill('Must not be saved');}
 else await dialog.getByLabel('Guest response',{exact:true}).selectOption('yes');
 await dialog.getByRole('button',{name:kind==='event'?'Save event':'Save response',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).prepared)).toBe(true);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).dialogResult)).toEqual({status:'cancelled'});
 await page.evaluate(()=>(window as any).releasePrepared());await expect.poll(()=>page.evaluate(()=>(window as any).writeSettled)).toBe(true);
 const after=await page.evaluate(async()=>{const {calendarDocument}=await import('/src/browser/calendar-store.ts');return (await calendarDocument.read(()=>({events:[] as any[]}))).events[0];});
 expect(after).toEqual(before);
});

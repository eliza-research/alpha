import {openBrowserCalendar} from './helpers/browser-calendar';
import {test,expect} from '@playwright/test';
for(const scope of ['occurrence','series'] as const)test(`native Calendar ${scope} deletion carries only its exact inspected identity`,async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev');await expect(page.getByRole('button',{name:'Calendar',exact:true})).toBeVisible();
 await page.evaluate(async()=>{
  const {BrowserCalendar}=await import('/src/browser/calendar.ts'),{registerPlugin}=await import('/src/platform-plugins.ts');
  const begin=new Date();begin.setHours(12,0,0,0);await registerPlugin<any>('AlphaCalendar').save({creationId:crypto.randomUUID(),separateCreation:true,calendarId:'local',title:'Scoped native fixture',body:'Keep exact contents',location:'Desk',begin:begin.getTime(),end:begin.getTime()+3600000});
  const prototype=BrowserCalendar.prototype as any,list=prototype.list;
  prototype.list=async function(input:any){const result=await list.call(this,input);result.events=result.events.map((row:any)=>({...row,recurring:true}));return result;};
  const fixture=(window as any).nativeDeletion={inspections:[],staged:[],legacy:0};
  prototype.inspect=async()=>({status:'external'});
  prototype.inspectDeletion=async(input:any)=>{fixture.inspections.push(structuredClone(input));return {status:'ready',sourceId:'local',sourceRevision:'a'.repeat(64),revision:'b'.repeat(64),eventId:input.scope==='series'?'delete2:42:series':'delete2:42:occurrence:1791766800000',scope:input.scope||'occurrence'};};
  prototype.remove=async()=>{fixture.legacy++;throw Error('Legacy deletion must not be used for native scopes');};
  prototype.removeScoped=async(input:any)=>{fixture.staged.push(structuredClone(input));return {status:'queued'};};
  // Direct fixture insertion does not emit the UI save-completion event. Refresh the
  // mounted Calendar range after installing the native routing port.
  window.dispatchEvent(new Event('alpha:calendar-committed'));
 });
 await openBrowserCalendar(page);const event=page.getByRole('button',{name:/^Scoped native fixture,/});await expect(event).toBeVisible();
 // Exercise the native deletion routing branch after the real browser provider has loaded.
 // The platform and storage remain web; this is renderer routing evidence only.
 await page.evaluate(()=>{(window as any).Capacitor.isNativePlatform=()=>true;});await event.click();
 await page.getByRole('button',{name:scope==='series'?'Delete series':'Delete event',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).nativeDeletion.staged.length)).toBe(1);
 const result=await page.evaluate(async()=>({fixture:(window as any).nativeDeletion,data:JSON.parse((await(await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!)}));
 expect(result.fixture.legacy).toBe(0);expect(result.fixture.staged[0]).toEqual({eventId:scope==='series'?'delete2:42:series':'delete2:42:occurrence:1791766800000',sourceId:'local',sourceRevision:'a'.repeat(64),revision:'b'.repeat(64)});
 expect(result.fixture.inspections.at(-1).scope).toBe(scope==='series'?'series':undefined);expect(result.fixture.inspections.at(-1).expected).toMatchObject({title:'Scoped native fixture',body:'Keep exact contents',location:'Desk'});
 expect(result.data.events).toHaveLength(1);expect(result.data.events[0].body).toBe('Keep exact contents');
});

import { returnToApps } from './app-navigation';
import {test,expect,type Page} from '@playwright/test';
import {openBrowserCalendar as openLocalCalendar} from './helpers/browser-calendar';
async function start(page:Page){await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?mode=dev');await openLocalCalendar(page);}
async function draft(page:Page,title:string){const replace=async(dialog:any)=>{expect(dialog.message()).toBe('Replace the retained unsaved form with a new event?');await dialog.accept();};page.on('dialog',replace);try{await page.getByRole('button',{name:'New event',exact:true}).click();}finally{page.off('dialog',replace);}await page.getByRole('textbox',{name:'Title',exact:true}).fill(title);}
async function count(page:Page){return page.evaluate(async()=>JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())||'{"events":[]}').events.length);}
test('committed creation response loss survives reload and recovers receipt without replay',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await start(page);
 await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');const original=BrowserCalendar.prototype.save;BrowserCalendar.prototype.save=async function(input:any){await original.call(this,input);throw Error('Simulated response transport loss after commit');};});
 await draft(page,'Lost creation response');await page.getByRole('button',{name:'Save event',exact:true}).click();await expect.poll(()=>count(page)).toBe(1);
 await page.getByRole('button',{name:'Save event',exact:true}).click();expect(await count(page)).toBe(1);
 await page.reload();await openLocalCalendar(page);await page.getByRole('button',{name:'Check event creation receipts',exact:true}).click();await expect(page.getByRole('button',{name:'Check event creation receipts',exact:true})).toHaveCount(0);expect(await count(page)).toBe(1);expect(errors).toEqual([]);
});
test('creation identity returns original receipt and rejects changed arguments',async({page})=>{
 await start(page);const result=await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');const cal=new BrowserCalendar(),input={creationId:crypto.randomUUID(),calendarId:'local',title:'Bound request',begin:Date.now()+3600000,end:Date.now()+7200000};const first=await cal.save(input),second=await cal.save(input);let changed=false;try{await cal.save({...input,title:'Changed request'});}catch{changed=true;}return {first,second,changed};});expect(result.second).toEqual(result.first);expect(result.changed).toBe(true);expect(await count(page)).toBe(1);
});
test('different tabs cannot silently bypass a pending creation',async({page,context})=>{
 await start(page);const other=await context.newPage();await other.goto('/?mode=dev');
 const save=(p:Page,title:string)=>p.evaluate(async title=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');return new BrowserCalendar().save({creationId:crypto.randomUUID(),calendarId:'local',title,begin:Date.now()+3600000,end:Date.now()+7200000});},title);
 const results=await Promise.all([save(page,'Tab one'),save(other,'Tab two')]);expect(results.map(r=>r.status).sort()).toEqual(['pending-creation','saved']);expect(await count(page)).toBe(1);
});
test('explicit separate-event review retains unresolved history and creates one new identity',async({page})=>{
 await start(page);await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');await new BrowserCalendar().save({creationId:crypto.randomUUID(),calendarId:'local',title:'Previous event',begin:Date.now()+3600000,end:Date.now()+7200000});});
 await page.reload();await openLocalCalendar(page);page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Create a separate event',exact:true}).click();expect(await count(page)).toBe(1);
 page.once('dialog',dialog=>{expect(dialog.message()).toContain('previous event may already exist');return dialog.accept();});await page.getByRole('button',{name:'Create a separate event',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Explicit separate event');await page.getByRole('button',{name:'Save event',exact:true}).click();await expect.poll(()=>count(page)).toBe(2);await expect(page.getByText('Event saved.',{exact:true})).toBeVisible();expect(await page.evaluate(async()=>Object.values(JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).creations).filter((r:any)=>!r.acknowledged).length)).toBe(1);
});
test('lost acknowledgement response cannot leave the old creation form available to replay',async({page})=>{
 await start(page);await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');const original=BrowserCalendar.prototype.acknowledgeCreation;BrowserCalendar.prototype.acknowledgeCreation=async function(input:any){await original.call(this,input);throw Error('Lost ack response');};});await draft(page,'Acknowledgement loss');await page.getByRole('button',{name:'Save event',exact:true}).click();await expect.poll(()=>count(page)).toBe(1);await expect(page.getByRole('button',{name:'Save event',exact:true})).toHaveCount(0);await page.reload();expect(await count(page)).toBe(1);
});

test('leaving the form while creation receipt admission is pending cannot dispatch a write',async({page})=>{
 await start(page);await draft(page,'Retired draft');await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');const original=BrowserCalendar.prototype.pendingCreations;BrowserCalendar.prototype.pendingCreations=async function(){await new Promise<void>(resolve=>{(window as any).releaseCreationAdmission=resolve;});return original.call(this);};});
 await page.getByRole('button',{name:'Save event',exact:true}).click();await expect.poll(()=>page.evaluate(async()=>typeof (window as any).releaseCreationAdmission)).toBe('function');await page.getByRole('button',{name:'Back to calendar',exact:true}).click();await page.evaluate(async()=>(window as any).releaseCreationAdmission());await page.waitForTimeout(150);expect(await count(page)).toBe(0);
});
for(const leave of ['draft','home'] as const)test(`late committed save does not replace a newer ${leave}`,async({page})=>{
 await start(page);await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');const original=BrowserCalendar.prototype.save;BrowserCalendar.prototype.save=async function(input:any){const result=await original.call(this,input);await new Promise<void>(resolve=>{(window as any).releaseSavedCreation=resolve;});return result;};});await draft(page,'Late original');await page.getByRole('button',{name:'Save event',exact:true}).click();await expect.poll(()=>page.evaluate(async()=>typeof (window as any).releaseSavedCreation)).toBe('function');
 if(leave==='draft'){await page.getByRole('button',{name:'Back to calendar',exact:true}).click();await draft(page,'New draft stays');}else await returnToApps(page);
 await page.evaluate(async()=>(window as any).releaseSavedCreation());await page.waitForTimeout(200);
 if(leave==='draft')await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('New draft stays');else await expect(page.getByRole('button',{name:'Calendar',exact:true})).toBeVisible();expect(await count(page)).toBe(1);
});
test('late recovery cannot clear a newer draft or acknowledge its predecessor silently',async({page})=>{
 await start(page);await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');await new BrowserCalendar().save({creationId:crypto.randomUUID(),calendarId:'local',title:'Receipt waiting',begin:Date.now()+3600000,end:Date.now()+7200000});});await page.reload();await openLocalCalendar(page);await expect(page.getByRole('button',{name:'Check event creation receipts',exact:true})).toBeVisible();
 await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');const original=BrowserCalendar.prototype.pendingCreations;let first=true;BrowserCalendar.prototype.pendingCreations=async function(){if(first){first=false;await new Promise<void>(resolve=>{(window as any).releaseReceiptRecovery=resolve;});}return original.call(this);};});
 await page.getByRole('button',{name:'Check event creation receipts',exact:true}).click();await expect.poll(()=>page.evaluate(async()=>typeof (window as any).releaseReceiptRecovery)).toBe('function');await draft(page,'Recovery must preserve this');await page.evaluate(async()=>(window as any).releaseReceiptRecovery());await page.waitForTimeout(200);await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Recovery must preserve this');expect(await page.evaluate(async()=>Object.values(JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).creations).filter((r:any)=>!r.acknowledged).length)).toBe(1);
});
test('delayed separate-event permission cannot authorize a replacement ordinary draft',async({page})=>{
 await start(page);await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');await new BrowserCalendar().save({creationId:crypto.randomUUID(),calendarId:'local',title:'Prior uncertain UI receipt',begin:Date.now()+3600000,end:Date.now()+7200000});});await page.reload();await openLocalCalendar(page);
 await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');const original=BrowserCalendar.prototype.requestAccess;let first=true;BrowserCalendar.prototype.requestAccess=async function(){if(first){first=false;await new Promise<void>(resolve=>{(window as any).releaseSeparatePermission=resolve;});}return original.call(this);};});page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Create a separate event',exact:true}).click();await expect.poll(()=>page.evaluate(async()=>typeof (window as any).releaseSeparatePermission)).toBe('function');await page.getByRole('button',{name:'Back to calendar',exact:true}).click();await draft(page,'Ordinary replacement');await page.evaluate(async()=>(window as any).releaseSeparatePermission());await page.getByRole('button',{name:'Save event',exact:true}).click();await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Ordinary replacement');expect(await count(page)).toBe(1);
});

test('separate event reports completion only after its own delayed acknowledgement',async({page})=>{
 await start(page);
 const prior=await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');const creationId=crypto.randomUUID();await new BrowserCalendar().save({creationId,calendarId:'local',title:'Prior unresolved event',begin:Date.now()+3600000,end:Date.now()+7200000});return creationId;});
 await page.reload();await openLocalCalendar(page);
 await page.evaluate(async()=>{const {BrowserCalendar}=await import('/src/browser/calendar.ts');const original=BrowserCalendar.prototype.acknowledgeCreation;BrowserCalendar.prototype.acknowledgeCreation=async function(input:any){await new Promise<void>(resolve=>{(window as any).releaseAcknowledgement=resolve;});return original.call(this,input);};});
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Create a separate event',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('Delayed separate event');await page.getByRole('button',{name:'Save event',exact:true}).click();
 await expect.poll(()=>page.evaluate(async()=>typeof (window as any).releaseAcknowledgement)).toBe('function');
 expect(await count(page)).toBe(2);expect(await page.evaluate(async()=>Object.values(JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).creations).filter((r:any)=>!r.acknowledged).length)).toBe(2);
 await expect(page.getByText('Event saved.',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Save event',exact:true})).toHaveCount(0);
 await page.evaluate(async()=>(window as any).releaseAcknowledgement());await expect(page.getByText('Event saved.',{exact:true})).toBeVisible();
 const receipts=await page.evaluate(async()=>JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())!).creations);
 expect(Object.keys(receipts)).toHaveLength(2);expect(receipts[prior].acknowledged).toBe(false);expect(Object.entries(receipts).filter(([id])=>id!==prior).map(([,row]:any)=>row.acknowledged)).toEqual([true]);
 await page.reload();expect(await count(page)).toBe(2);
});

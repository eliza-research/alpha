import {openBrowserCalendar} from './helpers/browser-calendar';
import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const key='alpha.browser.calendar.v1',raw='{broken calendar';
test.beforeEach(async({page})=>{await page.addInitScript(({key,raw})=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));if(!sessionStorage.getItem('calendar-recovery-seed')){localStorage.setItem(key,raw);localStorage.setItem('unrelated-recovery-test','retain');sessionStorage.setItem('calendar-recovery-seed','1');}},{key,raw});await page.goto('/?tools=1');});
async function open(page:any){await page.getByRole('button',{name:'Device controls',exact:true}).click();await page.getByRole('button',{name:'Calendar recovery',exact:true}).click();return page.getByRole('dialog',{name:'App calendar recovery'});}
test('backup preserves damaged bytes and reviewed reset restores an empty usable calendar',async({page},info)=>{
 await openBrowserCalendar(page);await page.getByRole('button',{name:'Recover browser calendar',exact:true}).click();const d=page.getByRole('dialog',{name:'App calendar recovery'});const downloading=page.waitForEvent('download');await d.getByRole('button',{name:'Download calendar backup'}).click();const download=await downloading;expect(await readFile((await download.path())!,'utf8')).toBe(raw);
 await d.getByRole('button',{name:'Reset app calendar',exact:true}).click();expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(raw);await page.screenshot({path:info.outputPath('calendar-recovery.png')});await Promise.all([page.waitForEvent('load'),d.getByRole('button',{name:'Confirm calendar reset',exact:true}).click()]);await expect(d).toHaveCount(0);await expect(page.getByRole('button',{name:'Calendar',exact:true})).toBeVisible();await expect.poll(()=>page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const c=registerPlugin<any>('AlphaCalendar');return (await c.list({begin:Date.now(),end:Date.now()+86400000})).status;})).toBe('ready');expect(await page.evaluate(()=>localStorage.getItem('unrelated-recovery-test'))).toBe('retain');await openBrowserCalendar(page);await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
});
test('another tab changing the saved calendar invalidates the reset confirmation',async({page,context})=>{
 const d=await open(page);await d.getByRole('button',{name:'Reset app calendar',exact:true}).click();const other=await context.newPage();await other.goto(page.url());const replacement=JSON.stringify({sourceRevision:'new-owner',events:[]});await other.evaluate(({key,replacement})=>localStorage.setItem(key,replacement),{key,replacement});await page.bringToFront();await d.getByRole('button',{name:'Confirm calendar reset',exact:true}).click();await expect(d.getByRole('status')).toContainText('Older browser data changed');expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(replacement);
});
test('closing recovery while a transaction holds storage cancels the queued reset',async({page})=>{
 const d=await open(page);
 await page.evaluate(async()=>{
  const database=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('alpha.browser.documents.v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const transaction=database.transaction('documents','readwrite'),store=transaction.objectStore('documents');let holding=true;
  (window as any).releaseRecovery=()=>{holding=false;};
  (window as any).recoveryLock=new Promise<void>((resolve,reject)=>{transaction.oncomplete=()=>{database.close();resolve();};transaction.onabort=()=>{database.close();reject(transaction.error);};});
  const keepAlive=()=>{const request=store.get('calendar-recovery-transaction');request.onsuccess=()=>{(window as any).recoveryEntered=true;if(holding)keepAlive();};};keepAlive();
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).recoveryEntered)).toBe(true);
 await d.getByRole('button',{name:'Reset app calendar',exact:true}).click();await d.getByRole('button',{name:'Confirm calendar reset',exact:true}).click();await expect(d.getByRole('button',{name:'Confirm calendar reset'})).toBeDisabled();await d.getByRole('button',{name:'Close recovery',exact:true}).click();
 await page.evaluate(async()=>{(window as any).releaseRecovery();await (window as any).recoveryLock;});
 expect(await page.evaluate(async()=>(await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw())).toBe(raw);
});
test('failed transaction retains the original and does not claim success',async({page})=>{
 const d=await open(page);await page.evaluate(()=>{IDBObjectStore.prototype.put=function(){throw new DOMException('Blocked','SecurityError');};});await d.getByRole('button',{name:'Reset app calendar',exact:true}).click();await d.getByRole('button',{name:'Confirm calendar reset',exact:true}).click();await expect(d.getByRole('status')).toContainText('Blocked');expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(raw);
});
test('reset renews calendar authority and rejects a proposal bound to the deleted source',async({page})=>{
 const old=await page.evaluate(async(key)=>{const {calendarDocument}=await import('/src/browser/calendar-store.ts');await calendarDocument.readRaw();await calendarDocument.reset(await calendarDocument.capture());const {registerPlugin}=await import('/src/platform-plugins.ts');return registerPlugin<any>('AlphaCalendar').prepareAgentSource();},key);const d=await open(page);await d.getByRole('button',{name:'Reset app calendar',exact:true}).click();await d.getByRole('button',{name:'Confirm calendar reset',exact:true}).click();await expect(d).toHaveCount(0);await expect(page.getByRole('button',{name:'Calendar',exact:true})).toBeVisible();const result=await page.evaluate(async(old)=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const c=registerPlugin<any>('AlphaCalendar'),fresh=await c.prepareAgentSource();const proposal=await c.executeAgent({operationId:crypto.randomUUID(),operation:{type:'calendar_create',source:{sourceId:old.sourceId,sourceRevision:old.sourceRevision},fields:{title:'Retired proposal',description:'',location:'',start:new Date(Date.now()+60000).toISOString(),end:new Date(Date.now()+120000).toISOString(),timeZone:'UTC'}}});return {fresh,old,proposal};},old);expect(result.fresh.sourceRevision).not.toBe(result.old.sourceRevision);expect(result.proposal.status).toBe('conflict');
});
test('a current recovery receipt can reset atomically without Web Locks',async({page})=>{
 const d=await open(page);await page.evaluate(()=>Object.defineProperty(navigator,'locks',{value:undefined,configurable:true}));await expect(d.getByRole('button',{name:'Download calendar backup'})).toBeEnabled();await d.getByRole('button',{name:'Reset app calendar',exact:true}).click();await d.getByRole('button',{name:'Confirm calendar reset',exact:true}).click();await expect(d).toHaveCount(0);expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(raw);expect(await page.evaluate(async()=>{const raw=await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw();return raw===null?[]:JSON.parse(raw).events;})).toEqual([]);
});
test('a newer canonical receipt invalidates reset even when legacy bytes are unchanged',async({page,context})=>{
 const d=await open(page);await d.getByRole('button',{name:'Reset app calendar',exact:true}).click();
 const other=await context.newPage();await other.goto(page.url());await other.evaluate(async()=>{const {calendarDocument}=await import('/src/browser/calendar-store.ts');await calendarDocument.reset(await calendarDocument.capture());});await page.bringToFront();
 await d.getByRole('button',{name:'Confirm calendar reset',exact:true}).click();await expect(d.getByRole('status')).toContainText('saved document changed');expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(raw);
});

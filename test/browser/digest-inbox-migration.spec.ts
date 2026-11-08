import {test,expect,type Page} from '@playwright/test';
async function boot(page:Page){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev');
 await page.evaluate(async()=>{
  const {browserDigestStore}=await import('/src/browser/digest-storage.ts'),{developmentIdentity}=await import('/src/browser/development-identity.ts'),{actionScope}=await import('/src/runtime/device-actions.ts');
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'development',profile:'local'}));
  const owner=developmentIdentity('local'),session={origin:location.origin,ownerId:owner.ownerId,agentId:owner.agentId,sessionId:'test'};
  const f=(window as any).digestFixture={session,slot:'hosted-digests:v1:'+await actionScope(JSON.stringify([session.origin,session.ownerId,session.agentId])),current:true,controller:new AbortController()};
  f.store=await browserDigestStore(session as any,()=>f.current,f.controller.signal);
 });
}
test('empty inbox reads do not create a document',async({page})=>{
 await boot(page);expect(await page.evaluate(async()=>{const f=(window as any).digestFixture;return {value:await f.store.read(f.slot),snapshot:(await f.store.recovery.capture()).snapshot??null};})).toEqual({value:null,snapshot:null});
});
test('two tabs retain all distinct inbox slots in one canonical document',async({page,context})=>{
 await boot(page);const other=await context.newPage();await boot(other);
 await Promise.all([page,other].map((tab,index)=>tab.evaluate(async index=>{const f=(window as any).digestFixture;for(let i=0;i<10;i++)await f.store.write(f.slot+':result-'+index+'-'+i,{text:index+'-'+i});},index)));
 expect(await page.evaluate(async()=>{const f=(window as any).digestFixture,raw=JSON.parse((await f.store.recovery.capture()).raw);return {slots:Object.keys(raw.slots).length,legacy:Object.keys(localStorage).filter(k=>k.startsWith('alpha.browser.hosted-digests:')).length};})).toEqual({slots:20,legacy:0});
 await page.reload();expect(await page.evaluate(async()=>{const {browserDocuments}=await import('/src/browser/documents.ts'),{developmentIdentity}=await import('/src/browser/development-identity.ts'),{actionScope}=await import('/src/runtime/device-actions.ts');const owner=developmentIdentity('local'),prefix='hosted-digests:v1:'+await actionScope(JSON.stringify([location.origin,owner.ownerId,owner.agentId])),document=await browserDocuments.read('alpha.browser.'+prefix+'.document.v1');return Object.keys(JSON.parse(JSON.parse(document!.raw!).value).slots).length;})).toBe(20);
});
test('legacy slot bytes survive migration and a changed older copy refuses further access',async({page})=>{
 await boot(page);expect(await page.evaluate(async()=>{const f=(window as any).digestFixture,key='alpha.browser.'+f.slot,raw='{ "value": "{\\"ids\\":[\\"original\\"]}" }';localStorage.setItem(key,raw);const value=await f.store.read(f.slot),before=await f.store.recovery.capture();await f.store.write(f.slot+':pending',{id:'reviewed'});localStorage.setItem(key,'{damaged');let rejected=false;try{await f.store.read(f.slot);}catch{rejected=true;}const after=await f.store.recovery.capture();return {value,exact:JSON.parse(before.raw).slots[f.slot]===raw,rejected,changed:after.legacyChanged,pending:JSON.parse(JSON.parse(after.raw).slots[f.slot+':pending']).value};})).toEqual({value:{ids:['original']},exact:true,rejected:true,changed:true,pending:'{"id":"reviewed"}'});
});
test('failed inbox commits retain both results and pending recovery bytes',async({page})=>{
 await boot(page);expect(await page.evaluate(async()=>{const f=(window as any).digestFixture;await f.store.write(f.slot,{ids:['retained']});await f.store.write(f.slot+':pending',{id:'reviewed'});const before=await f.store.recovery.capture(),put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='alpha.browser.'+f.slot+'.document.v1')throw Error('Full');return put.call(this,value,key);};let rejected=false;try{await f.store.remove(f.slot+':pending');}catch{rejected=true;}finally{IDBObjectStore.prototype.put=put;}const after=await f.store.recovery.capture();return {rejected,same:JSON.stringify(before.snapshot)===JSON.stringify(after.snapshot),pending:await f.store.read(f.slot+':pending')};})).toEqual({rejected:true,same:true,pending:{id:'reviewed'}});
});
test('a stale inbox recovery capture cannot erase a newly saved result',async({page})=>{
 await boot(page);expect(await page.evaluate(async()=>{const f=(window as any).digestFixture,capture=await f.store.recovery.capture();await f.store.write(f.slot+':new',{text:'Retained'});let rejected=false;try{await f.store.recovery.reset(capture);}catch{rejected=true;}return {rejected,value:await f.store.read(f.slot+':new')};})).toEqual({rejected:true,value:{text:'Retained'}});
});
test('connection retirement during a pending inbox read rejects the late value',async({page})=>{
 await boot(page);expect(await page.evaluate(async()=>{const f=(window as any).digestFixture,{browserDocuments}=await import('/src/browser/documents.ts');await f.store.write(f.slot,{ids:['private']});const read=browserDocuments.read.bind(browserDocuments);let release!:()=>void,queued!:()=>void;const waiting=new Promise<void>(resolve=>queued=resolve);browserDocuments.read=async(...args)=>{const result=await read(...args);if(args[0]==='alpha.browser.'+f.slot+'.document.v1'){queued();await new Promise<void>(resolve=>release=resolve);}return result;};const pending=f.store.read(f.slot).then(()=>false,()=>true);await waiting;f.current=false;f.controller.abort();release();return pending;})).toBe(true);
});
test('damaged inbox archive downloads each exact slot before a reviewed reset',async({page})=>{
 await boot(page);const slot=await page.evaluate(async()=>{const f=(window as any).digestFixture;localStorage.setItem('alpha.browser.'+f.slot,'{damaged index');localStorage.setItem('alpha.browser.'+f.slot+':pending',' {damaged pending ');const {openDomainRecovery}=await import('/src/browser/domain-recovery.ts');openDomainRecovery(f.store.recovery,'digest inbox','Development digest inbox recovery','Download pending requests before resetting.');return f.slot;});
 const dialog=page.getByRole('dialog',{name:'Development digest inbox recovery'}),pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download digest inbox backup',exact:true}).click();const stream=await (await pending).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual({slots:{[slot]:'{damaged index',[slot+':pending']:' {damaged pending '}});
 await dialog.getByRole('button',{name:'Reset app digest inbox',exact:true}).click();await dialog.getByRole('button',{name:'Confirm digest inbox reset',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(async slot=>{const {browserDocuments}=await import('/src/browser/documents.ts'),row=await browserDocuments.read('alpha.browser.'+slot+'.document.v1');return {empty:JSON.parse(row!.raw!).value,legacy:localStorage.getItem('alpha.browser.'+slot)};},slot)).toEqual({empty:null,legacy:'{damaged index'});
});
test('scheduled digests exposes recovery for the selected development inbox',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?mode=dev');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await page.getByRole('button',{name:'Connect development profile'}).click();await page.evaluate(()=>window.dispatchEvent(new Event('alpha:hosted-digests')));
 const panel=page.getByRole('dialog',{name:'Scheduled digests',exact:true});await panel.getByRole('button',{name:'Digest inbox recovery',exact:true}).click();await expect(panel).toHaveCount(0);const recovery=page.getByRole('dialog',{name:'Development digest inbox recovery',exact:true});await expect(recovery).toBeVisible();await expect(recovery.getByText(/does not cancel or restart agent schedules/)).toBeVisible();await recovery.getByRole('button',{name:'Close recovery',exact:true}).click();await expect(recovery).toHaveCount(0);
});

test('a retired connection closes its captured recovery dialog',async({page})=>{
 await boot(page);await page.evaluate(async()=>{const f=(window as any).digestFixture;await f.store.write(f.slot,{ids:['retained']});const {openDomainRecovery}=await import('/src/browser/domain-recovery.ts');openDomainRecovery(f.store.recovery,'digest inbox','Development digest inbox recovery','Selected account only.',f.controller.signal);});const dialog=page.getByRole('dialog',{name:'Development digest inbox recovery'});await expect(dialog.getByRole('button',{name:'Download digest inbox backup',exact:true})).toBeEnabled();await page.evaluate(()=>{const f=(window as any).digestFixture;f.current=false;f.controller.abort();});await expect(dialog).toHaveCount(0);
});

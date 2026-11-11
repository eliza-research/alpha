import {test,expect} from '@playwright/test';
const key='alpha.photos.pending-copy.v1';
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/');});
test('empty read leaves the browser document uninitialized',async({page})=>{
 expect(await page.evaluate(async key=>{const m=await import('/src/runtime/media-copy-intent.ts'),{browserDocuments}=await import('/src/browser/documents.ts');return {intent:await m.readMediaCopyIntent(),stored:!!await browserDocuments.read(key)};},key)).toEqual({intent:null,stored:false});
});
test('two tabs cannot overwrite another pending copy',async({page,context})=>{
 const other=await context.newPage();await other.goto('/');
 const results=await Promise.all([page,other].map((tab,index)=>tab.evaluate(async index=>{const m=await import('/src/runtime/media-copy-intent.ts');try{return {saved:true,intent:await m.admitMediaCopyIntent('copy-'+index)};}catch{return {saved:false};}},index)));
 expect(results.filter(r=>r.saved)).toHaveLength(1);const saved=results.find(r=>r.saved)!.intent;
 expect(await page.evaluate(async()=>(await import('/src/runtime/media-copy-intent.ts')).readMediaCopyIntent())).toEqual(saved);
 expect(await other.evaluate(key=>localStorage.getItem(key),key)).toBeNull();
});
test('old completion cannot clear a replacement with the same operation token',async({page})=>{
 expect(await page.evaluate(async()=>{const m=await import('/src/runtime/media-copy-intent.ts'),first=await m.admitMediaCopyIntent('copy');await m.acknowledgeMediaCopyIntent(first);const next=await m.admitMediaCopyIntent('copy');let conflict=false;try{await m.acknowledgeMediaCopyIntent(first);}catch{conflict=true;}return {conflict,distinct:first.revision!==next.revision,retained:JSON.stringify(await m.readMediaCopyIntent())===JSON.stringify(next)};})).toEqual({conflict:true,distinct:true,retained:true});
});
test('failed acknowledgement retains the exact pending request',async({page})=>{
 expect(await page.evaluate(async key=>{const m=await import('/src/runtime/media-copy-intent.ts'),intent=await m.admitMediaCopyIntent('copy'),put=IDBObjectStore.prototype.put;let failed=false;IDBObjectStore.prototype.put=function(v,k){if(k===key)throw Error('Synthetic storage full');return put.call(this,v,k);};try{await m.acknowledgeMediaCopyIntent(intent);}catch{failed=true;}finally{IDBObjectStore.prototype.put=put;}return {failed,retained:JSON.stringify(await m.readMediaCopyIntent())===JSON.stringify(intent)};},key)).toEqual({failed:true,retained:true});
});
test('legacy token stays exact and a later legacy writer cannot overwrite canonical state',async({page})=>{
 expect(await page.evaluate(async key=>{localStorage.setItem(key,'legacy-copy');const m=await import('/src/runtime/media-copy-intent.ts'),old=await m.readMediaCopyIntent();await m.acknowledgeMediaCopyIntent(old!);const next=await m.admitMediaCopyIntent('new-copy'),domain=await m.mediaCopyIntentDocument(),before=await domain.capture();localStorage.setItem(key,'other-legacy-copy');let refused=false;try{await m.readMediaCopyIntent();}catch{refused=true;}const changed=await domain.capture();return {old,refused,original:JSON.parse(before.legacy!).raw,changed:changed.legacyChanged,canonical:JSON.parse(changed.raw!).raw,token:next.token};},key)).toEqual({old:{token:'legacy-copy'},refused:true,original:'legacy-copy',changed:true,canonical:'new-copy',token:'new-copy'});
});
test('stale reset cannot erase a later admitted copy',async({page})=>{
 expect(await page.evaluate(async()=>{const m=await import('/src/runtime/media-copy-intent.ts'),domain=await m.mediaCopyIntentDocument(),snapshot=await domain.capture(),intent=await m.admitMediaCopyIntent('copy');let refused=false;try{await domain.reset(snapshot);}catch{refused=true;}return {refused,retained:JSON.stringify(await m.readMediaCopyIntent())===JSON.stringify(intent)};})).toEqual({refused:true,retained:true});
});
for(const mode of ['reset','leave'])test(`unreadable saved-copy request recovery: ${mode}`,async({page})=>{
 await page.evaluate(key=>localStorage.setItem(key,' malformed request bytes '),key);await page.getByRole('button',{name:'Photos',exact:true}).click();await page.getByRole('button',{name:'Recover saved-copy request',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Saved-copy recovery'});await expect(dialog).toContainText('Download, then reset.');
 if(mode==='leave'){await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await expect(dialog).toHaveCount(0);expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(' malformed request bytes ');return;}
 const downloaded=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download saved-copy request backup',exact:true}).click();const stream=await(await downloaded).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual({raw:' malformed request bytes '});
 await dialog.getByRole('button',{name:'Reset app saved-copy request',exact:true}).click();await dialog.getByRole('button',{name:'Confirm saved-copy request reset',exact:true}).click();await expect(dialog).toHaveCount(0);expect(await page.evaluate(async()=>(await import('/src/runtime/media-copy-intent.ts')).readMediaCopyIntent())).toBeNull();expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(' malformed request bytes ');
});

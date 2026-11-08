import {localDraftRow} from './inbox-draft-navigation';
import {test,expect,type Page} from '@playwright/test';
const dialog=(page:Page)=>page.getByRole('dialog',{name:'Use selected file in email',exact:true});
async function setup(page:Page,reviewFile=true){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const {Component}=await import('/src/prototype/model.js');
  // Synthetic restartable native-slot stand-in; browser production intentionally has no Inbox secret slots.
  const {inboxLocalStore:s}=await import('/src/runtime/inbox-local-store.ts');
  s.read=async(key:string)=>structuredClone(JSON.parse(sessionStorage.getItem('file-email-slots')||'{}')[key]??null) as any;
  s.compareExchange=async(key:string,prior:unknown,next:unknown)=>{const slots=JSON.parse(sessionStorage.getItem('file-email-slots')||'{}');if(JSON.stringify(slots[key]??null)!==JSON.stringify(prior))return {status:'conflict'} as any;slots[key]=next;sessionStorage.setItem('file-email-slots',JSON.stringify(slots));return {status:'saved'} as any;};
  const {registerPlugin}=await import('/src/platform-plugins.ts');
  const f=(window as any).fileEmail={writes:0,shell:null as any};
  const write=async()=>{f.writes++;throw Error('No provider writes allowed');};
  const client={gmailAccounts:async()=>[{connectionId:'file-grant',label:'owner@example.invalid',connected:true,grantedCapabilities:['google.gmail.triage']}],gmailInboxCapabilities:async()=>({send:false,providerDrafts:false,mailboxMutations:false}),gmailSearch:async()=>({messages:[],syncedAt:'1'}),gmailPrepareOperation:write,gmailDispatchOperation:write};
  c.getCloudClient=()=>({client,sessionId:'file-session'} as any);
  const snapshot={...c.getSnapshot(),cloudAccount:{environment:'production',userId:'file-owner',sessionId:'file-session',credentialId:'fixture'}} as any;c.getSnapshot=()=>snapshot;
  const original=Component.prototype.renderVals;Component.prototype.renderVals=function(){f.shell=this;return original.call(this);};
  const files=registerPlugin<any>('AlphaFiles');if(!(await files.list({})).entries.length)await files.importFile(new File(['Café\nExact bytes'],'selected.txt',{type:'text/plain'}));
 });
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await expect(page.getByRole('button',{name:'Compose',exact:true})).toBeEnabled();
 if(!reviewFile)return;
 await expect.poll(()=>page.evaluate(async()=>{const {VIEWS}=await import('/src/prototype/model.js');return VIEWS.inbox.fileEmailTarget().ready;})).toBe(true);
 await page.evaluate(()=>(window as any).fileEmail.shell.openView('files',{}));
 await page.getByRole('button',{name:'Internal storage',exact:true}).click();
 await page.getByRole('button',{name:'Open selected.txt',exact:true}).click();
 await page.getByRole('button',{name:'Use in email',exact:true}).click();
 await expect(dialog(page)).toContainText('selected.txt · text/plain · 17 bytes');
}
test('selected Files require explicit attachment review, retain exact bytes and never send',async({page})=>{
 await setup(page);const review=dialog(page),insert=review.getByRole('button',{name:'Insert attachment into draft'});
 await expect(insert).toBeDisabled();await expect(review).toContainText('owner@example.invalid');
 await page.screenshot({path:test.info().outputPath('file-email-review.png')});
 await review.getByRole('checkbox',{name:'Attach this file'}).check();await expect(insert).toBeEnabled();
 await review.getByRole('checkbox').uncheck();await expect(insert).toBeDisabled();
 await review.getByRole('button',{name:'Cancel',exact:true}).click();await expect(review).toHaveCount(0);
 await page.getByRole('button',{name:'Use in email',exact:true}).click();await review.getByRole('checkbox').check();await insert.click();
 await expect(review).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Save draft locally',exact:true}).click();
 await expect(page.getByText('Saved locally on this device',{exact:true}).first()).toBeVisible();
 expect(await page.evaluate(()=>(window as any).fileEmail.writes)).toBe(0);
 const saved=()=>page.evaluate(async()=>{const {inboxLocalStore}=await import('/src/runtime/inbox-local-store.ts');return await inboxLocalStore.read<any>('inbox-drafts:v1:'+JSON.stringify(['production','file-owner','','file-grant']));});
 expect((await saved()).attachments).toEqual([{name:'selected.txt',mimeType:'text/plain',dataBase64:Buffer.from('Café\nExact bytes').toString('base64')}]);
 await setup(page,false);await (await localDraftRow(page)).click();
 await expect(page.getByRole('button',{name:'Remove selected.txt',exact:true})).toBeVisible();
 expect((await saved()).attachments[0].dataBase64).toBe(Buffer.from('Café\nExact bytes').toString('base64'));
 await page.getByRole('button',{name:'Remove selected.txt',exact:true}).click();await expect(page.getByRole('list',{name:'Attachments',exact:true})).toHaveCount(0);
});
for(const change of ['account','bytes','revoke'])test(`file attachment review refuses changed ${change}`,async({page})=>{
 await setup(page);await dialog(page).getByRole('checkbox').check();
 await page.evaluate(async change=>{
  if(change==='account'){const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');const old=c.getCloudClient()!;c.getCloudClient=()=>({...old,sessionId:'another-owner'});return;}
  const {registerPlugin}=await import('/src/platform-plugins.ts'),files=registerPlugin<any>('AlphaFiles');
  const row=(await files.list({})).entries.find((item:any)=>item.name==='selected.txt');
  if(change==='bytes'){
   const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('alpha.browser.files.v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   const tx=db.transaction('entries','readwrite'),store=tx.objectStore('entries'),request=store.get(row.id);request.onsuccess=()=>{const changed=new TextEncoder().encode('changed');store.put({...request.result,bytes:changed.buffer,size:changed.length});};await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
  }else await files.delete({id:row.id,expectedRevision:row.revision,confirmPermanent:true});
 },change);
 await dialog(page).getByRole('button',{name:'Insert attachment into draft'}).click();
 await expect(dialog(page).getByRole('status')).toContainText(/changed|unavailable|Select (a valid|this file)/);
 expect(await page.evaluate(()=>(window as any).fileEmail.writes)).toBe(0);
});
test('the same selected bytes cannot be attached twice',async({page})=>{
 await setup(page);await dialog(page).getByRole('checkbox').check();await dialog(page).getByRole('button',{name:'Insert attachment into draft'}).click();
 await expect(page.getByRole('button',{name:'Remove selected.txt',exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).fileEmail.shell.openView('files',{}));
 await page.getByRole('button',{name:'Open selected.txt',exact:true}).click();
 await page.getByRole('button',{name:'Use in email',exact:true}).click();await dialog(page).getByRole('checkbox').check();
 await dialog(page).getByRole('button',{name:'Insert attachment into draft'}).click();
 await expect(dialog(page).getByRole('status')).toContainText('already attached');
 expect(await page.evaluate(()=>(window as any).fileEmail.writes)).toBe(0);
});

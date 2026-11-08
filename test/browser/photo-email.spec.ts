import {test,expect,type Page} from '@playwright/test';
import {photosBridge} from './helpers/photos-bridge';
const dialog=(page:Page)=>page.getByRole('dialog',{name:'Use selected file in email',exact:true});
async function setup(page:Page){
 // Start from Home: Inbox must load its reviewed draft target before Photos hands it a source.
 await photosBridge(page,'full',false);
 await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const {Component}=await import('/src/prototype/model.js');
  // Synthetic restartable native-slot stand-in; browser production intentionally has no Inbox secret slots.
  const {secureConnectionStore:s}=await import('/src/runtime/native-connection.ts');
  s.read=async(key:string)=>structuredClone(JSON.parse(sessionStorage.getItem('file-email-slots')||'{}')[key]??null) as any;
  s.compareExchange=async(key:string,prior:unknown,next:unknown)=>{const slots=JSON.parse(sessionStorage.getItem('file-email-slots')||'{}');if(JSON.stringify(slots[key]??null)!==JSON.stringify(prior))return {status:'conflict'} as any;slots[key]=next;sessionStorage.setItem('file-email-slots',JSON.stringify(slots));return {status:'saved'} as any;};
  const {registerPlugin}=await import('/src/platform-plugins.ts');
  const f=(window as any).fileEmail={writes:0,shell:null as any};
  const write=async()=>{f.writes++;throw Error('No provider writes allowed');};
  const client={gmailAccounts:async()=>[{connectionId:'file-grant',label:'owner@example.invalid',connected:true,grantedCapabilities:['google.gmail.triage']}],gmailInboxCapabilities:async()=>({send:false,providerDrafts:false,mailboxMutations:false}),gmailSearch:async()=>({messages:[],syncedAt:'1'}),gmailPrepareOperation:write,gmailDispatchOperation:write};
  c.getCloudClient=()=>({client,sessionId:'file-session'} as any);
  const snapshot={...c.getSnapshot(),cloudAccount:{environment:'production',userId:'file-owner',sessionId:'file-session',credentialId:'fixture'}} as any;c.getSnapshot=()=>snapshot;
  const original=Component.prototype.renderVals;Component.prototype.renderVals=function(){f.shell=this;return original.call(this);};

 });
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await expect(page.getByRole('button',{name:'Compose',exact:true})).toBeEnabled();

 await expect.poll(()=>page.evaluate(async()=>{const {VIEWS}=await import('/src/prototype/model.js');return VIEWS.inbox.fileEmailTarget().ready;})).toBe(true);
 await page.evaluate(()=>(window as any).fileEmail.shell.openView('photos',{}));
 await page.getByRole('button',{name:/^Photo, /}).click();
 expect(await page.evaluate(()=>(window as any).mediaFixture.calls.filter((c:any)=>c.method==='readPhotoSelected').length)).toBe(0);
 await page.getByRole('button',{name:'Use photo in email',exact:true}).click();
 await expect(dialog(page)).toContainText('source.png');
}
test('Photos source requires separate attachment review and preserves source bytes in local draft',async({page})=>{
 await setup(page);await expect(dialog(page)).toContainText('provider-readable');
 const insert=dialog(page).getByRole('button',{name:'Insert attachment into draft'});await expect(insert).toBeDisabled();
 await page.screenshot({path:test.info().outputPath('photo-email-review.png')});
 await dialog(page).getByRole('checkbox').check();await insert.click();
 await expect(page.getByRole('button',{name:'Remove source.png',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Save draft locally',exact:true}).click();
 await expect(page.getByText('Saved locally on this device',{exact:true}).first()).toBeVisible();
 const saved=await page.evaluate(async()=>{const {secureConnectionStore}=await import('/src/runtime/native-connection.ts');return await secureConnectionStore.read<any>('inbox-drafts:v1:'+JSON.stringify(['production','file-owner','','file-grant']));});
 expect(saved.attachments[0]).toEqual({name:'source.png',mimeType:'image/png',dataBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7l8AAAAASUVORK5CYII='});
 expect(await page.evaluate(()=>(window as any).fileEmail.writes)).toBe(0);
 expect(await page.evaluate(()=>(window as any).mediaFixture.calls.filter((c:any)=>c.method==='readPhotoSelected').length)).toBe(2);
});
for(const change of ['revision','access','owner'])test(`Photos review rejects changed ${change}`,async({page})=>{
 await setup(page);await dialog(page).getByRole('checkbox').check();
 await page.evaluate(async change=>{const f=(window as any).mediaFixture;if(change==='revision')f.row.mutationRevision='changed';else if(change==='access')f.scope='denied';else {const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');const old=c.getCloudClient()!;c.getCloudClient=()=>({...old,sessionId:'other-owner'});}},change);
 await dialog(page).getByRole('button',{name:'Insert attachment into draft'}).click();
 await expect(dialog(page).getByRole('status')).toContainText(/changed|unavailable/);
 expect(await page.evaluate(()=>(window as any).fileEmail.writes)).toBe(0);
 await expect(page.getByRole('button',{name:'Remove source.png',exact:true})).toHaveCount(0);
});

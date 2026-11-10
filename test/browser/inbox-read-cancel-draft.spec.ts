import {seedCompletedAccessSetup} from './flag-off-android';
import {returnToApps} from './app-navigation';
import {localDraftRow} from './inbox-draft-navigation';
import {test,expect} from '@playwright/test';
// Model an existing configured account; permission onboarding has its own acceptance tests.
test.beforeEach(async({context})=>{await context.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));localStorage.setItem('alpha.startup-permissions.v1',JSON.stringify({dismissed:true,attempted:{}}));});});

for(const request of ['Refresh inbox','Search Gmail','Account revalidation'])for(const saved of [false,true])test(`${request==='Account revalidation'?'Late account revalidation after leaving Inbox':'Cancelling '+request} retains ${saved?'edited saved':'unsaved'} local mail`,async({page})=>{
 await page.goto('/');
 await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const {inboxLocalStore:s}=await import('/src/runtime/inbox-local-store.ts');
  const f=(window as any).cancelMail={slots:{},writes:0,hold:false,release:null,aborts:0,mutations:0};
  s.read=async key=>structuredClone(f.slots[key]??null);
  s.compareExchange=async(key,prior,next)=>{if(f.holdSavedWrite&&next?.body==='Original text')await new Promise<void>(resolve=>{f.releaseSavedWrite=()=>{f.holdSavedWrite=false;resolve();};});if(JSON.stringify(f.slots[key]??null)!==JSON.stringify(prior))return {status:'conflict'};f.writes++;f.slots[key]=structuredClone(next);return {status:'saved'};};
  const accounts=[{connectionId:'fixture-grant',label:'Fixture mailbox',connected:true,grantedCapabilities:['google.gmail.triage']}];
  const deferred=(result:any,signal:AbortSignal)=>{if(!f.hold)return Promise.resolve(result);signal.addEventListener('abort',()=>f.aborts++,{once:true});return new Promise(resolve=>{f.release=()=>resolve(result);});};
  const client={gmailAccounts:(signal:AbortSignal)=>deferred(accounts,signal),gmailSearch:(_account:string,_query:string,signal:AbortSignal)=>deferred({messages:[{id:'late',threadId:'late',from:'Late response',to:[],subject:'Must not appear',snippet:'stale',receivedAt:'2026-10-03T12:00:00Z',unread:false}],syncedAt:'late'},signal),gmailInboxCapabilities:async()=>({send:false,providerDrafts:false,mailboxMutations:false}),gmailPrepareOperation:async()=>{f.mutations++;throw Error('No provider mutation expected');}};
  c.getCloudClient=()=>({client,sessionId:'fixture-session',credentialId:'fixture'} as any);
  const snapshot={...c.getSnapshot(),cloudAccount:{environment:'production',userId:'fixture-owner',sessionId:'fixture-session',credentialId:'fixture'}} as any;c.getSnapshot=()=>snapshot;
 });
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await expect(page.getByRole('button',{name:'Refresh inbox',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Compose',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Compose',exact:true}).click();
 await page.getByRole('textbox',{name:'To',exact:true}).fill('fixture@example.invalid');
 await page.getByRole('textbox',{name:'To',exact:true}).press('Enter');
 await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Retained subject');
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Original text');
 if(saved){
  await page.evaluate(()=>(window as any).cancelMail.holdSavedWrite=true);
  await page.getByRole('button',{name:'Save draft locally',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>typeof (window as any).cancelMail.releaseSavedWrite)).toBe('function');
  await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeDisabled();
  await page.evaluate(()=>(window as any).cancelMail.releaseSavedWrite());
  await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeEditable();
 }
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Unsaved important text');
 await page.getByRole('button', {name: 'Cc and Bcc', exact: true}).click();
  await page.getByRole('textbox', {name: 'Cc', exact: true}).fill('copy@example.invalid');
 await page.getByRole('textbox',{name:'Bcc',exact:true}).fill('blind@example.invalid');
 await page.getByRole('button',{name:'Back from draft',exact:true}).click();
 if(request==='Search Gmail'){
  await page.getByRole('button',{name:'Search email',exact:true}).click();
  await page.getByPlaceholder('Search mail').fill('fixture');
 }
 const before=await page.evaluate(()=>JSON.stringify((window as any).cancelMail.slots));
 await page.evaluate(()=>(window as any).cancelMail.hold=true);
 if(request==='Account revalidation')await page.evaluate(()=>window.dispatchEvent(new Event('alpha:google-accounts-changed')));else if(request==='Search Gmail')await page.getByPlaceholder('Search mail').press('Enter');else await page.getByRole('button',{name:request,exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).cancelMail.release)).toBe('function');
 await returnToApps(page);
 await expect(page.getByRole('button',{name:'Inbox',exact:true})).toBeVisible();
 await page.evaluate(async()=>{(window as any).cancelMail.release();(window as any).cancelMail.hold=false;await new Promise(resolve=>setTimeout(resolve,0));});
 await expect(page.getByText('Must not appear',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await (await localDraftRow(page)).click();
 await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Retained subject');
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Unsaved important text');
 await expect(page.getByRole('textbox',{name:'Cc',exact:true})).toHaveValue('copy@example.invalid');
 await expect(page.getByRole('textbox',{name:'Bcc',exact:true})).toHaveValue('blind@example.invalid');
 await expect(page.getByText('fixture@example.invalid',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>JSON.stringify((window as any).cancelMail.slots))).toBe(before);
 // Shared account metadata also serves Home, so it outlives this view. Explicit Inbox reads are cancelled.
 expect(await page.evaluate(()=>({aborts:(window as any).cancelMail.aborts,mutations:(window as any).cancelMail.mutations}))).toEqual({aborts:request==='Account revalidation'?0:1,mutations:0});
});

test('Compose waits for the selected account draft read before accepting a click',async({page})=>{
 await page.goto('/');
 await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const {inboxLocalStore:s}=await import('/src/runtime/inbox-local-store.ts');
  const f=(window as any).draftAdmission={slots:{},release:null,waiting:false};
  s.read=async key=>{
   if(key.startsWith('inbox-drafts:v1:[')&&JSON.parse(key.slice('inbox-drafts:v1:'.length))[3]==='b'){
    f.waiting=true;await new Promise(resolve=>{f.release=resolve;});
   }
   return structuredClone(f.slots[key]??null);
  };
  s.compareExchange=async(key,prior,next)=>{if(JSON.stringify(f.slots[key]??null)!==JSON.stringify(prior))return {status:'conflict'};f.slots[key]=structuredClone(next);return {status:'saved'};};
  const client={gmailSearch:async()=>({messages:[],syncedAt:'fixture',nextPageToken:null}),gmailAccounts:async()=>['a','b'].map(id=>({connectionId:id,label:'Account '+id,connected:true,grantedCapabilities:['google.gmail.triage']})),gmailInboxCapabilities:async()=>({send:false,providerDrafts:false,mailboxMutations:false})};
  c.getCloudClient=()=>({client,sessionId:'fixture-session',credentialId:'fixture'} as any);
  const snapshot={...c.getSnapshot(),cloudAccount:{environment:'production',userId:'fixture-owner',sessionId:'fixture-session',credentialId:'fixture'}} as any;c.getSnapshot=()=>snapshot;
 });
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await expect(page.getByRole('button',{name:'Refresh inbox',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Compose',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Compose',exact:true}).click();
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Account a local draft');
 await page.getByRole('button',{name:'Save draft locally',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Saved locally on this device'})).toBeVisible();
 await page.getByRole('button',{name:'Back from draft',exact:true}).click();
 await page.getByRole('button',{name:'Account b',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).draftAdmission.waiting)).toBe(true);
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Compose',exact:true})).toBeDisabled();
 await page.evaluate(()=>(window as any).draftAdmission.release());
 await expect(page.getByRole('button',{name:'Compose',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Compose',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('');
 expect(await page.evaluate(()=>Object.values((window as any).draftAdmission.slots).map((draft:any)=>draft.body))).toEqual(['Account a local draft']);
});

test.beforeEach(async({page})=>seedCompletedAccessSetup(page));

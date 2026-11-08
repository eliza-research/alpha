import {localDraftRow} from './inbox-draft-navigation';
import {test,expect} from '@playwright/test';
test.beforeEach(async({context})=>{await context.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));});
async function retained(page:any,expected:{body:string;toQ?:string;cc?:string[]},owner='owner-a'){
 await expect.poll(()=>page.evaluate(async owner=>{
  const binding=JSON.stringify(['inbox-unsaved','app',JSON.stringify(['production',owner,'','grant'])]);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(binding))),n=>n.toString(16).padStart(2,'0')).join('');
  const {BrowserJsonDomainDocument}=await import('/src/browser/json-domain-document.ts');
  const row=await new BrowserJsonDomainDocument('alpha.browser.inbox-drafts:v1:unsaved:'+hash).readJson();
  if(!row?.text)return null;
  const value=JSON.parse(row.text);return {body:value.draft.body,toQ:value.toQ,cc:value.draft.cc||[]};
 },owner)).toEqual({toQ:'',cc:[],...expected});
}
async function setup(page:any,owner='owner-a'){
 await page.goto('/');await page.evaluate(async owner=>{
 const {connectionController:c}=await import('/src/runtime/connection-ui.tsx'),{inboxLocalStore:s}=await import('/src/runtime/inbox-local-store.ts');const slots=()=>JSON.parse(localStorage.getItem('test-inbox-saved')||'{}');
 s.read=async key=>structuredClone(slots()[key]??null);s.compareExchange=async(key,expected,value)=>{const data=slots();if(JSON.stringify(data[key]??null)!==JSON.stringify(expected))return {status:'conflict'};if(value===null)delete data[key];else data[key]=value;localStorage.setItem('test-inbox-saved',JSON.stringify(data));return {status:'saved'};};
 const f=(window as any).emailRecoveryFixture={mutations:0};const client={gmailAccounts:async()=>[{connectionId:'grant',label:'Mailbox '+owner,connected:true,grantedCapabilities:['google.gmail.triage']}],gmailInboxCapabilities:async()=>({send:false,providerDrafts:false,mailboxMutations:false}),gmailPrepareOperation:async()=>{f.mutations++;throw Error('Must not prepare provider writes');}};
 c.getCloudClient=()=>({client,sessionId:'session-'+owner} as any);const snapshot={...c.getSnapshot(),cloudAccount:{environment:'production',userId:owner,sessionId:'session-'+owner,credentialId:'fixture'}} as any;c.getSnapshot=()=>snapshot;
 },owner);await page.getByRole('button',{name:'Inbox',exact:true}).click();await expect(page.getByRole('button',{name:'Compose',exact:true})).toBeEnabled();
}
async function begin(page:any){await setup(page);await page.getByRole('button',{name:'Compose',exact:true}).click();await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Retained subject');await page.getByRole('textbox',{name:'Message',exact:true}).fill('Unsent local body');await retained(page,{body:'Unsent local body'});}
test('update readback drains a retired Inbox editor without dispatching mail',async({page})=>{
 await page.goto('/');
 const body=await page.evaluate(async()=>{
  const {inboxUnsaved}=await import('/src/prototype/inbox-unsaved.ts');
  const owner=JSON.stringify(['production','fixture-owner','','fixture-grant']);
  const retired=inboxUnsaved(owner,()=>{},()=>{});
  await retired.ready;
  retired.edit({version:1,owner,baseRevision:null,toQ:'',draft:{
   version:1,id:'draft-fixture',revision:'revision-fixture',owner,to:[],subject:'Draft',body:'Keep after the update',
  }});
  retired.retire();
  await retired.flushForAppUpdate(()=>true);
  const reopened=inboxUnsaved(owner,()=>{},()=>{});
  await reopened.ready;
  return reopened.peek()?.draft.body;
 });
 expect(body).toBe('Keep after the update');
});
test('unsaved body and incomplete address survive reload without provider writes',async({page})=>{
 await begin(page);await page.getByRole('textbox',{name:'To',exact:true}).fill('still-typing@');await page.getByRole('button', {name: 'Cc and Bcc', exact: true}).click();
  await page.getByRole('textbox', {name: 'Cc', exact: true}).fill('unfinished');await retained(page,{body:'Unsent local body',toQ:'still-typing@',cc:['unfinished']});await setup(page);await (await localDraftRow(page)).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Unsent local body');await expect(page.getByRole('textbox',{name:'To',exact:true})).toHaveValue('still-typing@');await expect(page.getByRole('textbox',{name:'Cc',exact:true})).toHaveValue('unfinished');expect(await page.evaluate(()=>(window as any).emailRecoveryFixture.mutations)).toBe(0);
});
test('edits after explicit Save recover separately and clear after the next local save',async({page})=>{
 await begin(page);await page.getByRole('button',{name:'Save draft locally',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Saved locally on this device'})).toBeVisible();await page.getByRole('textbox',{name:'Message',exact:true}).fill('Later unsaved body');await retained(page,{body:'Later unsaved body'});await setup(page);await (await localDraftRow(page)).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Later unsaved body');await page.getByRole('button',{name:'Save draft locally',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Saved locally on this device'})).toBeVisible();await setup(page);await expect(page.getByRole('button',{name:'Resume unsaved email',exact:true})).toHaveCount(0);await (await localDraftRow(page)).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Later unsaved body');
});
test('retained edits remain isolated across Cloud owners',async({page})=>{
 await begin(page);await setup(page,'owner-b');await expect(page.getByRole('button',{name:'Resume unsaved email',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Compose',exact:true}).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('');await page.getByRole('textbox',{name:'Message',exact:true}).fill('Owner B body');await retained(page,{body:'Owner B body'},'owner-b');await setup(page);await (await localDraftRow(page)).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Unsent local body');
});
test('restored edits cannot replace a newer explicitly saved draft',async({page})=>{
 await begin(page);await page.getByRole('button',{name:'Save draft locally',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Saved locally on this device'})).toBeVisible();await page.getByRole('textbox',{name:'Message',exact:true}).fill('Older unsaved edit');await retained(page,{body:'Older unsaved edit'});await page.evaluate(()=>{const data=JSON.parse(localStorage.getItem('test-inbox-saved')!);const key=Object.keys(data)[0];data[key].revision=crypto.randomUUID();data[key].body='Newer explicitly saved body';localStorage.setItem('test-inbox-saved',JSON.stringify(data));});await setup(page);await (await localDraftRow(page)).click();await page.getByRole('button',{name:'Save draft locally',exact:true}).click();await expect(page.getByRole('button',{name:'Use latest saved draft',exact:true})).toBeVisible();expect(await page.evaluate(()=>Object.values<any>(JSON.parse(localStorage.getItem('test-inbox-saved')!))[0].body)).toBe('Newer explicitly saved body');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Use latest saved draft',exact:true}).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Newer explicitly saved body');
});
test('competing windows require review before replacing retained edits',async({page,context})=>{
 await begin(page);const other=await context.newPage();await setup(other);await (await localDraftRow(other)).click();await other.getByRole('textbox',{name:'Message',exact:true}).fill('Newer retained body');await retained(other,{body:'Newer retained body'});await page.getByRole('textbox',{name:'Message',exact:true}).fill('My conflicting body');await expect(page.getByRole('button',{name:'Restore retained email edits',exact:true})).toBeVisible();await page.getByRole('button',{name:'Restore retained email edits',exact:true}).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Newer retained body');
});
test('discard removes the retained copy without creating provider effects',async({page})=>{
 await begin(page);await page.getByRole('button',{name:'Discard local draft',exact:true}).click();await page.getByRole('button',{name:'Keep draft',exact:true}).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Unsent local body');await page.getByRole('button',{name:'Discard local draft',exact:true}).click();await page.getByRole('button',{name:'Discard permanently',exact:true}).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveCount(0);await setup(page);await expect(page.getByRole('button',{name:'Resume unsaved email',exact:true})).toHaveCount(0);expect(await page.evaluate(()=>(window as any).emailRecoveryFixture.mutations)).toBe(0);
});
test('damaged recovery copy can reset without deleting the explicitly saved draft',async({page})=>{
 await begin(page);await page.getByRole('button',{name:'Save draft locally',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Saved locally on this device'})).toBeVisible();await page.getByRole('textbox',{name:'Message',exact:true}).fill('Later edit');await retained(page,{body:'Later edit'});await page.evaluate(async()=>{const owner=JSON.stringify(['production','owner-a','','grant']),binding=JSON.stringify(['inbox-unsaved','app',owner]);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(binding))),n=>n.toString(16).padStart(2,'0')).join('');const {BrowserJsonDomainDocument}=await import('/src/browser/json-domain-document.ts');await new BrowserJsonDomainDocument('alpha.browser.inbox-drafts:v1:unsaved:'+hash).editJson((row:any)=>({...row,text:'{"damaged":true}'}));});await setup(page);await (await localDraftRow(page,'Local draft, Recover email edits')).click();const recovery=page.getByRole('dialog',{name:'Email edit recovery'});await recovery.getByRole('button',{name:'Reset app email edits',exact:true}).click();await Promise.all([page.waitForEvent('load'),recovery.getByRole('button',{name:'Confirm email edits reset',exact:true}).click()]);await setup(page);await (await localDraftRow(page)).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Unsent local body');
});

/** Real rendered Inbox controls, synthetic Cloud/storage boundary; never real mail. */
import assert from 'node:assert/strict';
import type { CloudServiceSession, ConnectionSnapshot } from '../apps/app/src/runtime/connection-ui.tsx';
import type { inboxLocalStore } from '../apps/app/src/runtime/inbox-local-store.ts';
import type { LocalMailDraft } from '../.eliza/client-features/plugins/plugin-inbox/src/mailbox/drafts-controller.ts';
import { playwright } from './fixtures/playwright.ts';
import { inboxMemoryStore } from './fixtures/inbox-memory.ts';
declare global {
 interface Window {
  fixtureRead: typeof inboxLocalStore.read;
  fixtureCAS: typeof inboxLocalStore.compareExchange;
  fixtureOriginalCAS: typeof inboxLocalStore.compareExchange;
  releaseDraftSave?: () => void;
  inboxFixture: {calls: string[]; account: string; session: string; owner: string; snapshot: ConnectionSnapshot & { cloudAccount: CloudServiceSession }};
 }
}
const url=process.env.ALPHA_INBOX_TEST_URL||'http://127.0.0.1:5197';
if(new URL(url).hostname!=='127.0.0.1')throw Error('Local Vite required');
const {chromium}=playwright(import.meta.url),browser=await chromium.launch({headless:true});
const slots=new Map<string, unknown>();let writes=0;
const store=inboxMemoryStore(slots);
const savedDraft = (value: unknown): LocalMailDraft => {
 assert.ok(value && typeof value === 'object' && 'body' in value && typeof value.body === 'string');
 return value as LocalMailDraft;
};
try{
 const page=await browser.newPage({viewport:{width:412,height:915},reducedMotion:'reduce'});page.setDefaultTimeout(10000);await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));localStorage.setItem('alpha.startup-permissions.v1',JSON.stringify({dismissed:true,attempted:{}}));localStorage.setItem('alpha:startup-permission-walkthrough:v1',JSON.stringify({version:1,status:'completed',step:4}));});
 await page.exposeFunction('fixtureRead',store.read);
 await page.exposeFunction('fixtureCAS',(...args: Parameters<typeof store.compareExchange>)=>{writes++;return store.compareExchange(...args);});
 async function setup(){await page.goto(url);await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const {inboxLocalStore:s}=await import('/src/runtime/inbox-local-store.ts');
  s.read=slot=>window.fixtureRead(slot);s.compareExchange=(...args)=>window.fixtureCAS(...args);
  const {CloudProtocol} = await import('/src/runtime/cloud-protocol.ts');
  const cloudAccount: CloudServiceSession = {environment:'production',userId:'fixture-owner',sessionId:'fixture-cloud',credentialId:'fixture-only'};
  window.inboxFixture={calls:[],account:'a',session:cloudAccount.sessionId,owner:cloudAccount.userId,snapshot:{...c.getSnapshot(),cloudAccount}};
  const mail={id:'fixture-message',threadId:'fixture-thread',from:'Synthetic sender',fromEmail:'sender@example.invalid',to:['owner@example.invalid'],subject:'Reply fixture',snippet:'Synthetic',receivedAt:'2026-09-30T00:00:00Z',unread:false};
  const unexpected = async () => { throw Error('Unexpected Cloud operation in synthetic Inbox fixture'); };
  const client = new CloudProtocol('production', unexpected, {read: async () => null, write: unexpected, clear: unexpected}, unexpected);
  client.gmailAccounts=async()=>{window.inboxFixture.calls.push('accounts');const id=window.inboxFixture.account;return [{connectionId:id,label:'Fixture '+id,configured:true,connected:true,reason:'fixture',grantedCapabilities:['google.gmail.triage']}];};
  client.gmailSearch=async()=>{window.inboxFixture.calls.push('search');return {messages:[mail],syncedAt:'fixture-revision',nextPageToken:null,supportsSpamTrash:false};};
  client.gmailRead=async()=>{window.inboxFixture.calls.push('read');return {message:mail,bodyText:'Synthetic message body',historyId:null,links:[],attachments:[]};};
  c.getCloudClient=()=>({client,sessionId:window.inboxFixture.session,credentialId:cloudAccount.credentialId});
  c.getSnapshot=()=>window.inboxFixture.snapshot;
 });await page.getByRole('button',{name:'Inbox',exact:true}).and(page.locator('[data-mobile-shell-tile]')).click();await page.getByRole('button',{name:'Refresh inbox',exact:true}).waitFor();}
 const compose=()=>page.getByRole('button',{name:'Compose',exact:true});
 const firstDraft=()=>savedDraft(slots.values().next().value);
 const switchAccount=(account: string, session: string)=>page.evaluate(({account,session})=>{
  const fixture=window.inboxFixture;
  fixture.account=account;fixture.session=session;
  fixture.snapshot={...fixture.snapshot,cloudAccount:{...fixture.snapshot.cloudAccount,sessionId:session}};
  window.dispatchEvent(new Event('alpha:google-accounts-changed'));
 }, {account,session});
 const reopenLocalDraft=async()=>{await page.getByRole('button',{name:'Other mail folders',exact:true}).click();await page.getByRole('menuitemradio',{name:'Drafts',exact:true}).click();await page.getByRole('button',{name:/^Local draft,/}).first().click();};
 await setup();await compose().click();await page.getByRole('textbox',{name:'To',exact:true}).fill('literal@example.invalid');await page.getByRole('textbox',{name:'To',exact:true}).press('Enter');await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Private fixture draft');await page.getByRole('textbox',{name:'Message',exact:true}).fill('Exact local body\nsecond line');
 await page.getByRole('button',{name:'Save draft locally',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved locally on this device'}).waitFor();assert.equal(slots.size,1);assert.equal(firstDraft().body,'Exact local body\nsecond line');
 assert.equal(await page.getByRole('button',{name:'Send email',exact:true}).isDisabled(),true);assert.equal(slots.size,1);
 await setup();await reopenLocalDraft();assert.equal(await page.getByRole('textbox',{name:'Message',exact:true}).inputValue(),'Exact local body\nsecond line');
 await page.getByRole('button',{name:'Discard local draft',exact:true}).click();await page.getByRole('button',{name:'Keep draft',exact:true}).click();assert.equal(slots.size,1);
 await page.getByRole('button',{name:'Back from draft',exact:true}).click();await switchAccount('b','fixture-cloud-b');await page.waitForFunction(()=>!document.querySelector('textarea[aria-label="Message"]'));await page.getByRole('button',{name:'Refresh inbox',exact:true}).waitFor();await compose().click();assert.equal(await page.getByRole('textbox',{name:'Message',exact:true}).inputValue(),'');
 await page.getByRole('button',{name:'Discard local draft',exact:true}).click();await page.getByRole('button',{name:'Discard permanently',exact:true}).click();await page.getByRole('button',{name:'Refresh inbox',exact:true}).waitFor();assert.equal(slots.size,1,'B discard cannot erase A');
 await switchAccount('a','fixture-cloud');await reopenLocalDraft();await page.getByRole('button',{name:'Discard local draft',exact:true}).click();await page.getByRole('button',{name:'Discard permanently',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('textarea[aria-label="Message"]'));assert.equal(slots.size,0);
 await page.getByRole('button',{name:'Inbox',exact:true}).click(); await page.getByRole('button',{name:'Synthetic sender, Reply fixture',exact:true}).click();await page.getByRole('button',{name:'Reply',exact:true}).click();await page.getByRole('textbox',{name:'Message',exact:true}).fill('Reply draft only');await page.getByRole('button',{name:'Save draft locally',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved locally on this device'}).waitFor();assert.deepEqual(firstDraft().reply,{messageId:'fixture-message',threadId:'fixture-thread'});
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Keep edits after storage failure');
 await page.evaluate(async()=>{const {inboxLocalStore:s}=await import('/src/runtime/inbox-local-store.ts');window.fixtureOriginalCAS=s.compareExchange;s.compareExchange=async()=>{throw Error('Synthetic unavailable');};});
 await page.getByRole('button',{name:'Save draft locally',exact:true}).click();await page.getByRole('status').filter({hasText:'Local draft update failed'}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Message',exact:true}).inputValue(),'Keep edits after storage failure');assert.equal(firstDraft().body,'Reply draft only');
 await page.evaluate(async()=>{(await import('/src/runtime/inbox-local-store.ts')).inboxLocalStore.compareExchange=window.fixtureOriginalCAS;});
 await page.getByRole('button',{name:'Save draft locally',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved locally on this device'}).waitFor();
 const [key,old]=[...slots.entries()][0];slots.set(key,{...savedDraft(old),revision:'other-window-revision',body:'Other window committed'});
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Stale window edit');await page.getByRole('button',{name:'Save draft locally',exact:true}).click();await page.getByRole('status').filter({hasText:'Draft changed in another window'}).waitFor();assert.equal(savedDraft(slots.get(key)).body,'Other window committed');assert.equal(await page.getByRole('textbox',{name:'Message',exact:true}).inputValue(),'Stale window edit');
 slots.clear();await setup();await reopenLocalDraft();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Use latest saved draft',exact:true}).click();await compose().click();await page.getByRole('textbox',{name:'Message',exact:true}).fill('Original owner late save');
 await page.evaluate(async()=>{const {inboxLocalStore:s}=await import('/src/runtime/inbox-local-store.ts');const original=s.compareExchange;s.compareExchange=async(...args)=>{await new Promise<void>(resolve=>window.releaseDraftSave=resolve);return original(...args);};});
 await page.getByRole('button',{name:'Save draft locally',exact:true}).click();await page.waitForFunction(()=>!!window.releaseDraftSave);
 await page.evaluate(async()=>{window.inboxFixture.session='replacement-session';window.inboxFixture.owner='replacement-owner';window.inboxFixture.snapshot={...window.inboxFixture.snapshot,cloudAccount:{...window.inboxFixture.snapshot.cloudAccount,userId:'replacement-owner',sessionId:'replacement-session'}};(await import('/src/runtime/connection-ui.tsx')).connectionController.close();});
 await page.getByRole('button',{name:'Refresh inbox',exact:true}).waitFor().catch(async error=>{throw Error(error.message+' Controls: '+JSON.stringify(await page.locator('button').evaluateAll(bs=>bs.map(b=>b.getAttribute('aria-label')||b.textContent))));});await compose().click();assert.equal(await page.getByRole('textbox',{name:'Message',exact:true}).inputValue(),'');await page.getByRole('textbox',{name:'Message',exact:true}).fill('Replacement owner unsaved');
 await page.evaluate(()=>{if (!window.releaseDraftSave) throw Error('Expected a pending draft save');window.releaseDraftSave();});await page.waitForTimeout(150);assert.equal(await page.getByRole('textbox',{name:'Message',exact:true}).inputValue(),'Replacement owner unsaved');assert.equal(slots.size,1);assert.ok([...slots.keys()][0].includes('fixture-owner'));assert.equal(firstDraft().body,'Original owner late save');
 assert.ok((await page.evaluate(()=>window.inboxFixture.calls)).every(x=>['accounts','read','search'].includes(x)));assert.ok(writes>=4);
 console.log('PASS rendered compose/save/reload/restore/exact body/account isolation/discard cancel/confirm/reply identity/storage failure/retry/CAS conflict/late account-switch save; synthetic provider and storage, zero provider writes.');
}finally{await browser.close();}

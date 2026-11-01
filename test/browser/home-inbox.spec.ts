import {seedCompletedAccessSetup} from './flag-off-android';
import {test,expect,type Page} from '@playwright/test';
import {returnToApps} from './app-navigation';

const tile=(page:Page)=>page.getByRole('region',{name:'Home',exact:true}).locator('[data-alpha-home-inbox]');
async function fixture(page:Page,theme='light'){
// Model an existing configured account; permission onboarding has its own acceptance tests.
 await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));localStorage.setItem('alpha.startup-permissions.v1',JSON.stringify({dismissed:true,attempted:{}}));});
 await page.goto('/?theme='+theme);
 await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx'),{secureConnectionStore:s}=await import('/src/runtime/native-connection.ts');
  s.read=async()=>null;
  const f=(window as any).homeInboxFixture={owner:'a',reads:0,accountReads:0,hold:false,fail:false,more:false,rows:[
   {id:'unread-a',threadId:'thread-a',subject:'Synthetic quarterly planning subject',from:'Synthetic sender A',to:[],snippet:'Private body preview must stay out of Home',receivedAt:'2026-10-09T00:00:00Z',unread:true},
   {id:'read',threadId:'thread-read',subject:'Already read email',from:'Synthetic sender B',to:[],snippet:'',receivedAt:'2026-10-09T00:00:00Z',unread:false},
   {id:'unread-b',threadId:'thread-b',subject:'Synthetic second subject',from:'Synthetic sender C',to:[],snippet:'',receivedAt:'2026-10-09T00:00:00Z',unread:true}]};
  const client={gmailAccounts:async()=>{f.accountReads++;return f.accounts??[{connectionId:'grant-'+f.owner,label:'Synthetic mailbox '+f.owner,connected:true,grantedCapabilities:['google.gmail.triage']}];},
   gmailSearch:(account:string,query:string,signal:AbortSignal,limit:number)=>{f.reads++;const rows=structuredClone(f.rows),fail=f.fail,more=f.more,owner=f.owner;(f.requests??=[]).push({account,query,limit});signal.addEventListener('abort',()=>{(f.aborted??=[]).push(owner);},{once:true});const response=(async()=>{if(f.hold)await new Promise<void>(resolve=>{f.release=resolve;(f.releases??={})[owner]=resolve;});if(fail)throw Error('Synthetic provider unavailable');return {messages:rows,syncedAt:'fixture',nextPageToken:more?'next-fixture-page':null};})();(f.responses??={})[owner]=response.then(()=>{},()=>{});return response;},
   gmailRead:async()=>{f.bodyReads=(f.bodyReads??0)+1;throw Error('No body read in Home fixture');},gmailInboxCapabilities:async()=>({send:false,providerDrafts:false,mailboxMutations:false})};
  c.getCloudClient=()=>({client,sessionId:'fixture-'+f.owner,credentialId:f.credential??'fixture-only'} as any);
  const original=c.getSnapshot(),snapshots=new Map();c.getSnapshot=()=>{const key=JSON.stringify([f.owner,f.omitOrg,f.credential]);if(!snapshots.has(key))snapshots.set(key,{...original,cloudAccount:{environment:'production',userId:'fixture-'+f.owner,...(f.omitOrg?{}:{organizationId:'fixture-org'}),sessionId:'fixture-'+f.owner,credentialId:f.credential??'fixture-only'}});return snapshots.get(key);};
 });
}
async function load(page:Page){await page.getByRole('button',{name:'Inbox',exact:true}).click();await expect(page.getByRole('button',{name:'Refresh inbox',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/Unread, Synthetic sender A/})).toBeVisible();await returnToApps(page);}

for(const theme of ['light','dark'])test(`Home Inbox uses cached unread subjects and aligned text: ${theme}`,async({page},info)=>{
 await fixture(page,theme);await load(page);const card=tile(page);await card.scrollIntoViewIfNeeded();
 await expect(card).toHaveAttribute('aria-label','Open Inbox: 2 unread emails');await expect(card).toContainText('2 unread');await expect(card).toContainText('Synthetic quarterly planning subject');await expect(card).toContainText('Synthetic second subject');
 await expect(card).not.toContainText('Already read email');await expect(card).not.toContainText('Private body preview');await expect(card).not.toContainText('View email accounts');
 expect(await card.locator('[aria-hidden="true"]').count()).toBe(1);
 expect(await card.evaluate(el=>{const card=el.getBoundingClientRect(),header=el.firstElementChild!,icon=header.lastElementChild!.getBoundingClientRect(),subjects=el.querySelector('[data-alpha-home-inbox-subjects]')!.getBoundingClientRect();return {iconRight:Math.round(card.right-icon.right),textLeft:Math.round(subjects.left-card.left),overflow:el.scrollWidth-el.clientWidth};})).toEqual({iconRight:22,textLeft:22,overflow:0});
 const before=await page.evaluate(()=>({reads:(window as any).homeInboxFixture.reads,accounts:(window as any).homeInboxFixture.accountReads}));await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).fill('Unsent rerender');await expect(card).toContainText('Synthetic second subject');expect(await page.evaluate(()=>({reads:(window as any).homeInboxFixture.reads,accounts:(window as any).homeInboxFixture.accountReads}))).toEqual(before);
 await page.screenshot({path:info.outputPath('home-inbox-'+theme+'.png'),animations:'disabled'});
});

test('Home Inbox distinguishes complete empty results from partial loaded results',async({page})=>{
 await fixture(page);await page.evaluate(()=>{const f=(window as any).homeInboxFixture;f.rows=[];f.more=true;});await page.getByRole('button',{name:'Inbox',exact:true}).click();await expect(page.getByText('Your Inbox is empty',{exact:true})).toBeVisible();await returnToApps(page);await expect(tile(page)).toContainText('Recent email');await expect(tile(page)).not.toContainText('No unread');
 await page.evaluate(()=>{(window as any).homeInboxFixture.more=false;});await page.getByRole('button',{name:'Inbox',exact:true}).click();await page.getByRole('button',{name:'Refresh inbox',exact:true}).click();await expect(page.getByText('Your Inbox is empty',{exact:true})).toBeVisible();await returnToApps(page);await expect(tile(page)).toContainText('No unread email');await expect(tile(page).locator('[data-alpha-home-inbox-subjects]')).toHaveCount(0);
});

test('Home Inbox offers Connect email before a connection and never reads mail',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));localStorage.setItem('alpha.startup-permissions.v1',JSON.stringify({dismissed:true,attempted:{}}));});await page.goto('/');await expect(tile(page)).toContainText('Connect email');await expect(tile(page)).not.toContainText('View email accounts');await expect(tile(page)).not.toContainText('No unread');
});

test('Home Inbox retains failure and retires cached subjects on owner change',async({page})=>{
 await fixture(page);await load(page);await page.getByRole('button',{name:'Inbox',exact:true}).click();await expect(page.getByRole('button',{name:/Unread, Synthetic sender A/})).toBeVisible();await page.evaluate(()=>(window as any).homeInboxFixture.fail=true);await page.getByRole('button',{name:'Refresh inbox',exact:true}).click();await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();await returnToApps(page);await expect(tile(page)).toContainText('Open to retry');await expect(tile(page)).not.toContainText('No unread');
 await page.evaluate(async()=>{(window as any).homeInboxFixture.owner='b';(await import('/src/runtime/connection-ui.tsx')).connectionController.close();});await expect(tile(page)).not.toContainText('Synthetic quarterly planning subject');await expect(tile(page)).not.toContainText('2 unread');
});

test('Home Inbox does not publish a cancelled delayed load as empty or fetched',async({page})=>{
 await fixture(page);await page.evaluate(()=>(window as any).homeInboxFixture.hold=true);await page.getByRole('button',{name:'Inbox',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof(window as any).homeInboxFixture.release)).toBe('function');await returnToApps(page);await expect(tile(page)).toContainText('Open to load email');await expect(tile(page)).not.toContainText('No unread');await page.evaluate(()=>(window as any).homeInboxFixture.release());await expect(tile(page).locator('[data-alpha-home-inbox-subjects]')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).homeInboxFixture.reads)).toBe(1);
});

for(const scenario of ['recent','expired','owner-change-during-restore'] as const)test(`Home restores only its own saved Inbox while one background header read is pending: ${scenario}`,async({page})=>{
 await fixture(page);await load(page);
 await expect.poll(()=>page.evaluate(async()=>{
  const {serviceReadCache}=await import('/src/runtime/service-read-cache-store.ts');
  const cache=await serviceReadCache({environment:'production',userId:'fixture-a',organizationId:'fixture-org',credentialId:'fixture-only'});
  return !!(await cache.get('gmail:mailbox'));
 })).toBe(true);
 if(scenario==='expired')await page.evaluate(async()=>{
  const {serviceReadCache}=await import('/src/runtime/service-read-cache-store.ts');
  const cache=await serviceReadCache({environment:'production',userId:'fixture-a',organizationId:'fixture-org',credentialId:'fixture-only'});
  const saved=await cache.get<any>('gmail:mailbox');
  for(const row of saved!.value.lists)row.at=Date.now()-31*86400000;
  await cache.put('gmail:mailbox',saved!.value);
 });
 await fixture(page);
 await page.evaluate(async hold=>{
  const {serviceReadCache}=await import('/src/runtime/service-read-cache-store.ts');
  const cache=await serviceReadCache({environment:'production',userId:'fixture-a',organizationId:'fixture-org',credentialId:'fixture-only'}),read=cache.get.bind(cache),f=(window as any).homeInboxFixture;
  f.cacheReads=0;f.hold=true;
  cache.get=async function<T>(key:string){const saved=await read<T>(key);if(key==='gmail:mailbox'){f.cacheReads++;if(hold)await new Promise<void>(resolve=>f.releaseCache=resolve);}return saved;};
  (await import('/src/runtime/connection-ui.tsx')).connectionController.close();
 },scenario==='owner-change-during-restore');
 await expect.poll(()=>page.evaluate(()=>(window as any).homeInboxFixture.cacheReads)).toBe(1);
 if(scenario==='owner-change-during-restore')await page.evaluate(async()=>{
  const f=(window as any).homeInboxFixture;f.owner='b';(await import('/src/runtime/connection-ui.tsx')).connectionController.close();f.releaseCache();
 });
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 if(scenario!=='recent'){
  await expect(tile(page)).not.toContainText('Synthetic quarterly planning subject');
  await expect(tile(page)).not.toContainText('2 unread');
  await expect(tile(page)).not.toContainText('No unread');
 }else{
  await expect(tile(page)).toContainText('Synthetic quarterly planning subject');
  await expect(tile(page)).toContainText('2 unread');
  await page.evaluate(async()=>{(window as any).homeInboxFixture.owner='b';(await import('/src/runtime/connection-ui.tsx')).connectionController.close();});
  await expect(tile(page)).not.toContainText('Synthetic quarterly planning subject');
  await expect(tile(page)).not.toContainText('2 unread');
 }
 await expect.poll(()=>page.evaluate(()=>(window as any).homeInboxFixture.reads)).toBeGreaterThan(0);
 expect(await page.evaluate(()=>(window as any).homeInboxFixture.bodyReads??0)).toBe(0);
 // Settings can still check authorization while Home's metadata-only read is held.
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).homeInboxFixture.accountReads)).toBeGreaterThan(1);
 await returnToApps(page);
 expect(await page.evaluate(()=>(window as any).homeInboxFixture.bodyReads??0)).toBe(0);
});

// This Inbox fixture owns an existing installation, not fresh permission prompts.
test.beforeEach(async({page})=>seedCompletedAccessSetup(page));

const notifyHomeOwner=(page:Page)=>page.evaluate(async()=>{(await import('/src/runtime/connection-ui.tsx')).connectionController.close();});

test('Home loads one current Inbox header summary before Inbox is opened, without bodies or rerender reads',async({page})=>{
 await fixture(page);await notifyHomeOwner(page);
 await expect(tile(page)).toContainText('Synthetic quarterly planning subject');
 expect(await page.evaluate(()=>{const f=(window as any).homeInboxFixture;return {reads:f.reads,accounts:f.accountReads,bodies:f.bodyReads??0,requests:f.requests};})).toEqual({reads:1,accounts:1,bodies:0,requests:[{account:'grant-a',query:'in:inbox',limit:25}]});
 await notifyHomeOwner(page);await notifyHomeOwner(page);
 await page.getByRole('textbox',{name:'Ask Alpha',exact:true}).fill('Unsent Home rerender');
 await expect(tile(page)).toContainText('Synthetic quarterly planning subject');
 expect(await page.evaluate(()=>{const f=(window as any).homeInboxFixture;return [f.reads,f.accountReads,f.bodyReads??0];})).toEqual([1,1,0]);
});

test('opening Inbox consumes the same in-flight Home discovery and header page',async({page})=>{
 await fixture(page);await page.evaluate(()=>(window as any).homeInboxFixture.hold=true);await notifyHomeOwner(page);
 await expect.poll(()=>page.evaluate(()=>typeof(window as any).homeInboxFixture.release)).toBe('function');
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await page.evaluate(()=>(window as any).homeInboxFixture.release());
 await expect(page.getByRole('button',{name:/Unread, Synthetic sender A/})).toBeVisible();
 expect(await page.evaluate(()=>{const f=(window as any).homeInboxFixture;return [f.reads,f.accountReads];})).toEqual([1,1]);
});

for(const failOld of [false,true])test(`Home retires another owner's delayed ${failOld?'failure':'success'} without publishing it`,async({page})=>{
 await fixture(page);await page.evaluate(fail=>{const f=(window as any).homeInboxFixture;f.hold=true;f.fail=fail;},failOld);await notifyHomeOwner(page);
 await expect.poll(()=>page.evaluate(()=>typeof(window as any).homeInboxFixture.releases?.a)).toBe('function');
 await page.evaluate(()=>{const f=(window as any).homeInboxFixture;f.owner='b';f.fail=false;f.rows=f.rows.map((m:any)=>({...m,subject:'Owner B current summary'}));});await notifyHomeOwner(page);
 await expect.poll(()=>page.evaluate(()=>typeof(window as any).homeInboxFixture.releases?.b)).toBe('function');
 await page.evaluate(()=>(window as any).homeInboxFixture.releases.b());
 await expect(tile(page)).toContainText('Owner B current summary');
 await page.evaluate(async()=>{const f=(window as any).homeInboxFixture;f.releases.a();await f.responses.a;
  // The real warmup awaits this same response; its synchronous acceptance/catch runs before this continuation.
  await new Promise<void>(resolve=>queueMicrotask(resolve));});
 await expect.poll(()=>page.evaluate(()=>(window as any).homeInboxFixture.aborted)).toContain('a');
 await expect(tile(page)).not.toContainText('Synthetic quarterly planning subject');await expect(tile(page)).toContainText('Owner B current summary');
 expect(await page.evaluate(()=>(window as any).homeInboxFixture.bodyReads??0)).toBe(0);
});

for(const policy of ['ambiguous','revoked-choice','no-read-grant'] as const)test(`Home does not silently choose a mailbox: ${policy}`,async({page})=>{
 await fixture(page);await page.evaluate(async policy=>{
  const f=(window as any).homeInboxFixture,account={connectionId:'grant-a',label:'First account',connected:true,grantedCapabilities:['google.gmail.triage']};
  f.accounts=policy==='ambiguous'?[account,{...account,connectionId:'grant-b',label:'Second account'}]:policy==='no-read-grant'?[{...account,grantedCapabilities:[]}]:[account];
  if(policy==='revoked-choice'){const {saveGmailAccountChoice}=await import('/src/runtime/gmail-account-selection.ts');saveGmailAccountChoice((await import('/src/runtime/connection-ui.tsx')).connectionController.getSnapshot().cloudAccount,'missing-grant');}
 },policy);await notifyHomeOwner(page);
 await expect.poll(()=>page.evaluate(()=>(window as any).homeInboxFixture.accountReads)).toBe(1);
 await expect(tile(page)).not.toContainText('No unread');await expect(tile(page)).not.toContainText('Synthetic quarterly planning subject');
 expect(await page.evaluate(()=>(window as any).homeInboxFixture.reads)).toBe(0);
});

test('Home header warmup preserves existing saved body and folder bytes',async({page})=>{
 await fixture(page);await load(page);
 const before=await page.evaluate(async()=>{
  const {serviceReadCache}=await import('/src/runtime/service-read-cache-store.ts'),cache=await serviceReadCache({environment:'production',userId:'fixture-a',organizationId:'fixture-org',credentialId:'fixture-only'});
  const saved=await cache.get<any>('gmail:mailbox'),value=saved!.value;
  value.bodies=[{key:'retained-offline-body',at:Date.now(),body:{message:value.lists[0].messages[0],bodyText:'Exact retained offline body'}}];
  value.lists.push({...structuredClone(value.lists[0]),key:'retained-sent-folder',query:'in:sent'});
  await cache.put('gmail:mailbox',value);return JSON.stringify((await cache.get('gmail:mailbox'))!.value);
 });
 await fixture(page);await page.evaluate(()=>{const f=(window as any).homeInboxFixture;f.rows=f.rows.map((m:any)=>({...m,subject:'Fresh headers after retained cache'}));});
 await notifyHomeOwner(page);await expect(tile(page)).toContainText('Fresh headers after retained cache');
 expect(await page.evaluate(async()=>{const {serviceReadCache}=await import('/src/runtime/service-read-cache-store.ts'),cache=await serviceReadCache({environment:'production',userId:'fixture-a',organizationId:'fixture-org',credentialId:'fixture-only'});return JSON.stringify((await cache.get('gmail:mailbox'))!.value);})).toBe(before);
 expect(await page.evaluate(()=>(window as any).homeInboxFixture.bodyReads??0)).toBe(0);
});

for(const bindingChange of ['no-organization','new-credential'] as const)test(`Home uses Cloud owner authority independently from optional cache eligibility: ${bindingChange}`,async({page})=>{
 await fixture(page);await page.evaluate(change=>{const f=(window as any).homeInboxFixture;if(change==='no-organization')f.omitOrg=true;},bindingChange);await notifyHomeOwner(page);
 await expect(tile(page)).toContainText('Synthetic quarterly planning subject');
 if(bindingChange==='new-credential'){
  await page.evaluate(()=>{const f=(window as any).homeInboxFixture;f.credential='replacement-credential';f.rows=f.rows.map((m:any)=>({...m,subject:'New credential headers'}));});await notifyHomeOwner(page);
  await expect(tile(page)).toContainText('New credential headers');await expect(tile(page)).not.toContainText('Synthetic quarterly planning subject');
 }
 expect(await page.evaluate(()=>(window as any).homeInboxFixture.bodyReads??0)).toBe(0);
});

test('a foreground metadata recheck withdraws a revoked read grant without fetching a page',async({page})=>{
 await fixture(page);await notifyHomeOwner(page);await expect(tile(page)).toContainText('Synthetic quarterly planning subject');
 await page.evaluate(()=>{const f=(window as any).homeInboxFixture;f.accounts=[{connectionId:'grant-a',label:'Revoked mailbox',connected:true,grantedCapabilities:[]}];const now=Date.now;Date.now=()=>now()+61000;document.dispatchEvent(new Event('visibilitychange'));});
 await expect.poll(()=>page.evaluate(()=>(window as any).homeInboxFixture.accountReads)).toBe(2);
 await expect(tile(page)).not.toContainText('Synthetic quarterly planning subject');await expect(tile(page)).not.toContainText('No unread');
 expect(await page.evaluate(()=>(window as any).homeInboxFixture.reads)).toBe(1);
 expect(await page.evaluate(()=>(window as any).homeInboxFixture.bodyReads??0)).toBe(0);
});

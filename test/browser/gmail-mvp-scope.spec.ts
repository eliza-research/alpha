import {openLegacyNotes} from './helpers/legacy-notes';
import {returnToApps} from './app-navigation';
import {guardCalendarFixture as guardNoMedia} from './calendar-draft-readiness';
import {test,expect,type Page} from '@playwright/test';
test.beforeEach(async({context,page})=>{await guardNoMedia(context);await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,route=>route.abort());});
// Gmail MVP flows against a controlled provider-boundary fixture: no real account, OAuth or mail.
type Options={accounts?:string[];readState?:boolean;pages?:Record<string,number>;deferPaging?:boolean};
async function setup(page:Page,options:Options={}){
 // Provider fixtures use local apps; they do not perform resident/Cloud onboarding.
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await page.evaluate(async options=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const {inboxLocalStore:s}=await import('/src/runtime/inbox-local-store.ts');
  const {CloudProtocolError}=await import('/src/runtime/cloud-protocol.ts');
  const w=window as any,slots:Record<string,unknown>={};w.gmSlots=slots;
  s.read=async(key:string)=>structuredClone(slots[key]??null) as any;
  s.compareExchange=async(key:string,prior:unknown,next:unknown)=>{if(JSON.stringify(slots[key]??null)!==JSON.stringify(prior))return {status:'conflict'};if(next===null)delete slots[key];else slots[key]=structuredClone(next);return {status:'saved'};};
  const f=w.gm={searches:[] as any[],prepares:[] as any[],dispatches:[] as any[],disconnects:[] as string[],fail:null as any,failCursor:false,stale:false,gate:null as Promise<void>|null,dispatchState:'succeeded',accountReads:0,accountGate:null as Promise<void>|null,accountFailure:false,
   accounts:(options.accounts||['owner@example.test']).map((label,i)=>({connectionId:'grant-'+i,label,configured:true,connected:true,reason:'connected',grantedCapabilities:['google.gmail.triage','google.gmail.send','google.gmail.mailbox']}))};
  const mail=(id:string,extra:Record<string,unknown>={})=>({id,threadId:'thread-'+id,subject:'Subject '+id,from:'Sender '+id,fromEmail:'sender@example.test',to:['owner@example.test'],cc:[],replyTo:null,snippet:'Preview '+id,receivedAt:'2026-10-06T12:00:00Z',unread:false,...extra});
  const inbox=Array.from({length:options.pages?.inbox??1},(_,page)=>[mail('in-'+page+'-a',{unread:page===0}),mail('in-'+page+'-b')]);
  const store:Record<string,any[][]>={'in:inbox':inbox,'in:sent':[[mail('sent-a',{to:['friend@example.test'],subject:'Sent subject'})]]};
  const all=()=>Object.values(store).flat(2);
  const digest=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
  const receipts:Record<string,any>={};
  let deferredPage=false;
  const client={
   gmailAccounts:async()=>{f.accountReads++;if(f.accountGate)await f.accountGate;if(f.accountFailure)throw Error('Network offline');return structuredClone(f.accounts);},
   gmailInboxCapabilities:async()=>({version:1,from:'owner@example.test',threads:true,send:false,providerDrafts:false,mailboxMutations:true,attachments:true,providerExactlyOnce:false,atomicDraftReplacement:false,readState:options.readState!==false}),
   gmailSearch:async(grant:string,query:string,_signal:AbortSignal,size:number,pageToken?:string)=>{
    f.searches.push({grant,query,size,pageToken:pageToken??null});
    if(pageToken&&options.deferPaging&&!deferredPage){deferredPage=true;await new Promise<void>((resolve,reject)=>{(f as any).releasePage=resolve;_signal.addEventListener('abort',()=>reject(_signal.reason),{once:true});});_signal.throwIfAborted();}
    if(f.fail){const kind=f.fail;f.fail=null;if(kind==='offline')throw new TypeError('Failed to fetch');throw new CloudProtocolError('http',kind);}
    if(pageToken&&f.failCursor){f.failCursor=false;throw new CloudProtocolError('http',400,{error:'Invalid Gmail page token.'});}
    const pages=store[query]||[[]],index=pageToken?Number(pageToken.split(':')[1]):0;
    return {messages:pages[index]||[],syncedAt:'sync',nextPageToken:index+1<pages.length?'cursor:'+(index+1):null};
   },
   gmailRead:async(_grant:string,id:string)=>({message:all().find(m=>m.id===id),bodyText:'Body of '+id,historyId:'h-'+id,attachments:[]}),
   gmailThread:async(_grant:string,threadId:string)=>{const message=all().find(m=>m.threadId===threadId);return {messages:[{message,bodyText:'Body of '+message.id,historyId:'h-'+message.id,attachments:[]}],total:1,offset:0,historyId:'thread-history',nextOffset:null};},
   gmailPrepareOperation:async(_grant:string,requestId:string,proposal:any)=>{
    f.prepares.push(proposal);
    if(f.stale){f.stale=false;throw new CloudProtocolError('http',409,{error:'Selected message changed; review its current labels'});}
    const review={kind:proposal.kind,messageId:proposal.messageId,expectedHistoryId:proposal.expectedHistoryId,from:'owner@example.test'};
    const receipt={requestId,kind:proposal.kind,state:'prepared',reviewDigest:await digest(JSON.stringify(review)),providerResult:null,rejectionCode:null};
    receipts[requestId]=receipt;return {receipt,review};
   },
   gmailDispatchOperation:async(_grant:string,requestId:string,reviewDigest:string,proposal:any)=>{
    f.dispatches.push(proposal);
    if(f.gate)await f.gate;
    if(f.dispatchState!=='succeeded'){const receipt={...receipts[requestId],state:f.dispatchState,providerResult:null,reviewDigest};receipts[requestId]=receipt;return receipt;}
    const receipt={...receipts[requestId],state:'succeeded',providerResult:{messageId:proposal.messageId,labelIds:[],historyId:'h2-'+proposal.messageId,...(proposal.kind.startsWith('mark-')?{unread:proposal.kind==='mark-unread'}:{})},reviewDigest};
    receipts[requestId]=receipt;return receipt;
   },
   gmailOperation:async(_grant:string,requestId:string)=>receipts[requestId],
   disconnectGmail:async(id:string)=>{f.disconnects.push(id);f.accounts=f.accounts.map((a:any)=>a.connectionId===id?{...a,connected:false,reason:'disconnected',grantedCapabilities:[]}:a);},
   initiateGmail:async()=>{throw Error('No live OAuth in fixture');},
  };
  c.getCloudClient=()=>({client,sessionId:'fixture-cloud',credentialId:'fixture'} as any);
  const snapshot={...c.getSnapshot(),cloudAccount:{environment:'production',userId:'fixture-owner',sessionId:'fixture-cloud',credentialId:'fixture'}} as any;c.getSnapshot=()=>snapshot;
 },options);
}
const gm=(page:Page)=>page.evaluate(()=>(window as any).gm);
// The Home app grid is the shared mobile shell's (prototype/home-shell.ts); its tile marks unread with this badge.
const inboxBadge=(page:Page)=>page.getByRole('button',{name:'Inbox',exact:true}).locator('[data-mobile-shell-tile-badge]');

for(const scenario of ['connected','empty','error','restored'] as const)test(`Shared email waits for Gmail account readiness: ${scenario}`,async({page})=>{
 await setup(page);
 await page.evaluate(async scenario=>{
  const w=window as any,f=w.gm;f.originalAccounts=structuredClone(f.accounts);
  if(scenario==='restored'){
   const {connectionController:c}=await import('/src/runtime/connection-ui.tsx'),{serviceReadCache}=await import('/src/runtime/service-read-cache-store.ts');
   const snapshot={...c.getSnapshot(),cloudAccount:{...c.getSnapshot().cloudAccount!,organizationId:'fixture-org'}};c.getSnapshot=()=>snapshot as any;
   const cache=await serviceReadCache({environment:'production',userId:'fixture-owner',organizationId:'fixture-org',credentialId:'fixture'});
   await cache.put('gmail:mailbox',{accounts:f.accounts,selected:'grant-0',spamTrashSearch:false,lists:[{at:Date.now(),messages:[],query:'in:inbox',cursor:null,revision:'saved',cursors:[],newerMail:false,status:'Your Inbox is empty'}],bodies:[]});
   const read=cache.get.bind(cache);f.restoreReads=0;f.restoreGate=new Promise<void>(resolve=>f.releaseAccounts=resolve);
   cache.get=async function<T>(key:string){const row=await read<T>(key);if(key==='gmail:mailbox'){f.restoreReads++;await f.restoreGate;}return row;};
  }else f.accountGate=new Promise<void>(resolve=>f.releaseAccounts=resolve);
 },scenario);
 await openLegacyNotes(page);await page.getByRole('button',{name:'New note',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Waiting shared note');await page.getByRole('textbox',{name:'Note',exact:true}).fill('Exact retained shared body');
 await page.getByRole('button',{name:'Share note',exact:true}).click();await page.getByRole('button',{name:'Share to email',exact:true}).click();
 await expect.poll(async()=>{const f=await gm(page);return scenario==='restored'?f.restoreReads:f.accountReads;}).toBeGreaterThan(0);
 await expect(page.getByText('Checking Gmail connection…',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Connect Gmail',exact:true})).toHaveCount(0);
 await expect(page.getByText(/Shared content is ready for a new email\. Connect Gmail/)).toHaveCount(0);
 expect((await gm(page)).prepares).toEqual([]);expect((await gm(page)).dispatches).toEqual([]);
 await page.evaluate(scenario=>{const f=(window as any).gm;if(scenario==='empty')f.accounts=[];if(scenario==='error')f.accountFailure=true;f.accountGate=null;f.releaseAccounts();},scenario);
 if(scenario==='empty'){
  await expect(page.getByRole('button',{name:'Connect Gmail',exact:true})).toBeVisible();
  await expect(page.getByText('Shared content is ready for a new email. Connect Gmail to continue; nothing has been sent.',{exact:true})).toBeVisible();
  await page.evaluate(()=>{const f=(window as any).gm;f.accounts=f.originalAccounts;window.dispatchEvent(new Event('alpha:google-accounts-changed'));});
 }else if(scenario==='error'){
  await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();
  await expect(page.getByText('You appear to be offline. Gmail was not reached. Retry when you are connected.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Connect Gmail',exact:true})).toHaveCount(0);
  await expect(page.getByText('Checking Gmail connection…',{exact:true})).toHaveCount(0);
  await page.evaluate(()=>(window as any).gm.accountFailure=false);await page.getByRole('button',{name:'Retry',exact:true}).click();
 }
 await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Waiting shared note');
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Waiting shared note\n\nExact retained shared body');
 expect((await gm(page)).prepares).toEqual([]);expect((await gm(page)).dispatches).toEqual([]);
 if(scenario==='restored')expect((await gm(page)).accountReads).toBe(0);
});

test('Inbox loads on open, pages with Load more, shows Sent and drives the unread badge',async({page})=>{
 await setup(page,{pages:{inbox:2}});
 await expect(inboxBadge(page)).toHaveCount(0);
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await expect(page.getByRole('button',{name:'Unread, Sender in-0-a, Subject in-0-a',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Load more',exact:true}).click();
 await expect(page.getByText('Subject in-1-b',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Load more',exact:true})).toHaveCount(0);
 expect((await gm(page)).searches.map((s:any)=>[s.query,s.pageToken])).toEqual([['in:inbox',null],['in:inbox','cursor:1']]);
 await page.getByRole('button',{name:'Sent',exact:true}).click();
 await expect(page.getByRole('button',{name:'To: friend@example.test, Sent subject',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Sent',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Inbox',exact:true}).first().click();
 await expect(page.getByRole('region',{name:'Inbox',exact:true}).getByText('Subject in-0-a',{exact:true})).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));
 await expect(inboxBadge(page)).toHaveCount(1);
 expect((await gm(page)).dispatches).toEqual([]);
});

test('opening an unread message marks it read once through a reviewed operation and can mark it unread',async({page})=>{
 await setup(page);
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await page.getByRole('button',{name:'Unread, Sender in-0-a, Subject in-0-a',exact:true}).click();
 await expect(page.getByRole('button',{name:'Mark unread',exact:true})).toBeVisible();
 expect((await gm(page)).dispatches).toEqual([{kind:'mark-read',messageId:'in-0-a',expectedHistoryId:'h-in-0-a'}]);
 await page.getByRole('button',{name:'Mark unread',exact:true}).click();
 await expect(page.getByRole('button',{name:'Mark read',exact:true})).toBeVisible();
 expect((await gm(page)).dispatches.at(-1)).toEqual({kind:'mark-unread',messageId:'in-0-a',expectedHistoryId:'h2-in-0-a'});
 await page.getByRole('button',{name:'Back to inbox',exact:true}).click();
 await expect(page.getByRole('button',{name:'Unread, Sender in-0-a, Subject in-0-a',exact:true})).toBeVisible();
});

test('without the read-state capability opening a message changes nothing',async({page})=>{
 await setup(page,{readState:false});
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await page.getByRole('button',{name:'Unread, Sender in-0-a, Subject in-0-a',exact:true}).click();
 await expect(page.getByText('Body of in-0-a',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/^Mark (un)?read$/})).toHaveCount(0);
 expect((await gm(page)).prepares).toEqual([]);
});

test('swipe left opens the reviewed archive flow and dispatches only after confirmation',async({page})=>{
 await setup(page);
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 const row=page.getByRole('button',{name:'Sender in-0-b, Subject in-0-b',exact:true});
 const box=(await row.boundingBox())!;
 await page.mouse.move(box.x+box.width-80,box.y+box.height/2);await page.mouse.down();
 await page.mouse.move(box.x+80,box.y+box.height/2,{steps:6});await page.mouse.up();
 const review=page.getByRole('dialog',{name:'Review mail operation',exact:true});
 await expect(review).toContainText('Archive message');
 await expect(page.getByText('Body of in-0-b',{exact:true})).toHaveCount(0);
 expect((await gm(page)).prepares).toEqual([{kind:'archive',messageId:'in-0-b',expectedHistoryId:'h-in-0-b'}]);
 expect((await gm(page)).dispatches).toEqual([]);
 await review.getByRole('button',{name:'Confirm this change',exact:true}).click();
 await expect(review).toContainText('Provider confirmed this operation.');
 expect((await gm(page)).dispatches).toEqual([{kind:'archive',messageId:'in-0-b',expectedHistoryId:'h-in-0-b'}]);
 await review.getByRole('button',{name:'Close mail review',exact:true}).click();
 await expect(row).toHaveCount(0);
});

test('a stale archive review is discarded and retried against the current message, never dispatched',async({page})=>{
 await setup(page);
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await page.getByRole('button',{name:'Sender in-0-b, Subject in-0-b',exact:true}).click();
 await page.evaluate(()=>(window as any).gm.stale=true);
 await page.getByRole('button',{name:'Archive',exact:true}).click();
 const review=page.getByRole('dialog',{name:'Review mail operation',exact:true});
 await expect(review.getByRole('status')).toContainText('changed in Gmail since it was loaded');
 await review.getByRole('button',{name:'Retry with the current message',exact:true}).click();
 await expect(review).toHaveCount(0);
 await expect(page.getByText('Body of in-0-b',{exact:true})).toBeVisible();
 expect((await gm(page)).dispatches).toEqual([]);
});

for(const [kind,text] of [['offline',/offline/],[409,/revoked or needs authorization/],[503,/unavailable right now/]] as const)test(`Inbox read failure ${kind} explains itself and retries only when asked`,async({page})=>{
 await setup(page);
 await page.evaluate(kind=>{(window as any).gm.fail=kind;},kind);
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await expect(page.getByText(text)).toBeVisible();
 if(kind===409)await expect(page.getByRole('button',{name:'Reconnect Gmail',exact:true})).toBeVisible();
 expect((await gm(page)).searches.length).toBe(1);
 await page.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(page.getByText('Subject in-0-b',{exact:true})).toBeVisible();
 expect((await gm(page)).searches.length).toBe(2);
});

test('Settings disconnect asks first and Inbox then shows the honest disconnected state',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await expect(page.getByRole('region',{name:'Inbox',exact:true}).getByText('Subject in-0-a',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Back to apps',exact:true}).click();await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Connections',exact:true}).click();
 const disconnect=page.getByRole('button',{name:'Disconnect Google account owner@example.test',exact:true});await expect(disconnect).toBeVisible();
 page.once('dialog',dialog=>dialog.dismiss());await disconnect.click();expect((await gm(page)).disconnects).toEqual([]);
 page.once('dialog',dialog=>{expect(dialog.message()).toContain('including Gmail and Calendar');expect(dialog.message()).toContain('mail and calendar events are not deleted');void dialog.accept();});await disconnect.click();
 await expect(disconnect).toHaveCount(0);expect((await gm(page)).disconnects).toEqual(['grant-0']);
 await page.getByRole('button',{name:'Open Inbox',exact:true}).click();await expect(page.getByText('Subject in-0-a',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Refresh inbox',exact:true})).toHaveCount(0);
});

test('Settings Connections disconnects one confirmed account and reports the read-back',async({page})=>{
 await setup(page,{accounts:['first@example.test','second@example.test']});
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Connections',exact:true}).click();
 await expect(page.getByRole('button',{name:'Disconnect Google account second@example.test',exact:true})).toBeVisible();
 page.once('dialog',dialog=>{expect(dialog.message()).toContain('Calendar');return dialog.accept();});
 await page.getByRole('button',{name:'Disconnect Google account second@example.test',exact:true}).click();
 await expect(page.getByText(/second@example\.test is disconnected/).first()).toBeVisible();
 await expect(page.getByRole('button',{name:'Disconnect Google account second@example.test',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Disconnect Google account first@example.test',exact:true})).toBeVisible();
 expect((await gm(page)).disconnects).toEqual(['grant-1']);
});

test('Share by email from Notes opens a prefilled local draft without sending',async({page})=>{
 await setup(page);
 await openLegacyNotes(page);
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Shared plan');
 await page.getByRole('textbox',{name:'Note',exact:true}).fill('First line\nSecond line');
 await page.getByRole('button',{name:'Share note',exact:true}).click();
 await page.getByRole('button',{name:'Share to email',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Shared plan');
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Shared plan\n\nFirst line\nSecond line');
 await expect(page.getByRole('status').filter({hasText:'nothing has been sent'})).toBeVisible();
 expect((await gm(page)).prepares).toEqual([]);
});

test('compose From switcher moves a new email to another connected account',async({page})=>{
 await setup(page,{accounts:['first@example.test','second@example.test']});
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await expect(page.getByRole('button',{name:'Refresh inbox',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Compose',exact:true}).click();
 await expect(page.getByRole('button',{name:'From account',exact:true})).toContainText('From first@example.test');
 await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Moving subject');
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Moving body');
 await page.getByRole('button',{name:'From account',exact:true}).click();
 await expect(page.getByRole('button',{name:'From account',exact:true})).toContainText('From second@example.test');
 await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Moving subject');
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Moving body');
 await expect(page.getByRole('status').filter({hasText:'From changed to second@example.test'})).toBeVisible();
 expect((await gm(page)).prepares).toEqual([]);
});

test('single-account compose has no From switcher',async({page})=>{
 await setup(page);
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await expect(page.getByRole('button',{name:'Refresh inbox',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Compose',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'From account',exact:true})).toHaveCount(0);
});

test('re-opening Inbox reuses its verified cached list instead of showing an empty mailbox',async({page})=>{
 await setup(page);
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await expect(page.getByText('Subject in-0-b',{exact:true})).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await expect(page.getByText('Subject in-0-b',{exact:true})).toBeVisible();
 expect((await gm(page)).searches.map((s:any)=>s.pageToken)).toEqual([null]);
});

test('mark-read is sent once per message even when it is reopened during or after an unconfirmed outcome',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{const f=(window as any).gm;f.gate=new Promise<void>(resolve=>{f.release=resolve;});f.dispatchState='outcome-unknown';});
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 const row=page.getByRole('button',{name:'Unread, Sender in-0-a, Subject in-0-a',exact:true});
 await row.click();
 await expect(page.getByText('Body of in-0-a',{exact:true})).toBeVisible();
 await expect.poll(async()=>(await gm(page)).dispatches.length).toBe(1);
 await page.getByRole('button',{name:'Back to inbox',exact:true}).click();
 await row.click();
 await expect(page.getByText('Body of in-0-a',{exact:true})).toBeVisible();
 await page.evaluate(()=>(window as any).gm.release());
 await page.getByRole('button',{name:'Back to inbox',exact:true}).click();
 await expect(row).toBeVisible();
 await row.click();
 await expect(page.getByText('Body of in-0-a',{exact:true})).toBeVisible();
 await page.waitForTimeout(200);
 const f=await gm(page);
 expect(f.prepares).toEqual([{kind:'mark-read',messageId:'in-0-a',expectedHistoryId:'h-in-0-a'}]);
 expect(f.dispatches).toEqual([{kind:'mark-read',messageId:'in-0-a',expectedHistoryId:'h-in-0-a'}]);
});

test('a failed Load more drops the stale cursor and Retry reloads from the first page without duplicates',async({page})=>{
 await setup(page,{pages:{inbox:2},deferPaging:true});
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await expect(page.getByText('Subject in-0-b',{exact:true})).toBeVisible();
 await page.waitForFunction(()=>!!(window as any).gm.releasePage);await page.evaluate(()=>{(window as any).gm.failCursor=true;(window as any).gm.releasePage();});
 await page.getByRole('button',{name:'Load more',exact:true}).click();
 await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();
 await expect(page.getByText('Subject in-0-b',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Load more',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Retry',exact:true}).click();
 await page.getByRole('button',{name:'Load more',exact:true}).click();
 await expect(page.getByText('Subject in-1-b',{exact:true})).toBeVisible();
 await expect(page.getByText('Subject in-0-b',{exact:true})).toHaveCount(1);
 expect((await gm(page)).searches.map((s:any)=>s.pageToken)).toEqual([null,'cursor:1',null,'cursor:1']);
});

test('From switcher returns the email to its account when the other account already has a local draft',async({page})=>{
 await setup(page,{accounts:['first@example.test','second@example.test']});
 await page.evaluate(()=>{const owner=JSON.stringify(['production','fixture-owner','','grant-1']);(window as any).gmSlots['inbox-drafts:v1:'+owner]={version:1,id:'saved-1',revision:'rev-1',owner,to:[],subject:'Second saved',body:'Kept'};});
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await expect(page.getByRole('button',{name:'Refresh inbox',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Compose',exact:true}).click();
 await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Stays subject');
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Stays body');
 await page.getByRole('button',{name:'From account',exact:true}).click();
 await expect(page.getByText(/already has a local draft, so this email stays with first@example\.test/).first()).toBeVisible();
 await expect(page.getByRole('button',{name:'From account',exact:true})).toContainText('From first@example.test');
 await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Stays subject');
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Stays body');
 const f=await gm(page);expect(f.prepares).toEqual([]);
 expect((await page.evaluate(()=>(window as any).gmSlots['inbox-drafts:v1:'+JSON.stringify(['production','fixture-owner','','grant-1'])])).subject).toBe('Second saved');
});

for(const saved of [false,true])test(`Share to email opens a new populated draft and preserves ${saved?'saved':'unsaved'} earlier email`,async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await expect(page.getByRole('button',{name:'Compose',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Compose',exact:true}).click();
 await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Earlier email');
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Earlier exact body');
 if(saved){await page.getByRole('button',{name:'Save draft locally',exact:true}).click();await expect(page.getByText('Saved locally on this device',{exact:true}).first()).toBeVisible();}
 await page.getByRole('button',{name:'Back from draft',exact:true}).click();await returnToApps(page);
 await openLegacyNotes(page);await page.getByRole('button',{name:'New note',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Shared selected note');
 await page.getByRole('textbox',{name:'Note',exact:true}).fill('First line\nSecond line');
 await page.getByRole('button',{name:'Share note',exact:true}).click();await page.getByRole('button',{name:'Share to email',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Shared selected note');
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Shared selected note\n\nFirst line\nSecond line');
 expect((await gm(page)).prepares).toEqual([]);expect((await gm(page)).dispatches).toEqual([]);
 await page.getByRole('button',{name:'Back from draft',exact:true}).click();await page.getByRole('button',{name:'Other mail folders',exact:true}).click();await page.getByRole('menuitemradio',{name:'Drafts',exact:true}).click();
 await page.getByRole('button',{name:'Local draft, Earlier email',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Earlier email');
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Earlier exact body');
 expect((await gm(page)).dispatches).toEqual([]);
});

for(const destination of ['another account','Home'] as const)test(`Shared email is retired when leaving for ${destination} during local preservation`,async({page})=>{
 await setup(page,{accounts:['owner@example.test','second@example.test']});await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await expect(page.getByRole('button',{name:'Compose',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Compose',exact:true}).click();
 await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Keep earlier email');await page.getByRole('textbox',{name:'Message',exact:true}).fill('Keep earlier body');
 await page.getByRole('button',{name:'Back from draft',exact:true}).click();await returnToApps(page);
 await openLegacyNotes(page);await page.getByRole('button',{name:'New note',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Retired share');await page.getByRole('textbox',{name:'Note',exact:true}).fill('Must not insert later');
 await page.evaluate(async()=>{
  const {inboxLocalStore:s}=await import('/src/runtime/inbox-local-store.ts');const cas=s.compareExchange.bind(s),w=window as any;
  s.compareExchange=async(key,prior,next)=>{if(key.startsWith('inbox-drafts:v1:shelf:')){w.shareShelfHeld=true;await new Promise<void>(resolve=>w.releaseShareShelf=resolve);}return cas(key,prior,next);};
 });
 await page.getByRole('button',{name:'Share note',exact:true}).click();await page.getByRole('button',{name:'Share to email',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).shareShelfHeld===true)).toBe(true);
 if(destination==='another account'){
  await page.getByRole('button',{name:'second@example.test',exact:true}).click();
  await expect.poll(async()=>(await gm(page)).searches.at(-1)?.grant).toBe('grant-1');
 }else await returnToApps(page);
 await page.evaluate(()=>(window as any).releaseShareShelf());
 // Observe completion of the held storage write, rather than adding a sleep.
 await expect.poll(()=>page.evaluate(()=>Object.entries((window as any).gmSlots).some(([key,value]:[string,any])=>key.startsWith('inbox-drafts:v1:shelf:')&&value?.items?.some((row:any)=>row.draft.subject==='Keep earlier email')))).toBe(true);
 if(destination==='Home')await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveCount(0);
 if(destination==='another account')await page.getByRole('button',{name:'owner@example.test',exact:true}).click();
 await page.getByRole('button',{name:'Other mail folders',exact:true}).click();await page.getByRole('menuitemradio',{name:'Drafts',exact:true}).click();
 await page.getByRole('button',{name:'Local draft, Keep earlier email',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Keep earlier email');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Keep earlier body');
 expect((await gm(page)).prepares).toEqual([]);expect((await gm(page)).dispatches).toEqual([]);
});

test('Share to email preserves earlier edits when local preservation conflicts',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Inbox',exact:true}).click();await expect(page.getByRole('button',{name:'Compose',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Compose',exact:true}).click();await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Conflict protected email');await page.getByRole('textbox',{name:'Message',exact:true}).fill('Protected exact body');
 await page.getByRole('button',{name:'Back from draft',exact:true}).click();await returnToApps(page);await openLegacyNotes(page);await page.getByRole('button',{name:'New note',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Refused share');await page.getByRole('textbox',{name:'Note',exact:true}).fill('Never replaces earlier email');
 await page.evaluate(async()=>{const {inboxLocalStore:s}=await import('/src/runtime/inbox-local-store.ts');const cas=s.compareExchange.bind(s);s.compareExchange=async(key,prior,next)=>key.startsWith('inbox-drafts:v1:shelf:')?{status:'conflict'}:cas(key,prior,next);});
 await page.getByRole('button',{name:'Share note',exact:true}).click();await page.getByRole('button',{name:'Share to email',exact:true}).click();
 await expect(page.getByText('Drafts changed in another window. Reload before continuing.',{exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Other mail folders',exact:true}).click();await page.getByRole('menuitemradio',{name:'Drafts',exact:true}).click();await page.getByRole('button',{name:'Local draft, Conflict protected email',exact:true}).click();await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Conflict protected email');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Protected exact body');
 expect((await gm(page)).prepares).toEqual([]);expect((await gm(page)).dispatches).toEqual([]);
});

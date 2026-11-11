import {test,expect,type Page} from '@playwright/test';

// Rendered Inbox against a synthetic managed provider: Drafts/Archive/Trash folders, provider draft
// editing and the rule that nothing is sent or saved remotely without the explicit review.
async function install(page:Page,caps:Record<string,unknown>){
 await page.goto('/');
 await page.evaluate(async caps=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const {inboxLocalStore:s}=await import('/src/runtime/inbox-local-store.ts');
  const f=(window as any).folderFixture={slots:{} as Record<string,unknown>,searches:[] as string[],drafts:0,draftReads:[] as string[],prepared:[] as any[],dispatches:0};
  s.read=async(key:string)=>structuredClone(f.slots[key]??null);
  s.compareExchange=async(key:string,prior:unknown,next:unknown)=>{if(JSON.stringify(f.slots[key]??null)!==JSON.stringify(prior))return {status:'conflict'};f.slots[key]=structuredClone(next);return {status:'saved'};};
  const message=(id:string,subject:string)=>({id,threadId:'t-'+id,from:'Synthetic sender',fromEmail:'sender@example.invalid',to:['owner@example.invalid'],subject,snippet:'Synthetic',receivedAt:'2026-10-01T12:00:00Z',unread:false});
  const digest=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
  const client={
   gmailAccounts:async()=>[{connectionId:'fixture-grant',label:'Fixture mailbox',connected:true,grantedCapabilities:['google.gmail.triage']}],
   gmailInboxCapabilities:async()=>({version:1,from:'owner@example.invalid',threads:false,send:true,providerDrafts:true,mailboxMutations:true,attachments:true,providerExactlyOnce:false,atomicDraftReplacement:false,readState:false,draftsList:false,forwardAttachments:false,opaqueAttachments:false,searchTrash:false,attachmentPolicy:{maximumOutgoing:1,maximumBytes:5242880,maximumTotalBytes:5242880},...caps}),
   gmailSearch:async(_g:string,query:string)=>{f.searches.push(query);return {messages:query==='in:archive'?[message('a1','Archived fixture')]:query==='in:trash'?[message('t1','Trashed fixture')]:[message('i1','Inbox fixture')],syncedAt:'2026-10-08T12:00:00Z',nextPageToken:null};},
   gmailRead:async(_g:string,id:string)=>({message:message(id,'Inbox fixture'),bodyText:'Synthetic body',historyId:'mail-r1',links:[]}),
   gmailThread:async(_g:string,threadId:string)=>{f.threadReads=(f.threadReads||0)+1;return {offset:0,historyId:'thread-r1',nextOffset:null,total:2,messages:[{message:message('earlier','Inbox fixture'),bodyText:'Earlier message body',historyId:'mail-r0'},{message:message('i1','Inbox fixture'),bodyText:'Stale thread body',historyId:'mail-r0'}]};},
   gmailDrafts:async()=>{f.drafts++;return {drafts:[{draftId:'draft-1',messageId:'dm-1',subject:'Quarterly plan',to:['friend@example.invalid'],snippet:'Draft text',updatedAt:'2026-10-07T10:00:00Z'},{draftId:'draft-2',messageId:'dm-2',subject:'Re: Thread reply',to:['friend@example.invalid'],snippet:'',updatedAt:null}],nextPageToken:null};},
   gmailDraftContent:async(_g:string,draftId:string)=>{f.draftReads.push(draftId);return {draftId,messageId:'dm',providerDigest:(draftId==='draft-1'?'a':'b').repeat(64),to:['friend@example.invalid'],cc:[],bcc:[],subject:draftId==='draft-1'?'Quarterly plan':'Re: Thread reply',bodyText:'Draft text',threaded:draftId!=='draft-1',attachmentCount:0,plainText:true};},
   gmailPrepareOperation:async(_g:string,requestId:string,proposal:any)=>{f.prepared.push(structuredClone(proposal));const review={...proposal,from:'owner@example.invalid',attachments:[]};return {receipt:{requestId,kind:proposal.kind,state:'prepared',reviewDigest:await digest(JSON.stringify(review)),providerResult:null,rejectionCode:null},review};},
   gmailDispatchOperation:async()=>{f.dispatches++;throw Error('No dispatch expected');},
   gmailOperation:async()=>{throw Error('No receipt');},
  };
  c.getCloudClient=()=>({client,sessionId:'fixture-session',credentialId:'fixture'} as any);
  const snapshot={...c.getSnapshot(),cloudAccount:{environment:'production',userId:'fixture-owner',sessionId:'fixture-session',credentialId:'fixture'}} as any;c.getSnapshot=()=>snapshot;
 },caps);
 await page.getByRole('button',{name:'Inbox',exact:true}).click();
 await expect(page.getByRole('button',{name:'Refresh inbox',exact:true})).toBeVisible();
}
const fixture=(page:Page)=>page.evaluate(()=>(window as any).folderFixture);

test('Older servers offer only the query-based Archive folder',async({page})=>{
 await install(page,{});
 await expect(page.getByRole('button',{name:'Archive',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Drafts',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Trash',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Archive',exact:true}).click();
 await expect(page.getByText('Archived fixture',{exact:true})).toBeVisible();
 expect((await fixture(page)).searches.at(-1)).toBe('in:archive');
});

test('Drafts, Archive and Trash load their lists; a Gmail draft opens for editing and saves only through review',async({page})=>{
 await install(page,{draftsList:true,searchTrash:true});
 // Folder filters, including the overflow menu, are full 44px touch targets (#411).
 for(const control of [page.getByRole('button',{name:'Other mail folders',exact:true}),page.getByRole('button',{name:'Archive',exact:true})])expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
 await page.getByRole('button',{name:'Other mail folders',exact:true}).click();await page.getByRole('menuitemradio',{name:'Trash',exact:true}).click();
 await expect(page.getByText('Trashed fixture',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Archive',exact:true}).click();
 await expect(page.getByText('Archived fixture',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Other mail folders',exact:true}).click();await page.getByRole('menuitemradio',{name:'Drafts',exact:true}).click();
 await expect(page.getByRole('button',{name:/^Gmail draft, Draft to friend@example\.invalid, Quarterly plan/})).toBeVisible();
 expect((await fixture(page)).searches.slice(-2)).toEqual(['in:trash','in:archive']);
 // A reply draft stays in Gmail: its thread headers cannot be reproduced exactly here.
 await page.getByRole('button',{name:/Re: Thread reply/}).click();
 await expect(page.getByText('Edit in Gmail',{exact:true})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:/Quarterly plan/}).click();
 await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Quarterly plan');
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Draft text');
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Edited draft text');
 await page.getByRole('button',{name:'Review save to Gmail drafts',exact:true}).click();
 const review=page.getByRole('dialog',{name:'Review mail operation'});
 await expect(review.getByRole('heading',{name:'Replace Gmail draft'})).toBeVisible();
 await expect(review.getByText('Edited draft text',{exact:true})).toBeVisible();
 const state=await fixture(page);
 expect(state.prepared.at(-1)).toMatchObject({kind:'draft-replace',draftId:'draft-1',expectedDigest:'a'.repeat(64),acceptNonAtomicReplacement:true,bodyText:'Edited draft text'});
 expect(state.dispatches).toBe(0);
 await review.getByRole('button',{name:'Cancel unsent review',exact:true}).click();
 await expect(review).toHaveCount(0);
 expect((await fixture(page)).dispatches).toBe(0);
});

test('Send opens the exact review and nothing is sent until it is confirmed',async({page})=>{
 await install(page,{});
 await page.getByRole('button',{name:'Compose',exact:true}).click();
 await page.getByRole('textbox',{name:'To',exact:true}).fill('friend@example.invalid');
 await page.getByRole('textbox',{name:'To',exact:true}).press('Enter');
 await page.getByRole('textbox',{name:'Subject',exact:true}).fill('Reviewed subject');
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Reviewed body');
 await page.getByRole('button',{name:'Send email',exact:true}).click();
 const review=page.getByRole('dialog',{name:'Review mail operation'});
 await expect(review.getByRole('button',{name:'Send this email',exact:true})).toBeVisible();
 await expect(review.getByText('Reviewed body',{exact:true})).toBeVisible();
 expect((await fixture(page)).prepared.map((p:any)=>p.kind)).toEqual(['send']);
 expect((await fixture(page)).dispatches).toBe(0);
 await review.getByRole('button',{name:'Close mail review',exact:true}).click();
 await expect(review).toHaveCount(0);
 await page.waitForTimeout(200);
 expect((await fixture(page)).dispatches).toBe(0);
});

test.describe('wide Cloud Inbox layout',()=>{
 test.use({hasTouch:true,isMobile:true});
 test('keeps the account-bound message open beside its list and through collapsing',async({page})=>{
  await page.setViewportSize({width:1280,height:800});
  await install(page,{});
  const message=page.getByRole('button',{name:'Synthetic sender, Inbox fixture',exact:true});
  await message.click();
  await expect(page.getByRole('region',{name:'Email message',exact:true})).toContainText('Synthetic body');
  const list=page.locator('[data-alpha-subview="inbox-list"]');
  await expect.poll(()=>list.evaluate(element=>!!element.closest('[inert]'))).toBe(false);
  await expect(message).toHaveAttribute('aria-current','true');
  await page.setViewportSize({width:412,height:915});
  await expect.poll(()=>list.evaluate(element=>!!element.closest('[inert]'))).toBe(true);
  await expect(page.getByRole('region',{name:'Email message',exact:true})).toContainText('Synthetic body');
  expect((await fixture(page)).dispatches).toBe(0);
 });
});


test('real thread loads automatically and message actions keep one compact menu',async({page},info)=>{
 await install(page,{threads:true});
 await page.getByText('Inbox fixture',{exact:true}).click();
 await expect(page.getByRole('button',{name:'Show conversation',exact:true})).toHaveCount(0);
 await expect(page.getByRole('group',{name:'Conversation',exact:true})).toBeVisible();
 await expect.poll(async()=>(await fixture(page)).threadReads).toBe(1);
 await expect(page.getByText('Synthetic body',{exact:true})).toBeVisible();
 await page.locator('.mail-thread-message').click();
 await expect(page.getByText('Earlier message body',{exact:true})).toBeVisible();
 await page.locator('.mail-thread-message').click();
 await expect(page.getByText('Synthetic body',{exact:true})).toBeVisible();
 await expect(page.getByText('Stale thread body',{exact:true})).toHaveCount(0);
 await page.getByLabel('Message actions',{exact:true}).click();
 await expect(page.getByRole('button',{name:'Reply',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Forward',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Reply all',exact:true})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('mail-actions-mobile.png')});
 await page.setViewportSize({width:1280,height:800});
 await expect(page.getByRole('button',{name:'Reply',exact:true})).toBeVisible();
 expect(await page.locator('.mail-message-menu > div').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})).toBe(true);
 await page.screenshot({path:info.outputPath('mail-actions-desktop.png')});
 await page.getByLabel('Message actions',{exact:true}).press('Escape');
 await expect(page.getByRole('button',{name:'Reply',exact:true})).toBeHidden();
 await page.getByLabel('Message actions',{exact:true}).click();
 await page.getByRole('button',{name:'Reply',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue('Re: Inbox fixture');
 expect((await fixture(page)).dispatches).toBe(0);
});

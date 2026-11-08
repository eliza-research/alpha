import {test,expect,type Page} from '@playwright/test';
// Each test loads the app and drives Files, Inbox or the shade; under four workers on a loaded machine
// one load has taken 10-30s, so the timeout is explicit. No step, wait or assertion changes.
test.describe.configure({timeout:60_000});
// Screen-entry motion is not under test here; waiting out its stability retries on every tap is what
// ran these tests out of time under load (as in #700).
test.use({contextOptions:{reducedMotion:'reduce'}});
// MVP-13: folder, notification and capture questions keep the exact selected identity and
// revision. A switch, delete or revoke during review adds nothing and never sends a neighbor.
const offline=(page:Page)=>page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
const selectedObject=(page:Page)=>page.evaluate(async()=>(await import('/src/runtime/alpha-client.ts')).alphaClient.getState().context.selectedObject??null);
const composer=(page:Page)=>page.getByRole('textbox',{name:'Message Alpha',exact:true});
const review=(page:Page)=>page.getByRole('dialog',{name:'Ask about selected content'});
test.describe('notification',()=>{
 test.beforeEach(async({page})=>{await offline(page);await page.goto('/?mode=dev&tools=1');});
 async function post(page:Page,rows:Array<{id:string;title:string;body:string}>){
  await page.evaluate(async rows=>{
   const {registerPlugin}=await import('/src/platform-plugins.ts');const daily=registerPlugin<any>('DailyApps'),notices=registerPlugin<any>('AlphaNotifications');
   for(const row of rows)await daily.scheduleReminder({id:row.id,title:row.title,body:row.body,at:Date.now()+60000});
   await (await import('/src/browser/reminder-store.ts')).reminderDocument.edit(()=>({reminders:[] as any[]}),data=>{data.reminders.forEach((row:any,index:number)=>{row.at=Date.now()-1000-index;});});
   await notices.setNotificationPolicy({expectedRevision:(await notices.crossAppStatus()).revision,enabled:true,apps:[{packageName:'browser.mail',preview:true}]});
   await notices.inject({packageName:'browser.mail',title:'Other app title',text:'Other app text'});
  },rows);
  await page.getByRole('button',{name:'Device controls',exact:true}).click();await page.getByRole('dialog',{name:'Development device controls'}).getByRole('button',{name:'Notifications',exact:true}).click();
 }
 const rows=[{id:'context-first',title:'Call the clinic',body:'Ask about Tuesday'},{id:'context-second',title:'Water the plants',body:'Neighbor reminder'}];
 const ask=(page:Page)=>page.getByRole('button',{name:'Ask Alpha about this Alpha Phone notification',exact:true});
 test('only own notifications offer a question, and the reviewed text is what reaches the draft',async({page})=>{
  await post(page,rows);await expect(page.getByText('Ask about Tuesday',{exact:true})).toBeVisible();await expect(page.getByText('Other app title · Other app text',{exact:true})).toBeVisible();
  await expect(ask(page)).toHaveCount(2);await expect(page.getByRole('button',{name:/^Ask Alpha about this Mail/})).toHaveCount(0);
  await page.locator('.alpha-shade-list > div',{hasText:'Call the clinic'}).getByRole('button',{name:/^Ask Alpha/}).click();
  // Pressing the row selects exactly that notification as opaque context while the shade is open.
  expect(await selectedObject(page)).toMatchObject({kind:'notification',id:'context-first',accountId:'own'});
  const dialog=review(page);await expect(dialog.getByRole('heading')).toHaveText('Ask Alpha');await expect(dialog.getByLabel('Selected source',{exact:true})).toHaveText('Alpha Phone notification');
  await expect(dialog.getByRole('textbox',{name:'Content excerpt'})).toHaveValue('Call the clinic\nAsk about Tuesday');
  // Verification codes are not placed in a draft.
  await dialog.getByRole('textbox',{name:'Content excerpt'}).fill('Your verification code is 481516');await dialog.getByRole('button',{name:'Use in conversation',exact:true}).click();
  await expect(dialog.getByRole('status')).toHaveText('This excerpt may contain credentials or verification codes. Remove them before continuing.');
  await dialog.getByRole('textbox',{name:'Content excerpt'}).fill('Call the clinic');await dialog.getByRole('button',{name:'Use in conversation',exact:true}).click();
  await expect(composer(page)).toHaveValue('Help me with this notification.\n\nSource: Alpha Phone notification\n\nCall the clinic');
  // The selection does not outlive the shade.
  expect((await selectedObject(page))?.kind).not.toBe('notification');
 });
 test('a notification review ends with the shade it was opened from',async({page})=>{
  await post(page,rows);await page.locator('.alpha-shade-list > div',{hasText:'Call the clinic'}).getByRole('button',{name:/^Ask Alpha/}).click();
  const dialog=review(page);await expect(dialog.getByRole('textbox',{name:'Content excerpt'})).toHaveValue(/Call the clinic/);
  // Home closes the shade underneath the review; the notification text must not stay on screen.
  await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));
  await expect(dialog).toHaveCount(0);await expect(page.getByText('Ask about Tuesday',{exact:true})).not.toBeInViewport();
  await expect.poll(()=>selectedObject(page)).toBeNull();
 });
 test('a row whose content Android withheld offers no question',async({page})=>{
  // The browser build redacts with an empty row. Stand in for Android's answer at the plugin
  // boundary: fixed wording in place of a locked or secret notification's title and text.
  await page.evaluate(async()=>{
   const {BrowserNotifications}=await import('/src/browser/notifications.ts');const at=Date.now();
   const own={source:'own',appLabel:'Alpha Phone',clearable:true};
   (BrowserNotifications.prototype as any).list=async()=>({scope:'alpha-phone',items:[
    {...own,id:'hidden-secret',revision:'hidden-secret',title:'Alpha Phone notification',text:'Content hidden',at,canOpen:false},
    {...own,id:'hidden-locked',revision:'hidden-locked',title:'Alpha Phone notification',text:'Unlock to view',at:at-1,canOpen:false},
    {...own,id:'shown',revision:'shown',title:'Stand up',text:'In five minutes',at:at-2,canOpen:true}]});
  });
  await page.getByRole('button',{name:'Device controls',exact:true}).click();await page.getByRole('dialog',{name:'Development device controls'}).getByRole('button',{name:'Notifications',exact:true}).click();
  await expect(page.getByText('Content hidden',{exact:true})).toBeVisible();await expect(page.getByText('Unlock to view',{exact:true})).toBeVisible();
  await expect(ask(page)).toHaveCount(1);
  await expect(page.locator('.alpha-shade-list > div',{hasText:'Stand up'}).getByRole('button',{name:/^Ask Alpha/})).toHaveCount(1);
 });
 test('dismissing the reviewed notification never sends its neighbor',async({page})=>{
  await post(page,rows);await page.locator('.alpha-shade-list > div',{hasText:'Call the clinic'}).getByRole('button',{name:/^Ask Alpha/}).click();
  const dialog=review(page);await expect(dialog.getByRole('textbox',{name:'Content excerpt'})).toHaveValue(/Call the clinic/);
  await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const notices=registerPlugin<any>('AlphaNotifications');const row=(await notices.list()).items.find((item:any)=>item.id==='context-first');await notices.dismiss({id:row.id,revision:row.revision,source:'own'});});
  await dialog.getByRole('button',{name:'Use in conversation',exact:true}).click();
  // Either the open review reports the change or the final re-read refuses it; nothing is composed.
  await expect(page.getByText(/Selection changed\. Close this review|Nothing was added to your conversation\./)).toBeVisible();
  await expect(composer(page)).toHaveCount(0);
  if(await dialog.count())await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByText('Neighbor reminder',{exact:true})).toBeVisible();await expect(page.getByText('Ask about Tuesday',{exact:true})).toHaveCount(0);
 });
 test('hosted-result, digest and workflow notices offer no question; reminder rows still do',async({page})=>{
  // Stand in for both list shapes at the plugin boundary: Android's own rows carry a kind
  // (AlphaNotificationsPlugin.noticeKind); the browser build's workflow notices have 'workflow:' ids.
  await page.evaluate(async()=>{
   const {BrowserNotifications}=await import('/src/browser/notifications.ts');const at=Date.now();
   const own={source:'own',appLabel:'Alpha Phone',clearable:true,canOpen:true};
   (BrowserNotifications.prototype as any).list=async()=>({scope:'alpha-phone',items:[
    {...own,id:'android-result',revision:'r1',kind:'hosted-result',title:'Digest ready',text:'Mail from Dana: the contract is attached',at},
    {...own,id:'android-workflow',revision:'r2',kind:'workflow',title:'Workflow step',text:'Forwarded mail summary',at:at-1},
    {...own,id:'android-other',revision:'r3',kind:'other',title:'Local agent',text:'Running',at:at-2},
    {...own,id:'workflow:browser-run',revision:'r4',title:'Workflow notice',text:'Mail triage finished',at:at-3},
    {...own,id:'android-reminder',revision:'r5',kind:'reminder',title:'Stand up',text:'In five minutes',at:at-4},
    {...own,id:'browser-reminder',revision:'r6',title:'Water the plants',text:'Neighbor reminder',at:at-5}]});
  });
  await page.getByRole('button',{name:'Device controls',exact:true}).click();await page.getByRole('dialog',{name:'Development device controls'}).getByRole('button',{name:'Notifications',exact:true}).click();
  await expect(page.getByText('Mail from Dana: the contract is attached',{exact:false})).toBeVisible();
  for(const text of ['Digest ready','Workflow step','Local agent','Workflow notice'])
   await expect(page.locator('.alpha-shade-list > div',{hasText:text}).getByRole('button',{name:/^Ask Alpha/})).toHaveCount(0);
  for(const text of ['Stand up','Water the plants'])
   await expect(page.locator('.alpha-shade-list > div',{hasText:text}).getByRole('button',{name:/^Ask Alpha/})).toHaveCount(1);
  await expect(ask(page)).toHaveCount(2);
 });
});

test.describe('mail',()=>{
 // MVP-13 re-audit of Inbox mail context. The mailbox is a synthetic provider at the Cloud client
 // boundary and the agent a fixed session; nothing is sent anywhere. Browser renderer only.
 const sent=(page:Page)=>page.evaluate(()=>(window as any).mailFixture.sent as string[]);
 async function setup(page:Page,beforeReview?:()=>Promise<void>){
  // The first-run access walkthrough is not under test here. Left pending it opens a modal over Home
  // on its own schedule and, under load, takes the Inbox tap (or, once the composer opens, covers the
  // review), so it is recorded as finished before the page loads, as a returning phone has it.
  await page.addInitScript(()=>localStorage.setItem('alpha:startup-permission-walkthrough:v1',JSON.stringify({version:1,status:'completed',step:4})));
  await page.goto('/');
  await page.evaluate(async()=>{
   const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
   const {secureConnectionStore:s}=await import('/src/runtime/native-connection.ts');
   s.read=async()=>null;s.compareExchange=async()=>({status:'saved'});
   const f=(window as any).mailFixture={sent:[] as string[]};
   const mail=(id:string,subject:string)=>({id,threadId:'thread',from:'Fixture sender',fromEmail:'sender@example.invalid',to:['reader@example.invalid'],cc:[],replyTo:null,subject,snippet:subject,receivedAt:'2026-10-04T12:00:00Z',unread:false});
   const first=mail('first','Reviewed message'),neighbor=mail('neighbor','Neighbor message');
   const read=(message:any)=>({message,bodyText:message.id==='first'?'REVIEWED_BODY':'NEIGHBOR_BODY_CANARY',historyId:'h-'+message.id,links:[],attachments:[]});
   const client={
    gmailAccounts:async()=>[{connectionId:'fixture-grant',label:'Fixture mailbox',configured:true,connected:true,reason:'connected',grantedCapabilities:['google.gmail.triage']}],
    gmailInboxCapabilities:async()=>({version:1,from:'reader@example.invalid',threads:true,send:false,providerDrafts:false,mailboxMutations:false,attachments:false,providerExactlyOnce:false,atomicDraftReplacement:false,readState:false,opaqueAttachments:false}),
    gmailSearch:async()=>({messages:[first,neighbor],syncedAt:'1',nextPageToken:null}),
    gmailRead:async(_grant:string,id:string)=>read(id==='first'?first:neighbor),
    gmailThread:async()=>({messages:[read(first),read(neighbor)],total:2,offset:0,historyId:'thread-history',nextOffset:null}),
    gmailPrepareOperation:async()=>{throw Error('No provider writes');},
   };
   c.getCloudClient=()=>({client,sessionId:'fixture-session',credentialId:'fixture'} as any);
   const agent={sessionId:'agent-session',agentId:'agent-1',ownerId:'fixture-owner',origin:'https://agent.example.invalid'};
   const snapshot={...c.getSnapshot(),cloudAccount:{environment:'production',userId:'fixture-owner',sessionId:'fixture-session',credentialId:'fixture'},session:agent} as any;
   c.getSnapshot=()=>snapshot;(window as any).mailSnapshot=snapshot;
   // Anything that would reach the agent is recorded here instead.
   const {alphaClient}=await import('/src/runtime/alpha-client.ts');
   (alphaClient as any).send=async(text:string)=>{f.sent.push(text);throw Error("Fixture agent");};
  });
  await page.getByRole('button',{name:'Inbox',exact:true}).click();
  await page.getByText('Reviewed message',{exact:true}).first().click();
  await expect(page.getByRole('region',{name:'Email message'})).toContainText('REVIEWED_BODY');
  // The thread loads on request (Show conversation); its other message is then a chip under the open one.
  await page.getByRole('button',{name:'Show conversation',exact:true}).click();
  await expect(page.getByText('Fixture sender: Neighbor message',{exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'Email message'})).toContainText('REVIEWED_BODY');
  await beforeReview?.();
  await page.getByRole('button',{name:'Review email with agent',exact:true}).click();
  const sharing=page.getByRole('dialog',{name:'Review email sharing'});
  await expect(sharing).toContainText('REVIEWED_BODY');
  return sharing;
 }
 test('an unchanged review hands exactly the reviewed message to the agent (control)',async({page})=>{
  const sharing=await setup(page);
  await sharing.getByRole('button',{name:'Send reviewed email to agent',exact:true}).click();
  await expect.poll(()=>sent(page)).toHaveLength(1);
  const [text]=await sent(page);expect(text).toContain('REVIEWED_BODY');expect(text).not.toContain('NEIGHBOR_BODY_CANARY');
 });
 test('a reviewed email the agent receives leaves the chat draft being typed in the composer',async({page})=>{
  // AP-05: the shared email is not the composer's text, so the person's own unsent words stay
  // (they used to be cleared with the send and their saved copy with its dispatch).
  const typed='Unrelated words I am still writing';
  // Whichever composer is on screen: the dock's while the chat is closed, the sheet's once it opens.
  const chatComposer=()=>page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();
  const sharing=await setup(page,async()=>{
   await page.evaluate(async()=>{const {alphaClient}=await import('/src/runtime/alpha-client.ts');(alphaClient as any).send=async(text:string)=>{(window as any).mailFixture.sent.push(text);return {text:'Shared email summary'};};});
   // An open app shows the dock's Type control; it opens the composer's textbox.
   await page.getByRole('group',{name:'Assistant controls'}).getByRole('button',{name:'Type',exact:true}).click();
   await chatComposer().fill(typed);
  });
  await sharing.getByRole('button',{name:'Send reviewed email to agent',exact:true}).click();
  await expect.poll(()=>sent(page)).toHaveLength(1);
  await expect(page.getByText('Shared email summary',{exact:true})).toBeVisible();
  await expect(chatComposer()).toHaveValue(typed);
  await page.waitForTimeout(500);
  await expect(chatComposer()).toHaveValue(typed);
  // The composer's saved copy still holds the typed words: the email's dispatch does not clear it.
  await expect.poll(()=>page.evaluate(async()=>{const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');const binding=await c.assistantDraftBinding(new AbortController().signal);return (await(await(await import('/src/runtime/assistant-draft-store.ts')).assistantDraftStore(binding)).read())?.text??null;})).toBe(typed);
  expect(await sent(page)).toHaveLength(1);
 });
 test('a message switched under the open review is refused and the neighbor is never sent',async({page})=>{
  const sharing=await setup(page);
  // The thread's other message replaces the open one while the review is showing (the chip sits
  // under the modal, so the switch is delivered to its handler directly).
  await page.getByText('Fixture sender: Neighbor message',{exact:true}).dispatchEvent('click');
  // The message under the modal is now the neighbor (inert, so read from the DOM); the review still shows the reviewed text.
  await expect.poll(()=>page.evaluate(()=>document.body.textContent?.includes('NEIGHBOR_BODY_CANARY'))).toBe(true);
  await expect(sharing).toContainText('REVIEWED_BODY');
  await sharing.getByRole('button',{name:'Send reviewed email to agent',exact:true}).click();
  await expect(page.getByText('Message or destination changed. Review again; nothing was sent.',{exact:true})).toBeVisible();
  expect(await sent(page)).toEqual([]);
  await expect(page.getByText(/Summarize the following user-selected email/)).toHaveCount(0);
 });
 test('an agent switched under the open review is refused',async({page})=>{
  const sharing=await setup(page);
  await page.evaluate(()=>{(window as any).mailSnapshot.session={sessionId:'other-session',agentId:'agent-2',ownerId:'fixture-owner',origin:'https://agent.example.invalid'};});
  await sharing.getByRole('button',{name:'Send reviewed email to agent',exact:true}).click();
  await expect(page.getByText('Message or destination changed. Review again; nothing was sent.',{exact:true})).toBeVisible();
  expect(await sent(page)).toEqual([]);
 });
 test('a review left open past two minutes is refused',async({page})=>{
  await page.clock.install({time:Date.UTC(2026,9,11,12)});
  const sharing=await setup(page);
  await page.clock.fastForward(121_000);
  await sharing.getByRole('button',{name:'Send reviewed email to agent',exact:true}).click();
  await expect(page.getByText('Message or destination changed. Review again; nothing was sent.',{exact:true})).toBeVisible();
  expect(await sent(page)).toEqual([]);
 });
});

test('Settings pages publish only their section slug; the root and other views publish none',async({page})=>{
 await offline(page);await page.goto('/');
 await page.getByRole('button',{name:'Settings',exact:true}).click();expect(await selectedObject(page)).toBeNull();
 await page.getByRole('button',{name:'Display',exact:true}).click();await expect.poll(()=>selectedObject(page)).toEqual({kind:'settings',id:'display'});
});

test.describe('capture',()=>{
 const photo=(page:Page,label:string)=>page.evaluate(async label=>{const {importBrowserPhoto}=await import('/src/prototype/browser-camera.ts');const canvas=document.createElement('canvas');canvas.width=400;canvas.height=200;const context=canvas.getContext('2d')!;context.fillStyle='white';context.fillRect(0,0,400,200);context.fillStyle='black';context.font='bold 48px sans-serif';context.fillText(label,30,110);return (await importBrowserPhoto({image:canvas.toDataURL('image/jpeg'),width:400,height:200},new AbortController().signal)).id;},label);
 test.beforeEach(async({page})=>{await offline(page);await page.goto('/');});
 test('a photo question is bound to the open item and its revision',async({page})=>{
  await photo(page,'FIRST');await photo(page,'SECOND');
  await page.getByRole('button',{name:'Photos',exact:true}).click();await page.getByRole('button',{name:/^Photo, /}).first().click();
  await expect.poll(async()=>(await selectedObject(page))?.kind).toBe('photo');const selected=await selectedObject(page);
  await page.getByRole('button',{name:'Ask Alpha about this photo',exact:true}).click();
  const dialog=review(page);await expect(dialog.getByRole('heading')).toHaveText('Ask Alpha');await expect(dialog.getByLabel('Selected source',{exact:true})).toHaveText('Selected photo');await expect(dialog.getByRole('img')).toBeVisible();
  await dialog.getByRole('textbox',{name:'Content excerpt'}).fill('A reviewed description');await dialog.getByRole('button',{name:'Use in conversation',exact:true}).click();
  await expect(composer(page)).toHaveValue('What does this mean?\n\nSource: Selected photo\n\nA reviewed description');
  // The envelope still names the same item at the same revision; no content is in it, and the
  // revision is a session-local counter rather than the library's own revision.
  expect(await selectedObject(page)).toEqual(selected);expect(Object.keys(selected!).sort()).toEqual(['id','kind','revision']);
  expect(selected!.revision).toMatch(/^capture-[0-9a-f]{12}-\d+$/);
  const library=await page.evaluate(async id=>{const {browserPhotoLibrary}=await import('/src/prototype/browser-camera.ts');const row=await browserPhotoLibrary.read({id});return [row.revision,row.mutationRevision];},selected!.id.replace(/^native-camera-/,''));
  for(const value of library)expect(JSON.stringify(selected)).not.toContain(value);
 });
 test('a changed photo is a new revision of the same identity',async({page})=>{
  await photo(page,'ONLY');await page.getByRole('button',{name:'Photos',exact:true}).click();await page.getByRole('button',{name:/^Photo, /}).first().click();
  await expect.poll(async()=>(await selectedObject(page))?.kind).toBe('photo');const selected=await selectedObject(page);
  await page.getByRole('button',{name:'Favorite',exact:true}).click();await expect(page.getByRole('button',{name:'Remove from favorites',exact:true})).toBeVisible();
  await expect.poll(async()=>(await selectedObject(page))?.revision).not.toBe(selected!.revision);
  const changed=await selectedObject(page);expect(changed).toMatchObject({kind:'photo',id:selected!.id});expect(changed!.revision).toMatch(/^capture-[0-9a-f]{12}-\d+$/);
 });
 test('a photo trashed during its review adds nothing, and the other photo is never sent',async({page})=>{
  await photo(page,'FIRST');await photo(page,'SECOND');
  await page.getByRole('button',{name:'Photos',exact:true}).click();await page.getByRole('button',{name:/^Photo, /}).first().click();
  await expect.poll(async()=>(await selectedObject(page))?.kind).toBe('photo');const selected=await selectedObject(page);
  await page.getByRole('button',{name:'Ask Alpha about this photo',exact:true}).click();
  const dialog=review(page);await expect(dialog.getByRole('img')).toBeVisible();
  await dialog.getByRole('textbox',{name:'Content excerpt'}).fill('A reviewed description');
  // Another surface trashes the open item while the review is showing. The view has not refreshed.
  await page.evaluate(async id=>{const {browserPhotoLibrary}=await import('/src/prototype/browser-camera.ts');const row=await browserPhotoLibrary.read({id});await browserPhotoLibrary.setTrashed({id,revision:row.mutationRevision,trashed:true});},selected!.id.replace(/^native-camera-/,''));
  await dialog.getByRole('button',{name:'Use in conversation',exact:true}).click();
  await expect(page.getByText('This photo changed or is no longer available. Nothing was added to your conversation.',{exact:true})).toBeVisible();
  await expect(dialog).toHaveCount(0);await expect(composer(page)).toHaveCount(0);
  // The stale viewer closes. The remaining photo was not opened or sent in its place.
  await expect.poll(()=>selectedObject(page)).toBeNull();
  await expect(page.getByRole('button',{name:'Ask Alpha about this photo',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/^Photo, /})).toHaveCount(1);
 });
});

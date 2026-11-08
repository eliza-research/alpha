import {test,expect} from '@playwright/test';
import {canonicalNotesFixture,openCanonicalNotes} from './helpers/canonical-notes';
const snapshot=(page:import('@playwright/test').Page)=>page.evaluate(()=>(window as any).canonicalNotesFixture.state);

test('a lost canonical recording save reply is reconciled without another create',async({page})=>{
 await canonicalNotesFixture(page);
 const result=await page.evaluate(async()=>{
  const {connectionController}=await import('/src/runtime/connection-ui.tsx');
  const {CanonicalNotesUi}=await import('/src/prototype/canonical-notes-ui.ts');
  const fixture=(window as any).canonicalNotesFixture;
  let pending=false,claims=0;
  const attempt=async()=>{
   const ui=new CanonicalNotesUi(connectionController.getAppRecordClient()!,{paint(){},review(){}});
   try{
    return await ui.saveVoice('11111111-2222-4333-8444-555555555555','A recovered recording.',3000,'f-original',()=>true,{
     pending,
     claim:async()=>{claims++;if(pending)return false;pending=true;return true;},
    });
   }finally{ui.retire();}
  };
  fixture.failAfterApplied=true;
  const first=await attempt();
  fixture.failReads=true;
  const unavailable=await attempt();
  fixture.failReads=false;
  const reconciled=await attempt();
  return {first,unavailable,reconciled,claims,notes:fixture.state.notes,posts:fixture.requests.filter((r:any)=>r.method==='POST')};
 });
 expect(result).toMatchObject({first:false,unavailable:false,reconciled:true,claims:1});
 expect(result.posts).toHaveLength(1);
 expect(result.notes).toHaveLength(1);
 expect(result.notes[0].format.data).toMatchObject({recordingId:'11111111-2222-4333-8444-555555555555',folderId:'f-original',dur:3});
});

// Live agent Notes render through Alpha's own Notes template (the one mock mode shows), saved through
// the canonical Notes client: the same committed identity, expectedRevision and Trash restore.
test('canonical Notes UI creates, edits, trashes and restores the same committed identity',async({page})=>{
 const {foreign,errors}=await canonicalNotesFixture(page);await openCanonicalNotes(page);
 await expect(page.getByRole('heading',{name:'Notes',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Canonical browser note');
 await page.getByRole('textbox',{name:'Note',exact:true}).fill('Exact first line.\nSecond line.');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open Canonical browser note',exact:true})).toBeVisible();
 const before=(await snapshot(page)).notes[0];expect(before.body).toBe('\nExact first line.\nSecond line.');
 await page.getByRole('button',{name:'Open Canonical browser note',exact:true}).click();
 await page.getByRole('textbox',{name:'Note',exact:true}).fill('Updated exact text.');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await expect.poll(()=>snapshot(page).then((s:any)=>s.notes.find((n:any)=>n.id===before.id)?.body)).toBe('\nUpdated exact text.');
 await page.getByRole('button',{name:'Open Canonical browser note',exact:true}).click();
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog',{name:'Note actions'}).getByRole('button',{name:'Delete',exact:true}).click();
 await expect.poll(()=>snapshot(page).then((s:any)=>s.notes.length)).toBe(0);
 await expect(page.getByText('Moved to Recently deleted',{exact:true})).toBeVisible();
 // The agent's restore-only Trash is the Recently deleted folder: no retention line, no Empty, no Delete now.
 await page.getByRole('button',{name:'Recently deleted',exact:true}).click();
 const trash=page.locator('[data-alpha-subview="notes-trash"]');
 await expect(trash.getByRole('button',{name:'Empty Recently deleted',exact:true})).toHaveCount(0);
 await trash.getByRole('button',{name:'Canonical browser note',exact:true}).click();
 const ask=page.getByRole('dialog',{name:'Canonical browser note'});
 await expect(ask.getByRole('button',{name:'Delete now',exact:true})).toHaveCount(0);
 await ask.getByRole('button',{name:'Recover',exact:true}).click();
 await expect.poll(()=>snapshot(page).then((s:any)=>s.notes.length)).toBe(1);
 const after=(await snapshot(page)).notes[0];expect(after.id).toBe(before.id);expect(after.body).toBe('\nUpdated exact text.');expect((await snapshot(page)).trash).toEqual([]);
 // The last item recovered: the folder closes and the chip goes.
 await expect(trash).toHaveCount(0);await expect(page.getByRole('button',{name:'Recently deleted',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Open Canonical browser note',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue('Updated exact text.');
 const requests=await page.evaluate(()=>(window as any).canonicalNotesFixture.requests);
 for(const capability of ['create-note','update-note','delete-note','restore-note'])expect(requests.some((r:any)=>r.path==='/api/views/notes/interact'&&r.body.capability===capability)).toBe(true);
 // Every edit of an existing record names the revision it was made against.
 for(const update of requests.filter((r:any)=>r.body?.capability==='update-note'))expect(Number.isSafeInteger(update.body.params.expectedRevision)).toBe(true);
 expect(requests.every((r:any)=>['/api/notes/state','/api/views/notes/interact'].includes(r.path))).toBe(true);expect(requests.filter((r:any)=>r.path==='/api/notes/state').length).toBeGreaterThanOrEqual(2);
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

test('Stop saves canonical audio locally and Generate transcript later uses its retained recording only on request',async({page})=>{
 const {foreign,errors}=await canonicalNotesFixture(page);await openCanonicalNotes(page);
 let uploads=0;
 await page.route('**/__alpha-browser-cloud',async route=>{
  const request=route.request(),type=request.headers()['content-type']||'';
  if(type.includes('multipart/form-data')){
   const body=request.postDataBuffer()!;expect(body.includes(Buffer.from('audio/wav'))).toBe(true);expect(body.indexOf(Buffer.from('RIFF'))).toBeGreaterThan(0);expect(body.includes(Buffer.from('WAVE'))).toBe(true);
   uploads++;await route.fulfill({json:{text:'A closed Notes fixture.',local:false}});return;
  }
  const input=request.method()==='POST'?request.postDataJSON():null;
  if(input?.operation==='secureRead'&&input.slot==='cloud:production'){await route.fulfill({json:{value:JSON.stringify({credentialId:'notes-fixture',credentialReference:'closed-fixture-reference'})}});return;}
  await route.fallback();
 });
 await page.bringToFront();
 const header=page.locator('[data-alpha-subview="notes-list"] [data-alpha-app-header="main"]');
 expect(await header.getByRole('button').evaluateAll(list=>list.map(el=>el.getAttribute('aria-label')))).toEqual(['Back to apps','Record voice note','New note']);
 await page.evaluate(async()=>{
  const {connectionController}=await import('/src/runtime/connection-ui.tsx');
  connectionController.getCloudEnvironment=()=> 'production';
  connectionController.getCloudClient=()=>({sessionId:'notes-fixture',credentialId:'notes-fixture'} as any);
  const ctx=new AudioContext(),osc=ctx.createOscillator(),sink=ctx.createMediaStreamDestination();
  osc.connect(sink);osc.start();document.addEventListener('click',()=>{void ctx.resume();},{once:true,capture:true});
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>sink.stream});
  (window as any).micContext=ctx;
 });
 await page.getByRole('button',{name:'Record voice note',exact:true}).click();
 const recorder=page.locator('[data-alpha-subview="notes-recorder"]');
 await expect(recorder).toHaveAttribute('data-recorder-state','recording');
 await page.waitForTimeout(1200);
 expect(uploads).toBe(0);
 await recorder.getByRole('button',{name:'Stop recording',exact:true}).click();
 await expect(recorder).toHaveCount(0);
 await expect.poll(()=>snapshot(page).then((s:any)=>s.notes.map((n:any)=>[n.title,n.format?.kind]))).toEqual([['Voice note','voice']]);
 const saved=(await snapshot(page)).notes[0];
 expect(saved.format.data.dur).toBeGreaterThan(0);
 expect(saved.format.data.audio.audioId).toBe(saved.format.data.recordingId);
 expect(saved.format.data.audio.durationMs).toBeGreaterThan(0);
 expect(saved.body).toBe('');expect(uploads).toBe(0);
 await expect(page.getByRole('button',{name:'Play recording',exact:true})).toBeVisible();
 const retained=await page.evaluate(async(audioId)=>{
  const {registerPlugin}=await import('/src/platform-plugins.ts');
  return registerPlugin<any>('AlphaNoteAudio').describe({audioId});
 },saved.format.data.audio.audioId);
 expect(retained.audioId).toBe(saved.format.data.audio.audioId);expect(retained.noteId).toBe(saved.id);
 await expect(page.getByRole('button',{name:'Generate transcript',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Generate transcript',exact:true}).click();
 await expect.poll(()=>snapshot(page).then((state:any)=>state.notes[0].body)).toBe('\nA closed Notes fixture.');
 expect(uploads).toBe(1);
 await expect(page.getByRole('button',{name:'Generate transcript',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Play recording',exact:true})).toBeVisible();
 const after=(await snapshot(page)).notes[0];expect(after.id).toBe(saved.id);expect(after.format.data.audio).toEqual(saved.format.data.audio);

 const requests=await page.evaluate(()=>(window as any).canonicalNotesFixture.requests.filter((r:any)=>r.path==='/api/views/notes/interact'));
 expect(requests.filter((r:any)=>r.body.capability==='create-note')).toHaveLength(1);expect(requests.filter((r:any)=>r.body.capability==='update-note')).toHaveLength(1);
 expect(JSON.stringify(requests)).not.toMatch(/blob:|file:\/\/|content:\/\//);
 await page.evaluate(()=>(window as any).micContext.close());
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

test('canonical failed save retains the owner draft until explicit discard and reload',async({page})=>{
 const {errors}=await canonicalNotesFixture(page);await openCanonicalNotes(page);
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Saved draft');
 await page.getByRole('textbox',{name:'Note',exact:true}).fill('Committed original');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await page.getByRole('button',{name:'Open Saved draft',exact:true}).click();
 await page.evaluate(()=>(window as any).canonicalNotesFixture.fail=true);
 await page.getByRole('textbox',{name:'Note',exact:true}).fill('Keep this unsaved owner text');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue('Keep this unsaved owner text');
 expect((await snapshot(page)).notes[0].body).toBe('\nCommitted original');
 await expect(page.getByText('Your draft is shown here until you reload or the connection changes. Reload the current notes to discard it.',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Discard draft and reload',exact:true})).toBeVisible();
 const attempts=await page.evaluate(()=>(window as any).canonicalNotesFixture.requests.filter((r:any)=>r.method==='POST').length);
 await page.evaluate(()=>(window as any).canonicalNotesFixture.fail=false);
 await page.getByRole('button',{name:'Discard draft and reload',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue('Committed original');
 expect(await page.evaluate(()=>(window as any).canonicalNotesFixture.requests.filter((r:any)=>r.method==='POST').length)).toBe(attempts);
 expect(errors).toEqual([]);
});

test('a checklist, pin and Back leave Alpha cards in the same canonical record',async({page})=>{
 const {foreign,errors}=await canonicalNotesFixture(page);await openCanonicalNotes(page);
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Groceries');
 await page.getByRole('textbox',{name:'Note',exact:true}).fill('Oat milk\nLemons');
 await page.getByRole('button',{name:'Turn into checklist',exact:true}).click();
 await page.getByRole('button',{name:'Check Oat milk',exact:true}).click();
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog',{name:'Note actions'}).getByRole('button',{name:'Pin',exact:true}).click();
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await expect.poll(()=>snapshot(page).then((s:any)=>s.notes[0]?.format)).toEqual({kind:'list',data:{items:[{t:'Oat milk',done:true},{t:'Lemons',done:false}],pinned:true}});
 const card=page.getByRole('button',{name:'Open Groceries',exact:true});
 await expect(card).toBeVisible();
 // The checklist row: its items in the two-line preview, under Pinned.
 await expect(card).toContainText('☑ Oat milk');await expect(card).toContainText('☐ Lemons');
 await expect(page.locator('.notes-section',{hasText:'Pinned'})).toBeVisible();
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

test('Delete on a new note that was never saved closes it without a Notes request',async({page})=>{
 const {foreign,errors}=await canonicalNotesFixture(page);await openCanonicalNotes(page);
 const before=await page.evaluate(()=>(window as any).canonicalNotesFixture.requests.filter((r:any)=>r.method==='POST').length);
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog',{name:'Note actions'}).getByRole('button',{name:'Delete',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'New note',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).canonicalNotesFixture.requests.filter((r:any)=>r.method==='POST').length)).toBe(before);
 expect((await snapshot(page)).notes).toEqual([]);expect((await snapshot(page)).trash).toEqual([]);
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

test('slow saves: typing during a new note\'s first save makes one record, and Delete waits for the save',async({page})=>{
 const {foreign,errors}=await canonicalNotesFixture(page);await openCanonicalNotes(page);
 await page.evaluate(()=>(window as any).canonicalNotesFixture.delay=250);
 const title=page.getByRole('textbox',{name:'Title',exact:true}),body=page.getByRole('textbox',{name:'Note',exact:true}),review=page.getByRole('button',{name:/^(Reload Notes|Discard draft and reload)$/});
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await title.pressSequentially('Hello',{delay:40});await body.pressSequentially('World',{delay:40});
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await expect.poll(()=>snapshot(page).then((s:any)=>s.notes.map((n:any)=>[n.title,n.body]))).toEqual([['Hello','\nWorld']]);
 const creates=(await page.evaluate(()=>(window as any).canonicalNotesFixture.requests)).filter((r:any)=>r.body?.capability==='create-note');
 expect(creates).toHaveLength(1);
 // Delete while the first save of a new note is still in flight: it waits, then trashes that record.
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await title.fill('Fresh');
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog',{name:'Note actions'}).getByRole('button',{name:'Delete',exact:true}).click();
 await expect.poll(()=>snapshot(page).then((s:any)=>s.trash.map((entry:any)=>entry.note.title)),{timeout:10_000}).toEqual(['Fresh']);
 await expect(title).toHaveCount(0);
 await expect(review).toHaveCount(0);
 expect((await snapshot(page)).notes.map((n:any)=>n.title)).toEqual(['Hello']);
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

test('an agent append refreshes the open note and its row, and a stale owner edit is kept for review',async({page})=>{
 const at='2026-10-30T09:00:00.000Z';
 const {foreign,errors}=await canonicalNotesFixture(page,{notes:[
  {id:'launch',title:'Launch plan',body:'\nConfirm attestation flow',color:'yellow',createdAt:at,updatedAt:at},
  {id:'groceries',title:'Groceries',body:'',color:'yellow',createdAt:at,updatedAt:at,format:{kind:'list',data:{items:[{t:'Oat milk',done:false}]}}},
 ]});
 await openCanonicalNotes(page);
 // The agent's NOTES action commits outside the view; its reply's same-session invalidation
 // (connection-ui.tsx, app-record-completion.ts) is the only signal the view gets.
 const agentEdit=(id:string,announce=true)=>page.evaluate(({id,announce})=>{
  const f=(window as any).canonicalNotesFixture,note=f.state.notes.find((n:any)=>n.id===id);
  if(note.format?.kind==='list')note.format.data.items.push({t:'Agent item',done:false});else note.body+='\nAppended by the agent';
  f.state.revision++;
  if(announce)window.dispatchEvent(new CustomEvent('alpha:canonical-notes-invalidated',{detail:{sessionId:'canonical-fixture-session',revision:f.state.revision}}));
 },{id,announce});
 const body=page.getByRole('textbox',{name:'Note',exact:true});
 await page.getByRole('button',{name:'Open Launch plan',exact:true}).click();
 await expect(body).toHaveValue('Confirm attestation flow');
 await agentEdit('launch');
 await expect(body).toHaveValue('Confirm attestation flow\nAppended by the agent');
 // The owner's next edit names the revision that includes the agent's append.
 await body.fill('Confirm attestation flow\nAppended by the agent\nOwner line');
 await expect.poll(()=>snapshot(page).then((s:any)=>s.notes.find((n:any)=>n.id==='launch').body)).toBe('\nConfirm attestation flow\nAppended by the agent\nOwner line');
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open Launch plan',exact:true})).toContainText('Owner line');
 await agentEdit('groceries');
 await expect(page.getByRole('button',{name:'Open Groceries',exact:true})).toContainText('Agent item');
 // An agent change the view has not heard about yet: the owner's edit names an older revision, so
 // it is refused, the owner's text stays in the editor and nothing overwrites the agent's change.
 await page.getByRole('button',{name:'Open Launch plan',exact:true}).click();
 await agentEdit('launch',false);
 await body.fill('Owner text against an older revision');
 await expect(page.getByRole('button',{name:'Discard draft and reload',exact:true})).toBeVisible();
 await expect(body).toHaveValue('Owner text against an older revision');
 expect((await snapshot(page)).notes.find((n:any)=>n.id==='launch').body).toBe('\nConfirm attestation flow\nAppended by the agent\nOwner line\nAppended by the agent');
 await page.getByRole('button',{name:'Discard draft and reload',exact:true}).click();
 await expect(body).toHaveValue('Confirm attestation flow\nAppended by the agent\nOwner line\nAppended by the agent');
 const updates=(await page.evaluate(()=>(window as any).canonicalNotesFixture.requests)).filter((r:any)=>r.body?.capability==='update-note');
 expect(updates.length).toBeGreaterThan(0);for(const update of updates)expect(Number.isSafeInteger(update.body.params.expectedRevision)).toBe(true);
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

test('the single Notes list hides Previous notes without importing or changing retained device data',async({page})=>{
 const {errors}=await canonicalNotesFixture(page);
 const before=await page.evaluate(async()=>{
  const m=await import('/src/runtime/browser-notes-document.ts');
  await(await m.openBrowserNotes()).replace([{id:'old-note',kind:'text',title:'Previous local note',body:'Retained exact local text',custom:{keep:'verbatim'}}]);
  return m.readBrowserNotesRaw();
 });
 await openCanonicalNotes(page);
 await expect(page.getByRole('button',{name:'Open Previous local note',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Record voice note',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Previous notes',exact:true})).toHaveCount(0);
 await expect(page.getByRole('group',{name:'Folders',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'New note',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Canonical only');
 await page.getByRole('textbox',{name:'Note',exact:true}).fill('New text stays in the canonical store.');
 await expect(page.getByRole('button',{name:'Done editing note',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Back to notes',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open Canonical only',exact:true})).toBeVisible();
 expect(await page.evaluate(async()=>(await import('/src/runtime/browser-notes-document.ts')).readBrowserNotesRaw())).toBe(before);
 expect((await snapshot(page)).notes.map((note:any)=>note.title)).toEqual(['Canonical only']);
 expect(errors).toEqual([]);
});

test('canonical Notes editor stays focusable beside half chat and isolates without losing its draft under full chat',async({page})=>{
 await page.setViewportSize({width:412,height:915});
 const {foreign,errors}=await canonicalNotesFixture(page);await openCanonicalNotes(page);
 await page.getByRole('button',{name:'New note',exact:true}).click();
 const title=page.getByRole('textbox',{name:'Title',exact:true}),note=page.getByRole('textbox',{name:'Note',exact:true});
 const body='Retained overlay draft.\n'+'Exact authored line.\n'.repeat(24);
 await title.fill('Overlay draft');await note.fill(body);
 const notes=page.locator('[data-alpha-layer="app"]'),panel=page.locator('[data-alpha-layer="conversation"]');
 await page.getByRole('button',{name:'Open conversation',exact:true}).click();
 await page.getByRole('textbox',{name:'Message Alpha',exact:true}).fill('Keep the unsent chat draft');
 await panel.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
 await expect(notes).not.toHaveAttribute('inert','');
 await note.focus();await expect(note).toBeFocused();
 await expect.poll(async()=>{const n=await note.boundingBox(),p=await panel.boundingBox();return n&&p?n.y+n.height-p.y:999;}).toBeLessThanOrEqual(-8);
 await page.getByRole('button',{name:'Expand chat',exact:true}).click();
 await expect(notes).toHaveAttribute('inert','');await expect(notes).toHaveAttribute('aria-hidden','true');
 await expect(notes.getByRole('textbox',{name:'Note',exact:true})).toHaveCount(0);
 for(let i=0;i<8;i++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement?.closest('[data-alpha-layer="app"]'))).toBe(false);}
 await page.getByRole('button',{name:'Shrink chat',exact:true}).click();
 await expect(notes).not.toHaveAttribute('inert','');
 await expect(title).toHaveValue('Overlay draft');await expect(note).toHaveValue(body);
 await expect(page.getByRole('textbox',{name:'Message Alpha',exact:true})).toHaveValue('Keep the unsent chat draft');
 await page.getByRole('button',{name:'Back to notes',exact:true}).press('Enter');
 await expect.poll(()=>snapshot(page).then((s:any)=>s.notes.length)).toBe(1);
 expect((await snapshot(page)).notes[0].body).toBe('\n'+body);
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

// Existing authenticated invalidation triggers a read without closing or discarding the editor.
const refreshCanonicalRead=(page:import('@playwright/test').Page)=>page.evaluate(()=>{
 window.dispatchEvent(new CustomEvent('alpha:canonical-notes-invalidated',{detail:{sessionId:'canonical-fixture-session'}}));
});
const readWarning='Notes could not be opened. Check the agent connection, then reload.';

test('an initial Notes read failure stays read-only and a successful refresh clears its review',async({page})=>{
 const {foreign,errors}=await canonicalNotesFixture(page,{failReads:true});
 await page.getByRole('button',{name:'Notes',exact:true}).click();
 await expect(page.getByText(readWarning,{exact:true})).toBeVisible();
 await expect(page.getByText('That change could not be confirmed. Reload Notes to see what was saved.',{exact:true})).toHaveCount(0);
 expect((await snapshot(page)).revision).toBe(0);
 await page.evaluate(()=>(window as any).canonicalNotesFixture.failReads=false);
 await refreshCanonicalRead(page);
 await expect(page.getByText(readWarning,{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Reload Notes',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'New note',exact:true})).toBeEnabled();
 const requests=await page.evaluate(()=>(window as any).canonicalNotesFixture.requests);
 expect(requests.filter((r:any)=>r.method==='POST')).toEqual([]);
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});
for(const populated of [false,true])test(`a cached revision ${populated?'one':'zero'} read failure is not a mutation and recovers without a write`,async({page})=>{
 const notes=populated?[{id:'read-target',title:'Retained read target',body:'\nExact retained body',color:'yellow',createdAt:'2026-10-31T10:00:00.000Z',updatedAt:'2026-10-31T10:00:00.000Z'}]:[];
 const {foreign,errors}=await canonicalNotesFixture(page,{notes});await openCanonicalNotes(page);
 const before=await snapshot(page);
 await page.evaluate(()=>(window as any).canonicalNotesFixture.failReads=true);
 await refreshCanonicalRead(page);
 await expect(page.getByText(readWarning,{exact:true})).toBeVisible();
 await expect(page.getByText('That change could not be confirmed. Reload Notes to see what was saved.',{exact:true})).toHaveCount(0);
 if(populated)await expect(page.getByRole('button',{name:'Open Retained read target',exact:true})).toBeVisible();
 expect(await snapshot(page)).toEqual(before);
 await page.evaluate(()=>(window as any).canonicalNotesFixture.failReads=false);
 await refreshCanonicalRead(page);
 await expect(page.getByText(readWarning,{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Reload Notes',exact:true})).toHaveCount(0);
 expect(await snapshot(page)).toEqual(before);
 const requests=await page.evaluate(()=>(window as any).canonicalNotesFixture.requests);
 expect(requests.filter((r:any)=>r.method==='POST')).toEqual([]);
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});
test('a later read failure and recovery cannot clear accepted-write uncertainty or discard its dirty draft',async({page})=>{
 const notes=[{id:'uncertain-target',title:'Accepted response target',body:'\nOriginal body',color:'yellow',createdAt:'2026-10-31T10:00:00.000Z',updatedAt:'2026-10-31T10:00:00.000Z'}];
 const {foreign,errors}=await canonicalNotesFixture(page,{notes});await openCanonicalNotes(page);
 await page.getByRole('button',{name:'Open Accepted response target',exact:true}).click();
 await page.evaluate(()=>(window as any).canonicalNotesFixture.failAfterApplied=true);
 const body=page.getByRole('textbox',{name:'Note',exact:true});
 await body.fill('Exact draft after an accepted write whose response was lost');
 await expect(page.getByRole('button',{name:'Discard draft and reload',exact:true})).toBeVisible();
 const accepted=await snapshot(page);expect(accepted.revision).toBe(2);
 expect(accepted.notes[0].body).toBe('\nExact draft after an accepted write whose response was lost');
 const writes=await page.evaluate(()=>(window as any).canonicalNotesFixture.requests.filter((r:any)=>r.method==='POST').length);
 await page.evaluate(()=>{const f=(window as any).canonicalNotesFixture;f.failAfterApplied=false;f.failReads=true;});
 await refreshCanonicalRead(page);
 await expect(page.getByText('Your draft is shown here until you reload or the connection changes. Reload the current notes to discard it.',{exact:true})).toBeVisible();
 const acceptedReadsBeforeRecovery=await page.evaluate(()=>(window as any).canonicalNotesFixture.acceptedReads.length);
 await page.evaluate(()=>(window as any).canonicalNotesFixture.failReads=false);
 await refreshCanonicalRead(page);
 // Only a successful original refresh records the current controller's accepted snapshot.
 await expect.poll(()=>page.evaluate(({after,revision})=>(window as any).canonicalNotesFixture.acceptedReads
  .slice(after).some((read:any)=>read.current&&read.sameController&&read.revision===revision),
  {after:acceptedReadsBeforeRecovery,revision:accepted.revision})).toBe(true);
 await expect(page.getByRole('button',{name:'Discard draft and reload',exact:true})).toBeVisible();
 await expect(body).toHaveValue('Exact draft after an accepted write whose response was lost');
 expect(await snapshot(page)).toEqual(accepted);
 expect(await page.evaluate(()=>(window as any).canonicalNotesFixture.requests.filter((r:any)=>r.method==='POST').length)).toBe(writes);
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

test('read recovery cannot replace a no-draft uncertain interaction with a read-only warning',async({page})=>{
 const {foreign,errors}=await canonicalNotesFixture(page);await openCanonicalNotes(page);
 await page.evaluate(()=>{
  const f=(window as any).canonicalNotesFixture;
  f.state.revision=1;
  f.state.trash=[{note:{id:'restore-uncertain',title:'Uncertain restore',body:'\nExact recoverable body',color:'yellow',createdAt:'2026-10-31T10:00:00.000Z',updatedAt:'2026-10-31T10:00:00.000Z'},deletedAt:'2026-10-31T10:01:00.000Z'}];
 });
 await refreshCanonicalRead(page);
 await page.getByRole('button',{name:'Recently deleted',exact:true}).click();
 const restore=page.locator('[data-alpha-subview="notes-trash"]').getByRole('button',{name:'Uncertain restore',exact:true});
 await expect(restore).toBeVisible();
 await page.evaluate(()=>(window as any).canonicalNotesFixture.failAfterApplied=true);
 await restore.click();await page.getByRole('dialog',{name:'Uncertain restore'}).getByRole('button',{name:'Recover',exact:true}).click();
 const changeWarning='That change could not be confirmed. Reload Notes to see what was saved.';
 await expect(page.getByText(changeWarning,{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Discard draft and reload',exact:true})).toHaveCount(0);
 const accepted=await snapshot(page);expect(accepted.trash).toEqual([]);expect(accepted.notes.map((note:any)=>note.id)).toEqual(['restore-uncertain']);
 const writes=await page.evaluate(()=>(window as any).canonicalNotesFixture.requests.filter((r:any)=>r.method==='POST').length);
 const reads=await page.evaluate(()=>(window as any).canonicalNotesFixture.requests.filter((r:any)=>r.path==='/api/notes/state').length);
 await page.evaluate(()=>{const f=(window as any).canonicalNotesFixture;f.failAfterApplied=false;f.failReads=true;});
 await refreshCanonicalRead(page);
 await expect.poll(()=>page.evaluate(()=>(window as any).canonicalNotesFixture.requests.filter((r:any)=>r.path==='/api/notes/state').length)).toBeGreaterThan(reads);
 await expect(page.getByText(changeWarning,{exact:true})).toBeVisible();
 await expect(page.getByText(readWarning,{exact:true})).toHaveCount(0);
 await expect(restore).toBeVisible();
 await page.evaluate(()=>(window as any).canonicalNotesFixture.failReads=false);
 await refreshCanonicalRead(page);
 // The old Trash row disappearing proves the accepted read snapshot reached the actual UI.
 await expect(restore).toHaveCount(0);
 await expect(page.getByText(changeWarning,{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Reload Notes',exact:true})).toBeVisible();
 expect(await snapshot(page)).toEqual(accepted);
 expect(await page.evaluate(()=>(window as any).canonicalNotesFixture.requests.filter((r:any)=>r.method==='POST').length)).toBe(writes);
 expect(foreign).toEqual([]);expect(errors).toEqual([]);
});

test('audio-only recorder saves a separate canonical voice note without replacing a dirty text draft',async({page})=>{
 await canonicalNotesFixture(page);
 const result=await page.evaluate(async()=>{
  const {connectionController}=await import('/src/runtime/connection-ui.tsx');
  const {CanonicalNotesUi}=await import('/src/prototype/canonical-notes-ui.ts');
  const fixture=(window as any).canonicalNotesFixture,retained:string[]=[];
  const ui=new CanonicalNotesUi(connectionController.getAppRecordClient()!,{paint(){},review(){}});
  try{
   await ui.refresh();ui.editor.begin('text');ui.editor.edit({title:'Unfinished text',body:'Keep exactly this draft.'});
   const before=structuredClone(ui.editor.draft);
   const saved=await ui.saveVoice('recording-audio-only-1','',2500,null,()=>true,{pending:false,claim:async()=>true,retainAudio:async noteId=>{retained.push(noteId);return {audioId:'recording-audio-only-1',noteId,durationMs:2500,transcript:''};}});
   return {saved,before,after:ui.editor.draft,retained,notes:fixture.state.notes,rows:ui.list,posts:fixture.requests.filter((r:any)=>r.method==='POST')};
  }finally{ui.retire();}
 });
 expect(result.saved).toBe(true);expect(result.notes).toHaveLength(1);expect(result.posts).toHaveLength(1);
 expect(result.retained).toEqual([result.notes[0].id]);expect(result.after?.token).toBe(result.before?.token);expect(result.after?.body).toBe('Keep exactly this draft.');
 const voice=result.rows.find((row:any)=>row.id===result.notes[0].id);
 expect(voice).toMatchObject({kind:'voice',audio:{audioId:'recording-audio-only-1',noteId:result.notes[0].id,durationMs:2500}});
});

test('lost canonical audio-note create is read back before attaching audio without replay',async({page})=>{
 await canonicalNotesFixture(page);
 const result=await page.evaluate(async()=>{
  const {connectionController}=await import('/src/runtime/connection-ui.tsx');
  const {CanonicalNotesUi}=await import('/src/prototype/canonical-notes-ui.ts');
  const fixture=(window as any).canonicalNotesFixture;let pending=false,claims=0;const retained:string[]=[];
  const attempt=async()=>{
   const ui=new CanonicalNotesUi(connectionController.getAppRecordClient()!,{paint(){},review(){}});
   try{return await ui.saveVoice('recording-audio-only-2','',3000,null,()=>true,{pending,claim:async()=>{if(pending)return false;pending=true;claims++;return true;},retainAudio:async noteId=>{retained.push(noteId);return {audioId:'recording-audio-only-2',noteId,durationMs:3000,transcript:''};}});}
   finally{ui.retire();}
  };
  fixture.failAfterApplied=true;const first=await attempt();const afterLost=retained.length;const second=await attempt();
  return {first,second,afterLost,claims,retained,notes:fixture.state.notes,posts:fixture.requests.filter((r:any)=>r.method==='POST')};
 });
 expect(result).toMatchObject({first:false,second:true,afterLost:0,claims:1});expect(result.notes).toHaveLength(1);expect(result.posts).toHaveLength(1);expect(result.retained).toEqual([result.notes[0].id]);
});

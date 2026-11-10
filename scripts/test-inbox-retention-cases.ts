// An open message survives failures of its parts (a stale body refresh, a resume check, an attachment,
// a conversation page), a revoked grant still closes it, and an aborted read keeps the list's cursor
// and offline snapshot. Real adapter, closed provider fixture; no network, account or mail.
import assert from 'node:assert/strict';
import test from 'node:test';
import { boot, deq, inboxPage, mail } from './inbox-adapter-fixture.ts';

type Fixture = Awaited<ReturnType<typeof boot>>;
const http=(status: number)=>Object.assign(new Error('Fixture HTTP '+status),{name:'CloudProtocolError',code:'http',status});
const notes={partId:'2',name:'notes.txt',mimeType:'text/plain',size:5,supported:true};
// Reads that carry a revision (historyId) and, for m1, one previewable attachment.
const revisions=(t: Fixture)=>{const reads=new Map<string, number>();t.client.gmailRead=async(_grant,id)=>{t.calls.push(['read',id]);reads.set(id,(reads.get(id)||0)+1);const m=inboxPage.find(x=>x.id===id)||mail(id);return {message:m,bodyText:'Body '+id,links:[],historyId:'h-'+id,attachments:id==='m1'?[notes]:[]};};return reads;};
const reads=(t: Fixture,id: string)=>t.calls.filter(c=>Array.isArray(c)&&c[0]==='read'&&c[1]===id).length;
async function open(t: Fixture,index: number){t.shell.st.open=null;t.render().rows[index].open();await t.tick();}
test('1. A saved body older than the list TTL is shown at once; a failed refresh of it keeps the reader.',async()=>{
 const t=await boot();revisions(t);t.mount();t.setActive(true);t.render();await t.tick();
 await open(t,2);assert.equal(t.reader().body,'Body m3');
 t.advance(6*60000);t.client.gmailRead=async()=>{throw http(503);};
 await open(t,2);
 const d=t.reader();assert.ok(d,'the reader stays open');assert.equal(d.body,'Body m3');assert.equal(d.failed,false);assert.equal(t.shell.st.open,'m3');
 assert.ok(t.toasts.length>0,'the failure is said once');assert.equal(t.render().rows.length,3,'the list stays');
 t.shell.componentWillUnmount();
});

test('2. A resume check that fails while a message is open keeps it.',async()=>{
 const t=await boot();revisions(t);t.mount();t.setActive(true);t.render();await t.tick();
 await open(t,2);const before=t.toasts.length;
 t.client.gmailAccounts=async()=>{throw http(503);};for(const fn of t.resume)fn();await t.tick();
 assert.ok(t.render().d,'the reader stays open');assert.equal(t.reader().body,'Body m3');assert.equal(t.shell.st.open,'m3');assert.ok(t.toasts.length>before);
 t.shell.componentWillUnmount();
});

test('3. A 503 on an attachment, the conversation or its next page keeps the reader and the thread.',async()=>{
 const t=await boot();revisions(t);t.mount();t.setActive(true);t.render();await t.tick();
 await open(t,0);t.client.gmailAttachment=async()=>{throw http(503);};
 t.reader().atts[0].open();await t.tick();
 assert.ok(t.render().d,'attachment failure keeps the reader');assert.equal(t.render().attachment,null);assert.equal(t.shell.st.open,'m1');
 t.client.gmailThread=async()=>{throw http(503);};await open(t,0);
 assert.ok(t.render().d,'conversation failure keeps the reader');
 const m1=inboxPage[0];t.client.gmailThread=async(_grant,_thread,_signal,cursor)=>{if(cursor)throw http(503);return {messages:[{message:m1,bodyText:'Body m1',links:[],historyId:'h-m1',attachments:[notes]}],total:2,offset:0,historyId:'th',nextOffset:1};};
 t.render().refresh();await t.tick();assert.equal(t.reader().hasThread,true);
 t.reader().nextThread();await t.tick();
 assert.ok(t.render().d,'page failure keeps the reader');assert.equal(t.reader().hasThread,true,'and the thread');
 t.shell.componentWillUnmount();
});

test('4. Regression guard: a revoked grant (403) closes the reader; no provider content stays on screen.',async()=>{
 const t=await boot();revisions(t);t.mount();t.setActive(true);t.render();await t.tick();
 await open(t,0);t.client.gmailAttachment=async()=>{throw http(403);};
 t.reader().atts[0].open();await t.tick();
 assert.equal(t.render().d,null);assert.equal(t.shell.st.open,null);assert.equal(t.render().rows.length,0);
 t.shell.componentWillUnmount();
});

test('5. Opening a message while Load more is reading keeps the cursor, and Load more works again.',async()=>{
 const t=await boot();revisions(t);const search=t.client.gmailSearch;
 t.client.gmailSearch=async(grant,query,signal,size,pageToken)=>{
  if(query!=='in:inbox')return search(grant,query,signal,size,pageToken);
  t.calls.push(['search',query,size,pageToken??null]);
  if(!pageToken)return {messages:inboxPage,syncedAt:'2026-10-08T12:01:00Z',nextPageToken:'p2'};
  return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
 };
 t.mount();t.setActive(true);t.render();await t.tick();
 assert.equal(t.render().hasMore,true);t.render().loadMore();await t.tick();assert.equal(t.render().loadingMore,true);
 t.render().rows[2].open();await t.tick();
 t.views.inbox.back(t.shell.st,t.api);await t.tick();
 const view=t.render();assert.equal(view.hasMore,true,'the cursor is kept');assert.equal(view.loadingMore,false);assert.equal(view.loadMoreDisabled,false);
 t.shell.componentWillUnmount();
});

test('6. A stale review re-reads the open message instead of showing the saved body again.',async()=>{
 const t=await boot();revisions(t);t.mount();t.setActive(true);t.render();await t.tick();
 await open(t,2);const before=reads(t,'m3');
 t.client.gmailPrepareOperation=async()=>{throw http(409);};
 t.reader().archive();await t.tick();assert.equal(t.provider().retryLabel,'Retry with the current message');
 t.provider().retry();await t.tick();
 assert.equal(reads(t,'m3'),before+1,'the open message is read again');assert.equal(t.reader().body,'Body m3');
 t.shell.componentWillUnmount();
});

test('7. Reloading Drafts from its first page keeps Load more.',async()=>{
 const t=await boot({caps:{draftsList:true}});revisions(t);
 t.client.gmailDrafts=async(_grant,_signal,pageToken)=>{t.calls.push(['drafts',pageToken??null]);return {drafts:[{draftId:pageToken?'d2':'d1',messageId:'dm',subject:'Draft',to:[],snippet:'',updatedAt:null}],nextPageToken:pageToken?null:'dp2'};};
 t.mount();t.setActive(true);t.render();await t.tick();
 t.chip('Drafts').pick();await t.tick();assert.equal(t.render().hasMore,true);
 t.render().refresh();await t.tick();
 assert.equal(t.render().hasMore,true,'a reload from the first page offers the next page again');
 t.render().loadMore();await t.tick();deq(t.calls.filter(c=>Array.isArray(c)&&c[0]==='drafts').map(c=>c[1]),[null,null,'dp2']);
 t.shell.componentWillUnmount();
});

test('8. A failed refresh keeps the offline snapshot and says the saved mail could not be updated.',async()=>{
 const t=await boot();revisions(t);const saved=new Map();
 t.sandbox.serviceReadCache=async()=>({get:async key=>saved.has(key)?{value:saved.get(key),at:Date.now()}:null,put:async(key,value)=>{saved.set(key,structuredClone(value));},clear:async()=>{saved.clear();}});
 const snapshot=t.sandbox.connectionController.getSnapshot;t.sandbox.connectionController.getSnapshot=()=>{const value=snapshot();return value.cloudAccount?{...value,cloudAccount:{...value.cloudAccount,organizationId:'fixture-org'}}:value;};
 t.mount();t.setActive(true);t.render();await t.tick();
 assert.ok(saved.get('gmail:mailbox'),'the loaded mailbox is saved on this device');
 t.setActive(false);t.views.inbox.onLeave();await t.tick();t.advance(2*60000);
 t.client.gmailSearch=async()=>{throw http(503);};
 t.setActive(true);t.render();await t.tick();
 assert.equal(t.render().rows.length,3);assert.equal(t.render().cachedListShown,true);
 t.render().refresh();await t.tick();
 assert.equal(t.render().rows.length,3);assert.equal(t.render().cachedListShown,true);
 assert.ok(saved.get('gmail:mailbox'),'the offline snapshot is kept');
 t.shell.componentWillUnmount();
});

test('9. A read change that reports no new revision reads the message again before Archive uses one.',async()=>{
 const t=await boot({caps:{readState:true}});revisions(t);const gate=Promise.withResolvers<void>();let m1Reads=0;
 const read=t.client.gmailRead;t.client.gmailRead=async(grant,id,signal)=>{if(id!=='m1')return read(grant,id,signal);m1Reads++;const value=await read(grant,id,signal);if(m1Reads===1)return value;await gate.promise;return {...value,historyId:'h-m1-2'};};
 t.client.gmailDispatchOperation=async(_grant,requestId,_digest,proposal)=>({requestId,kind:proposal.kind,state:'succeeded',reviewDigest:'',providerResult:{messageId:proposal.messageId,unread:proposal.kind==='mark-unread',historyId:null},rejectionCode:null});
 t.mount();t.setActive(true);t.render();await t.tick();
 await open(t,0);
 const d=t.reader();assert.equal(d.canArchive,false,'Archive waits for the new revision');assert.equal(d.canToggleRead,false);
 d.archive();await t.tick();assert.equal(t.prepared.filter(p=>p.kind==='archive').length,0,'nothing is prepared against the old revision');
 gate.resolve();await t.tick();
 assert.equal(t.reader().canArchive,true);
 deq(t.prepared.filter(p=>p.kind==='archive').map(p=>p.expectedHistoryId),['h-m1-2'],'Archive uses the re-read revision');
 t.shell.componentWillUnmount();
});

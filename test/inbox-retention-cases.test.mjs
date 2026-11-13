import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {createInboxFixture} from '../specs/quint/refinement/services/inbox-coordinator-ports.mjs';
test('Inbox retains reviewed message, cursor and offline snapshot through read failures',()=>{
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const run=spawnSync(process.execPath,['test','./scripts/test-inbox-retention-cases.ts'],{env,encoding:'utf8',timeout:scaledTimeout(30000),maxBuffer:1024*1024});
 assert.equal(run.status,0,run.stdout+'\n'+run.stderr);
 // Bun prints its summary on stderr.
 assert.match(run.stderr,/^ 9 pass$/m);assert.match(run.stderr,/^ 0 fail$/m);assert.match(run.stderr,/^Ran 9 tests across 1 file\./m);
});

for(const rollback of [false,true])test(`revoked saved Inbox stays hidden after failed eviction${rollback?' and clock rollback':''}`,async()=>{
 const f=await createInboxFixture();
 f.sandbox.document.querySelector=()=>null;f.sandbox.wallClock=10000;
 vm.runInContext(`{const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){if(args.length)super(...args);else super(globalThis.wallClock);}static now(){return globalThis.wallClock;}};}`,f.sandbox);
 const binding=f.controller.getCloudClient(),cloud=f.controller.getSnapshot().cloudAccount;
 const disk=await f.modules.serviceReadCache({environment:cloud.environment,userId:cloud.userId,organizationId:cloud.organizationId,credentialId:binding.credentialId},'gmail');
 const account={connectionId:'grant-1',label:'Synthetic account',connected:true,grantedCapabilities:['google.gmail.triage']};
 const message={id:'old',threadId:'thread-old',from:'Synthetic sender',fromEmail:'sender@example.invalid',to:[],subject:'Revoked saved subject',snippet:'Saved preview',receivedAt:null,unread:false};
 const list={key:JSON.stringify([binding.sessionId,binding.credentialId,account.connectionId,'in:inbox']),at:10000,firstPageRevision:null,messages:[message],query:'in:inbox',cursor:null,revision:'old',cursors:[],newerMail:false,status:'1 message'};
 await disk.put('gmail:mailbox',{accounts:[account],selected:account.connectionId,spamTrashSearch:false,lists:[list],bodies:[{at:10000,body:{message,bodyText:'Revoked saved body',historyId:'old'}}]});
 const checks=[],pages=[];
 f.client.gmailAccounts=signal=>{const d=Promise.withResolvers();checks.push({...d,signal});return d.promise;};
 f.client.gmailSearch=()=>{const d=Promise.withResolvers();pages.push(d);return d.promise;};
 const fresh={...message,id:'fresh',threadId:'thread-fresh',subject:'Fresh subject'};
 f.client.gmailRead=async()=>({message:fresh,bodyText:'Fresh body',historyId:'fresh'});
 const getClient=f.controller.getCloudClient;f.controller.getCloudClient=()=>null;
 const mounted=f.mount();let active=true;mounted.api.isActive=()=>active;f.controller.getCloudClient=getClient;
 const subjects=()=>Array.from(mounted.render().rows,row=>row.subj);
 const reenter=async()=>{active=false;mounted.views.inbox.onLeave();await f.settle();active=true;mounted.render();await f.settle();};
 try{
  mounted.render();await f.settle();assert.deepEqual(subjects(),[message.subject]);
  f.state.failStore=true;f.sandbox.wallClock=rollback?9000:10000;
  checks.at(-1).resolve([]);await f.settle();assert.deepEqual(subjects(),[]);
  await reenter();assert.deepEqual(subjects(),[]);
  f.sandbox.wallClock=11000;await reenter();
  assert.deepEqual(subjects(),[],'known revoked bytes stay hidden when the clock recovers');
  checks.at(-1).resolve([account]);await f.settle();
  assert.deepEqual(subjects(),[],'restored grant alone does not restore old mail before a fresh read');
  assert.ok(pages.length,'a fresh provider page is pending');
  pages.at(-1).resolve({messages:[fresh],syncedAt:'fresh',nextPageToken:null});await f.settle();
  assert.deepEqual(subjects(),[fresh.subject]);
  assert.equal((await disk.get('gmail:mailbox')).value.lists[0].messages[0].subject,message.subject,'failed persistence leaves the old physical bytes');
  mounted.render().refresh();await f.settle();pages.at(-1).reject(new TypeError('Offline'));await f.settle();
  await reenter();assert.deepEqual(subjects(),[],'a fresh read whose save failed cannot bless old disk bytes');
  f.state.failStore=false;checks.at(-1).resolve([account]);await f.settle();
  f.sandbox.wallClock=12000;pages.at(-1).resolve({messages:[fresh],syncedAt:'fresh',nextPageToken:null});await f.settle();
  assert.deepEqual(subjects(),[fresh.subject]);
  assert.equal((await disk.get('gmail:mailbox')).value.lists[0].messages[0].subject,fresh.subject);
  mounted.render().refresh();await f.settle();pages.at(-1).reject(new TypeError('Offline'));await f.settle();
  await reenter();assert.deepEqual(subjects(),[fresh.subject],'successfully saved fresh mail remains available after restoration');
  assert.match(mounted.render().cachedListNotice,/Saved mail/);
  assert.equal(mounted.views.inbox.emailTarget().ready,false);
  mounted.render().rows[0].open();await f.settle();
  assert.equal(mounted.render().d.body,'Fresh body');assert.equal(mounted.render().d.actionsAvailable,false);
  assert.equal(mounted.shell.st.nativeMailSelection,null);assert.equal(f.state.prepares,0);assert.equal(f.state.dispatches,0);
 }finally{
  active=false;mounted.dispose();for(const c of checks)c.resolve([]);for(const page of pages)page.resolve({messages:[],syncedAt:'cleanup',nextPageToken:null});await f.settle();
 }
});

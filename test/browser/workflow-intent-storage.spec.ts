import { returnToApps } from './app-navigation';
import {test,expect} from '@playwright/test';
const owner={origin:'https://synthetic.invalid',ownerId:'owner',agentId:'agent'};
test.beforeEach(async({page})=>{await page.addInitScript(()=>{if(!localStorage.getItem('alpha.connection.selection.v1'))localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));});await page.goto('/');});
test('two tabs admit exactly one request for each operation and retain unrelated requests',async({page,context})=>{
 const other=await context.newPage();await other.goto('/');
 for(const suffix of ['',':metadata',':lifecycle',':approval:run']){
  const outcomes=await Promise.all([page,other].map(tab=>tab.evaluate(async({owner,suffix})=>{const {WorkflowIntentStore,workflowIntentKey}=await import('/src/runtime/workflow-intents.ts');const store=new WorkflowIntentStore(owner);try{await store.admit(workflowIntentKey(owner,'flow')+suffix,{versionId:'v1',mutationId:'reviewed'});return 'saved';}catch{return 'conflict';}},{owner,suffix})));
  expect(outcomes.sort()).toEqual(['conflict','saved']);
 }
 expect(await page.evaluate(async owner=>{const {WorkflowIntentStore}=await import('/src/runtime/workflow-intents.ts');return Object.keys(await new WorkflowIntentStore(owner).load()).length;},owner)).toBe(4);
});
test('old completion cannot clear an identical replacement intent',async({page})=>{
 expect(await page.evaluate(async owner=>{const {WorkflowIntentStore,workflowIntentKey}=await import('/src/runtime/workflow-intents.ts'),s=new WorkflowIntentStore(owner),key=workflowIntentKey(owner,'flow'),payload={versionId:'v1'};const first=await s.admit(key,payload);await s.acknowledge(key,first);const second=await s.admit(key,payload);let conflict=false;try{await s.acknowledge(key,first);}catch{conflict=true;}return {distinct:first!==second,conflict,retained:await s.read(key)===second};},owner)).toEqual({distinct:true,conflict:true,retained:true});
});
test('failed acknowledgement preserves exact request and other owners remain independent',async({page})=>{
 expect(await page.evaluate(async owner=>{const {WorkflowIntentStore,workflowIntentKey}=await import('/src/runtime/workflow-intents.ts'),s=new WorkflowIntentStore(owner),key=workflowIntentKey(owner,'flow'),raw=await s.admit(key,{versionId:'v1'}),put=IDBObjectStore.prototype.put;let failed=false;IDBObjectStore.prototype.put=function(v,k){if(k===s.documentKey)throw Error('Synthetic full storage');return put.call(this,v,k);};try{await s.acknowledge(key,raw);}catch{failed=true;}finally{IDBObjectStore.prototype.put=put;}const other={...owner,ownerId:'other'},otherStore=new WorkflowIntentStore(other);await otherStore.admit(workflowIntentKey(other,'flow'),{versionId:'v1'});return {failed,retained:await s.read(key)===raw,other:Object.keys(await otherStore.load()).length};},owner)).toEqual({failed:true,retained:true,other:1});
});
test('legacy malformed requests are backed up exactly and stale reset cannot erase a new request',async({page})=>{
 expect(await page.evaluate(async owner=>{const {WorkflowIntentStore,workflowIntentKey}=await import('/src/runtime/workflow-intents.ts'),s=new WorkflowIntentStore(owner),key=workflowIntentKey(owner,'flow')+':lifecycle';localStorage.setItem(key,'  {broken');await s.load();const pending=s.pendingLifecycle(),domain=await s.recoveryDocument(),captured=await domain.capture();await s.admit(workflowIntentKey(owner,'other'),{versionId:'v2'});let refused=false;try{await domain.reset(captured);}catch{refused=true;}return {backup:JSON.parse(captured.raw!).entries[key],pending,refused,count:Object.keys(await s.load()).length,legacy:localStorage.getItem(key)};},owner)).toEqual({backup:'  {broken',pending:['flow'],refused:true,count:2,legacy:'  {broken'});
});
test('lifecycle discovery survives reload and legacy writers require recovery',async({page})=>{
 await page.evaluate(async owner=>{const {WorkflowIntentStore,workflowIntentKey}=await import('/src/runtime/workflow-intents.ts');await new WorkflowIntentStore(owner).admit(workflowIntentKey(owner,'removed-flow')+':lifecycle',{versionId:'v1',operation:'remove'});},owner);await page.reload();
 expect(await page.evaluate(async owner=>{const {WorkflowIntentStore,workflowIntentKey}=await import('/src/runtime/workflow-intents.ts'),s=new WorkflowIntentStore(owner);await s.load();const pending=s.pendingLifecycle();localStorage.setItem(workflowIntentKey(owner,'old-writer'),'legacy');let refused=false;try{await s.load();}catch{refused=true;}return {pending,refused};},owner)).toEqual({pending:['removed-flow'],refused:true});
});
test('cancelled queued admission does not create a pending request',async({page})=>{
 expect(await page.evaluate(async owner=>{const {WorkflowIntentStore,workflowIntentKey}=await import('/src/runtime/workflow-intents.ts'),s=new WorkflowIntentStore(owner),key=workflowIntentKey(owner,'flow');let release!:()=>void,ready!:()=>void;const acquired=new Promise<void>(r=>ready=r),held=navigator.locks.request(JSON.stringify(['browser-document','alpha.browser.documents.v1',s.documentKey]),async()=>{ready();await new Promise<void>(r=>release=r);});await acquired;const c=new AbortController(),attempt=s.admit(key,{versionId:'v1'},c.signal).then(()=>false,()=>true);c.abort();release();await held;return {cancelled:await attempt,pending:await s.read(key)};},owner)).toEqual({cancelled:true,pending:null});
});
for(const operation of ['run','metadata','lifecycle'])for(const outcome of ['saved','failed','cancelled'])test(`${operation} waits for durable admission: ${outcome}`,async({page})=>{
 const result=await page.evaluate(async({operation,outcome})=>{
  const {WorkflowProtocol}=await import('/src/runtime/workflow-protocol.ts');let release!:()=>void,entered!:()=>void,posts=0;const ready=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r),controller=new AbortController();
  const client=new WorkflowProtocol(async(path,body:any)=>{if(body===undefined)return path.endsWith('/status')?{engine:'smthrs',status:'ready',manualSubmissionProtocol:1,metadataMutationProtocol:1,lifecycleMutationProtocol:1}:{id:'flow',name:'Flow',versionId:'v1',active:false,steps:[]};posts++;if(operation==='run')return {submissionId:body.submissionId,execution:{id:'run',workflowId:'flow',workflowVersionId:'v1',finished:false,status:'running',startedAt:'2027-01-01',events:[]}};const receipt={mutationId:body.mutationId,workflowId:'flow',previousVersionId:'v1',versionId:'v2',appliedAt:'2027-01-01',...(operation==='metadata'?{name:'Edited',description:'',active:false}:{operation:'remove'})};return {mutationId:body.mutationId,receipt};});
  const before=async()=>{entered();await gate;if(outcome==='failed')throw Error('Durable admission failed');};
  const pending=(operation==='run'?client.run('flow','v1',controller.signal,before):operation==='metadata'?client.changeMetadata('flow','v1','Edited','',controller.signal,before):client.lifecycle('flow','v1','remove',controller.signal,before)).then(()=>true,()=>false);
  await ready;const beforePosts=posts;if(outcome==='cancelled')controller.abort();release();return {beforePosts,accepted:await pending,posts};
 },{operation,outcome});expect(result).toEqual({beforePosts:0,accepted:outcome==='saved',posts:outcome==='saved'?1:0});
});
for(const mode of ['reset','leave'])test(`workflow request recovery uses the captured account: ${mode}`,async({page})=>{
 await page.goto('/?mode=dev&workflows=agent');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Agent connection',exact:true}).click();await page.getByRole('button',{name:'Connect development profile'}).click();await expect(page.getByRole('dialog',{name:'Development connections'})).toHaveCount(0);await returnToApps(page);
 const {key,capturedOwner}=await page.evaluate(async()=>{const {connectionController}=await import('/src/runtime/connection-ui.tsx'),{workflowIntentKey}=await import('/src/runtime/workflow-intents.ts');const {origin,ownerId,agentId}=connectionController.getSnapshot().session!,capturedOwner={origin,ownerId,agentId};const key=workflowIntentKey(capturedOwner,'lost-flow')+':lifecycle';localStorage.setItem(key,' {unreadable intent ');return {key,capturedOwner};});
 await page.getByRole('button',{name:'Workflows',exact:true}).click();await expect(page.getByText('Workflow request recovery',{exact:true})).toBeVisible();await expect(page.getByText('Loading workflows…',{exact:true})).toHaveCount(0);await page.getByText('Workflow request recovery',{exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Browser workflow request recovery'});await expect(dialog).toContainText('does not cancel executions');
 if(mode==='leave'){await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await expect(dialog).toHaveCount(0);expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(' {unreadable intent ');return;}
 const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download workflow requests backup',exact:true}).click();const stream=await(await download).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));expect(JSON.parse(Buffer.concat(chunks).toString()).entries[key]).toBe(' {unreadable intent ');
 await dialog.getByRole('button',{name:'Reset app workflow requests',exact:true}).click();await dialog.getByRole('button',{name:'Confirm workflow requests reset',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect.poll(()=>page.evaluate(async()=>{const session=(await import('/src/runtime/connection-ui.tsx')).connectionController.getSnapshot().session;return session?{origin:session.origin,ownerId:session.ownerId,agentId:session.agentId}:null;}),{timeout:45000}).toEqual(capturedOwner);
 expect(await page.evaluate(async owner=>{const {WorkflowIntentStore}=await import('/src/runtime/workflow-intents.ts');return await new WorkflowIntentStore(owner).load();},capturedOwner)).toEqual({});
});

test('a store keeps the snapshot its own write committed, so one retained request never makes unrelated requests read as locked',async({page})=>{
 const result=await page.evaluate(async owner=>{
  const {WorkflowIntentStore,workflowIntentKey}=await import('/src/runtime/workflow-intents.ts');const store=new WorkflowIntentStore(owner),run=workflowIntentKey(owner,'flow'),lifecycle=run+':lifecycle',other=workflowIntentKey(owner,'other');
  const out:Record<string,unknown>={unloaded:[store.stale,store.locked(run),store.locked(other)]};await store.load();
  // A change notice arriving while a reload is in flight discards that reload. The write's own snapshot must survive it.
  const raw=await store.admit(run,{workflowId:'flow',versionId:'v1'});out.admitted=[store.stale,store.locked(run),store.locked(lifecycle),store.locked(other),store.pendingLifecycle()];
  const racing=store.load();store.invalidate();await racing;out.raced=[store.stale,store.locked(other)];await store.load();
  await store.acknowledge(run,raw);out.acknowledged=[store.stale,store.locked(run),store.locked(lifecycle),store.locked(other)];
  // A refused write (the request changed elsewhere) drops the snapshot: everything reads as locked until the next load.
  const second=new WorkflowIntentStore(owner);await second.load();const held=await second.admit(lifecycle,{mutationId:'m',versionId:'v1',operation:'remove'});
  let refused=false;try{await store.admit(lifecycle,{mutationId:'n',versionId:'v1',operation:'remove'});}catch{refused=true;}out.refused=[refused,store.stale,store.locked(other)];
  await store.load();out.reloaded=[store.stale,store.locked(run),store.locked(lifecycle),store.locked(other),store.pendingLifecycle()];await second.acknowledge(lifecycle,held);return out;
 },owner);
 expect(result).toEqual({unloaded:[true,true,true],admitted:[false,true,false,false,[]],raced:[true,true],acknowledged:[false,false,false,false],refused:[true,true,true],reloaded:[false,false,true,false,['flow']]});
});

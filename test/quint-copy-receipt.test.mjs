import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {checkClientFeatures} from '../scripts/prepare-client-features.ts';
import {filesWithin, repositoryRoot as root} from '../scripts/quint-lib.ts';
import {sha256} from '../scripts/sha256.ts';
import {captureInputs, checkTraces, qset} from '../specs/quint/refinement/check-traces.mjs';

const driver=fileURLToPath(import.meta.url),model='CopyReceipt';
const source=resolve(root,'apps/app/src/prototype/browser-camera.ts');
const cacheDir=resolve(root,'test-results/quint-refinement/copy-receipt-vite-cache');
const action=(name,...args)=>({name,args});
const mutations={
 retired: ["if(record.status!=='saving'||record.attempt!==attempt){set(outcome(record));return;}","if(record.attempt!==attempt){set(outcome(record));return;}"],
 replace: ['const replace=input.replace===true;','const replace=true;'],
};

// Same real IndexedDB/canvas boundary as browser-photo-edit.spec.ts. Only decode completion,
// the clock and an explicit IDB abort are controlled; receipt/storage code is never replaced.
async function installFixture() {
 const library=window.copyReceiptModule.browserPhotoLibrary;
 await library.list();
 const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;
 const context=canvas.getContext('2d');context.fillStyle='#b22';context.fillRect(0,0,64,48);
 context.fillStyle='#fff';context.fillRect(0,0,20,15);
 const initial={id:'1000',kind:'image',image:canvas.toDataURL('image/jpeg',.9),width:64,height:48,date:1700000000000,
  revision:'original-pixels',mutationRevision:'original-metadata',favorite:false,trashed:false};
 function store(mode,run){return new Promise((resolve,reject)=>{const open=indexedDB.open('alpha.browser.photos.v1');
  open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('photos',mode);let result;
   tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(tx.error||Error('Fixture transaction aborted'));};
   run(tx.objectStore('photos'),value=>{result=value;});};});}
 await store('readwrite',(rows,set)=>{rows.add(initial);set(null);});
 const raw=()=>store('readonly',(rows,set)=>{const request=rows.getAll();request.onsuccess=()=>set(request.result);});
 let operationId=crypto.randomUUID(),begun=false,lastRecord,reportedNoCopy=false,refusedSaves=0,externalEdits=0,candidate;
 let now=Date.now();Date.now=()=>now;
 const attempts=new Map(),works=new Map(),sourceRevisions=new Map([[initial.mutationRevision,0]]);
 const rank=(map,value)=>{if(!map.has(value))map.set(value,map.size);return map.get(value);};
 const attemptRank=value=>{if(!attempts.has(value))attempts.set(value,attempts.size+1);return attempts.get(value);};
 const decode=HTMLImageElement.prototype.decode;
 HTMLImageElement.prototype.decode=async function(){await decode.call(this);if(!candidate)return;const work=candidate;candidate=undefined;
  await new Promise((resolve,reject)=>{work.release=resolve;work.reject=reject;work.entered=true;work.enter();});};
 const parameterInput=parameter=>({rotation:parameter===0?0:parameter===1?90:180,crop:false,filter:'none'});
 async function observe(){
  const rows=await raw(),record=rows.find(row=>row.id==='edit:'+operationId),original=rows.find(row=>row.id===initial.id);
  if(record)lastRecord=record;
  const held=record||lastRecord,session=window.copyReceiptSession(operationId);
  if(record?.attempt)attemptRank(record.attempt);
  let parameters=-1;
  if(held?.parameters){const rotation=JSON.parse(held.parameters.replace(/:replace$/,''))[0];parameters=rotation===0?0:rotation===90?1:2;}
  const sourceRevision=rank(sourceRevisions,original.mutationRevision),recordedRevision=held?rank(sourceRevisions,held.sourceRevision):0;
  const copies=rows.filter(row=>row.kind==='image'&&row.id!==initial.id).length,replaces=Number(original.image!==initial.image);
  return {status:record?.status||(begun?'abandoned':'none'),parameters,replace:held?.replace===true,
   attempt:held?.attempt?attemptRank(held.attempt):0,serial:attempts.size,
   inflight:[...works].filter(([,work])=>!work.settled).map(([id])=>id).sort((a,b)=>a-b),
   sessionActive:!!session?.active&&now<=session.expiresAt,recordedRevision,sourceRevision,sourceTrashed:original.trashed,
   externalEdits,copies,replaces,reportedNoCopy,refusedSaves:Math.min(2,refusedSaves)};
 }
 async function begin(){const preview=await library.beginEdit({id:initial.id,revision:(await library.read({id:initial.id})).mutationRevision});operationId=preview.operationId;begun=true;}
 async function save(parameter,replace,mutateInput=false){
  let enter;const entered=new Promise(resolve=>{enter=resolve;});
  const work={entered:false,settled:false,enter,result:null,error:null};candidate=work;
  const input={sessionId:operationId,...parameterInput(parameter),replace};
  work.done=library.saveEdit(input).then(result=>{work.result=result;work.settled=true;},error=>{work.error=String(error?.message??error);work.settled=true;});
  if(mutateInput){input.rotation=180;input.replace=true;}
  await Promise.race([entered,work.done]);
  if(work.entered){const record=(await raw()).find(row=>row.id==='edit:'+operationId);assertRecord(record,'saving');works.set(attemptRank(record.attempt),work);}
  else{candidate=undefined;if(work.error)refusedSaves++;}
  return {held:work.entered,error:work.error,result:work.result};
 }
 function assertRecord(record,status){if(record?.status!==status)throw Error('Decode must be suspended only after the actual saving claim commits');}
 async function verifyResult(result){
  if(result.status!=='saved')return;
  const rows=await raw(),record=rows.find(row=>row.id==='edit:'+operationId);
  if(record?.status!=='saved'||result.operationId!==operationId||result.id!==(record.replace?record.sourceId:record.copyId)||
    (result.replaced===true)!==(record.replace===true)||!rows.some(row=>row.id===result.id&&row.kind==='image'))
   throw Error('Public saved outcome must name the exact atomically committed receipt and media row');
 }
 async function finish(attempt,fail=false){const work=works.get(attempt);if(!work||work.settled)throw Error('No source save is suspended for this attempt');
  if(fail)work.reject(Error('Controlled image decoding failure'));else work.release();await work.done;if(work.result)await verifyResult(work.result);return {result:work.result,error:work.error};}
 async function readResult(){const result=await library.editResult({operationId});await verifyResult(result);if(result.status==='not-started')reportedNoCopy=true;return result;}
 async function cancel(){await library.cancelEdit({sessionId:operationId});return readResult();}
 async function change(trash=false){const before=await library.read({id:initial.id});
  const after=trash?await library.setTrashed({id:initial.id,revision:before.mutationRevision,trashed:true}):await library.setFavorite({id:initial.id,revision:before.mutationRevision,favorite:!before.favorite});
  if(after.mutationRevision===before.mutationRevision)throw Error('External change must alter the actual original row revision');externalEdits++;
 }
 async function abortCommit(){const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){
  if(value?.kind==='edit-receipt'&&value.status==='saved'){this.transaction.abort();return undefined;}return put.call(this,value,...args);};
  try{return await finish(1);}finally{IDBObjectStore.prototype.put=put;}
 }
 window.copyReceiptFixture={observe,begin,save,finish,readResult,cancel,change,abortCommit,
  expire(){now+=16*60*1000;},
  async rows(){return raw();},
  async sourceUnchanged(){return JSON.stringify(await library.read({id:initial.id}))===JSON.stringify(initial);},
 };
}

async function drive(extraSources=[],mutation) {
 checkClientFeatures();
 const sources=[...new Set([...filesWithin(resolve(root,'apps/app/src')),...filesWithin(resolve(root,'.eliza/client-features')),
  'vite.config.ts','package.json','bun.lock','upstream.lock.json','scripts/prepare-client-features.ts','scripts/browser-full-reload.ts',
  'test/browser/browser-photo-edit.spec.ts','test/browser/helpers/page-modules.ts',driver,...extraSources])];
 const driverHashes=captureInputs(sources),loaded=new Set();let server,browser;
 try{
  server=await createServer({configLoader: 'runner', configFile:resolve(root,'vite.config.ts'),logLevel:'error',cacheDir,
   server:{host:'127.0.0.1',port:0,strictPort:true,hmr:false,watch:null},
   define:{'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS':JSON.stringify('')},
   plugins:[{name:'quint-copy-receipt',enforce:'pre',configureServer(server){server.middlewares.use((request,response,next)=>{
    if(request.url!=='/__quint_copy_receipt')return next();response.setHeader('content-type','text/html');
    response.end('<!doctype html><html lang="en"><body><script type="module">import * as library from "/src/prototype/browser-camera.ts";window.copyReceiptModule=library;</script></body></html>');
   });},transform(code,id){const path=id.split('?')[0];
    if(path.startsWith(root+'/')&&!path.includes('/node_modules/')&&!path.startsWith(cacheDir+'/')&&existsSync(path)){
     if(!driverHashes[path]){Object.assign(driverHashes,captureInputs([path]));sources.push(path);}
     assert.equal(sha256(Buffer.from(code)),driverHashes[path],'Actual module agrees with before-driver source');loaded.add(path);
    }
    if(path!==source)return;
    const anchor='const edits=new Map<string,EditSession>();';assert.equal(code.split(anchor).length,2);
    code=code.replace(anchor,anchor+'\nglobalThis.copyReceiptSession=(id:string)=>{const value=edits.get(id);return value?{active:value.active,expiresAt:value.expiresAt}:null;};');
    if(mutation){const [before,after]=mutations[mutation];assert.equal(code.split(before).length,2,'Canary changes exactly one actual source guard');code=code.replace(before,after);}
    return code;
   }}]});
  await server.listen();browser=await chromium.launch({headless:true});
  const base='http://127.0.0.1:'+server.httpServer.address().port,traces=[];
  async function scenario(name,run){const context=await browser.newContext(),page=await context.newPage();const foreign=[],errors=[];
   page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>{const url=new URL(route.request().url());if(['data:','blob:'].includes(url.protocol)||url.origin===base&&route.request().method()==='GET')return route.continue();foreign.push(url.origin+url.pathname);return route.abort();});
   await page.routeWebSocket(/.*/,socket=>socket.close());
   try{await page.goto(base+'/__quint_copy_receipt');await page.waitForFunction(()=>window.copyReceiptModule&&window.copyReceiptSession);await page.evaluate(installFixture);
    const invoke=(name,...args)=>page.evaluate(({name,args})=>window.copyReceiptFixture[name](...args),{name,args});
    const observe=async()=>Object.fromEntries(Object.entries(await invoke('observe')).map(([key,value])=>['s.'+key,key==='inflight'?qset(value):value]));
    const trace={name,init:action('init'),expect:await observe(),steps:[]};
    const mark=async(label,next)=>trace.steps.push({label,action:next,expect:await observe()});
    const call=async(name,next,...args)=>{const result=await invoke(name,...args);await mark(name,next);return result;};
    await run({invoke,mark,call});traces.push(trace);
    assert.deepEqual(foreign,[],'No external integration is contacted');assert.deepEqual(errors,[],'Real browser source has no uncaught error');
   }finally{await context.close();}}
  const begin=c=>c.call('begin',action('begin'));
  const save=(c,p,replace,mutate=false)=>c.call('save',action('save',p,replace),p,replace,mutate);
  const commit=(c,n=1)=>c.call('finish',action('commit',n),n);
  const read=c=>c.call('readResult',action('readResult'));
  const cancel=c=>c.call('cancel',[action('cancelEditor'),action('readResult')]);
  const original=c=>c.invoke('sourceUnchanged');
  await scenario('copy receipt owns one exact parameter set and mode',async c=>{
   await begin(c);await save(c,1,false,true);await save(c,1,true);await save(c,2,false);await save(c,1,false);await commit(c);
   assert.equal(await original(c),true,'A copy request must never overwrite the original');await save(c,1,false);await read(c);
  });
  await scenario('replace overwrites exactly the reviewed original row',async c=>{await begin(c);await save(c,1,true);await commit(c);await read(c);
   const rows=await c.invoke('rows');assert.equal(rows.filter(row=>row.kind==='image').length,1);assert.equal(await original(c),false);});
  await scenario('a recovery read retires a suspended save',async c=>{await begin(c);await save(c,1,false);await read(c);await commit(c);
   assert.equal(await original(c),true);const observed=await c.invoke('observe');assert.equal(observed.copies+observed.replaces,0,'A read-retired save must not commit afterwards');});
  if(!mutation){
   await scenario('identity edit creates no copy and retries retain its receipt',async c=>{await save(c,1,false);await begin(c);await save(c,0,false);await save(c,0,false);await save(c,1,false);await read(c);await cancel(c);assert.equal(await original(c),true);});
   await scenario('read of a prepared receipt cancels its save authority',async c=>{await begin(c);await read(c);await save(c,1,false);await read(c);});
   await scenario('cancel removes an unclaimed receipt and later save is refused',async c=>{await begin(c);await cancel(c);await save(c,1,false);await read(c);});
   await scenario('cancel retires a saving receipt before decode completes',async c=>{await begin(c);await save(c,1,false);await cancel(c);await commit(c);assert.equal(await original(c),true);});
   await scenario('source revision change prevents both copy and receipt commit',async c=>{await begin(c);await save(c,2,false);await c.call('change',action('externalEdit'));await commit(c);await read(c);});
   await scenario('trashing the original changes its exact row revision and prevents commit',async c=>{await begin(c);await save(c,1,true);await c.call('change',action('trashSource'),true);await commit(c);await read(c);});
   await scenario('expired editor cannot commit a rendered copy',async c=>{await begin(c);await save(c,1,false);await c.call('expire',action('sessionExpires'));await commit(c);await read(c);});
   await scenario('failed decoding keeps original and failed receipt',async c=>{await begin(c);await save(c,2,false);await c.call('finish',action('renderFails',1),1,true);await read(c);assert.equal(await original(c),true);});
   await scenario('the copy and its receipt roll back in the same real IDB transaction',async c=>{await begin(c);await save(c,1,false);const result=await c.call('abortCommit',action('renderFails',1));assert.ok(result.error);await read(c);assert.equal(await original(c),true);
    const observed=await c.invoke('observe');assert.equal(observed.copies+observed.replaces,0,'Aborting the receipt write must roll back the media write too');});
  }
  assert.ok(loaded.has(source),'Execute actual BrowserPhotoLibrary implementation');
  return{sources,driverHashes,traces};
 }finally{await browser?.close();await server?.close();}
}

async function checkCopyReceipt(extraSources=[]) {
 const run=await drive(extraSources);
 const receipt=await checkTraces({model,...run,scope:'bounded-orchestration',assumptions:[
  'One editor, one original image, two non-identity transforms, copy/replace, and bounded duplicate calls. Chromium executes real canvas and IndexedDB transactions.',
  'Image decode is suspended only after the real saving claim commits. A read-only session observer exposes actual active/expiry state; UUIDs and per-original-row mutation revisions are equality classes.',
  'Copies are counted from distinct persisted media IDs and replacements from original pixel changes. External edits and trash use actual library mutation APIs; no global library revision is projected as a source revision.',
  'Recovery outcome reads, editor cancellation and return/throw results are observed. Prepared cancellation removes its database receipt; its absent terminal state remains distinct from a retained cancelled receipt.',
  'An explicit abort of the saved-receipt put checks media/receipt atomic rollback. Render-failure is the failed-attempt abstraction for that pre-commit transaction refusal.',
 ]});
 return{receipt,obligations:[{model,obligation:'Image quality, storage durability across process loss, and native photo editing',reason:'This adapter uses one actual browser process, real IndexedDB/canvas and bounded controlled decode/clock/abort schedules; physical storage, native MediaStore and device acceptance remain separate.'}]};
}
async function checkCopyReceiptCanary(mutation){assert.ok(Object.hasOwn(mutations,mutation));return drive([],mutation);}

test('CopyReceipt compares real browser transactions, recovery and every model state field',{timeout:240000},async()=>{
 const {receipt}=await checkCopyReceipt([fileURLToPath(import.meta.url)]);
 assert.equal(receipt.passed,true);assert.equal(receipt.inputsUnchanged,true);assert.equal(receipt.driverInputsBound,true);
 assert.equal(receipt.traces,12);assert.equal(receipt.observedFields.length,15);
 for(const name of ['begin','save','commit','renderFails','readResult','cancelEditor','sessionExpires','externalEdit','trashSource'])assert(receipt.actions[name]>0,name);
});
test('CopyReceipt rejects source that lets a read-retired suspended save commit',{timeout:180000},async()=>{
 await assert.rejects(()=>checkCopyReceiptCanary('retired'),/A read-retired save must not commit afterwards/);
});
test('CopyReceipt rejects source that turns an explicit copy request into replace',{timeout:180000},async()=>{
 await assert.rejects(()=>checkCopyReceiptCanary('replace'),/A copy request must never overwrite the original/);
});

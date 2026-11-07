import test from 'node:test';
import assert from 'node:assert/strict';
import {createSmsSession,receiptLabel} from '../apps/app/src/runtime/image-sms.ts';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const status={permissions:{sms:'granted'},subscriptions:[]};
function fake(overrides={}){let reads=0,stops=0;return {client:{smsSendHistory:async()=>[],status:async()=>status,threadPage:async()=>{reads++;return {rows:[],next:null};},messagePage:async()=>({rows:[],next:null}),requestAccess:async()=>{},observeMessages:async()=>async()=>{stops++;},...overrides},get reads(){return reads;},get stops(){return stops;}};}
test('off-image no provider call; background clears memory and stops observer',async()=>{const f=fake(),s=createSmsSession(f.client,false,()=>{});s.setActive(true);await tick();assert.equal(f.reads,0);const a=createSmsSession(f.client,true,()=>{});a.setActive(true);await tick();assert.equal(f.reads,1);a.setActive(false);await tick();assert.equal(f.stops,1);assert.equal(a.state.status,null);assert.deepEqual(a.state.threads,[]);});
test('old visit rejection cannot erase fresh provider rows',async()=>{let reject,read=0;const f=fake({threadPage:()=>++read===1?new Promise((_,r)=>reject=r):Promise.resolve({rows:[{id:'thread:2'}],next:null})}),s=createSmsSession(f.client,true,()=>{});s.setActive(true);await tick();s.setActive(false);s.setActive(true);await tick();reject(Error('permission revoked in old visit'));await tick();assert.deepEqual(s.state.threads,[{id:'thread:2'}]);s.setActive(false);});
test('permission denial and provider unavailability are distinct from empty; next cursor is forwarded',async()=>{let cursors=[];const f=fake({threadPage:async cursor=>{cursors.push(cursor);return {rows:[{id:'thread:3'}],next:cursor?null:'10:thread:3'};}}),s=createSmsSession(f.client,true,()=>{});s.setActive(true);await tick();await s.refresh(true);assert.deepEqual(cursors,[undefined,'10:thread:3']);s.setActive(false);const denied=createSmsSession(fake({status:async()=>({permissions:{sms:'denied'}})}).client,true,()=>{});denied.setActive(true);await tick();assert.match(denied.state.message,/not been granted/);denied.setActive(false);const broken=createSmsSession(fake({threadPage:async()=>{throw Error('null provider');}}).client,true,()=>{});broken.setActive(true);await tick();assert.match(broken.state.message,/could not be read completely/);assert.notEqual(broken.state.message,'No messages found.');broken.setActive(false);assert.match(receiptLabel('submitted'),/not confirmed/);assert.match(receiptLabel('unknown'),/Check the recipient/);});
test('thread switches reject delayed prior thread reads',async()=>{let resolve;const f=fake({messagePage:async id=>id==='thread:1'?new Promise(r=>resolve=r):{rows:[{id:'sms:2'}],next:null}}),s=createSmsSession(f.client,true,()=>{});s.setActive(true);await tick();s.openThread('thread:1');await tick();s.openThread('thread:2');await tick();resolve({rows:[{id:'sms:1'}],next:null});await tick();assert.deepEqual(s.state.rows,[{id:'sms:2'}]);s.setActive(false);});

test('SMS review completion cannot mutate a later visit and transport errors keep the operation ID',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {join,resolve}=await import('node:path');const {tmpdir}=await import('node:os');
 const {build}=await import('esbuild');const {writeFileSync}=await import('node:fs');const {pathToFileURL}=await import('node:url');const dir=mkdtempSync(join(tmpdir(),'sms-adapter-'));const priorDocument=globalThis.document;const pending=[];const calls=[];
 globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
 globalThis.__smsFixturePort={smsSendHistory:async()=>[],status:async()=>({permissions:{sms:'granted',phoneState:'granted'},subscriptions:[{id:3,slot:0,displayName:'SIM'}]}),threadPage:async()=>({rows:[],next:null}),observeMessages:async()=>async()=>{},sendSms:(review,operationId)=>{calls.push({...review,operationId});return new Promise((resolve,reject)=>pending.push({resolve,reject}));}};
 try{
  const result=await build({entryPoints:[resolve('apps/app/src/prototype/sms-adapter.ts')],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'native-fixture',setup(builder){builder.onResolve({filter:/platform-plugins|aosp-image|aosp-telephony|native-adapter$/},args=>({path:args.path,namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path.includes('aosp-telephony')?'export const MMS_MAX_ATTACHMENTS=5;export const reviewMms=()=>({problem:"mms-unavailable"});export const createAospTelephony=()=>globalThis.__smsFixturePort;export const registerTelephonyProfile=()=>()=>{};':args.path.includes('platform-plugins')?'export const registerPlugin=()=>globalThis.__smsFixturePort;':args.path.includes('aosp-image')?'export const aospImage=true;':'export const watchReturnToApp=()=>()=>{};'}));}}]});const filename=join(dir,'adapter.mjs');writeFileSync(filename,result.outputFiles[0].text);const {installSmsAdapter}=await import(pathToFileURL(filename));
  class Component{view='messages';S(){return {view:this.view}}setState(){}}
  const views={messages:{}};installSmsAdapter(Component,views);const owner=new Component();owner.componentDidMount();await tick();
  const compose=()=>{let model=views.messages.render();model.nativeOnRecipients({target:{value:'+15555550100'}});model.nativeOnBody({target:{value:'hello'}});model=views.messages.render();model.nativeSims[0].pick();views.messages.render().nativeSend();};
  compose();await tick();owner.view='home';owner.componentDidUpdate();owner.view='messages';owner.componentDidUpdate();await tick();pending[0].resolve({status:'sent'});await tick();assert.equal(views.messages.render().nativeNotice,'');assert.equal(views.messages.render().nativeBody,'');
  compose();await tick();pending[1].reject(Error('transport lost'));await tick();assert.match(views.messages.render().nativeNotice,/unknown/);views.messages.render().nativeSend();await tick();assert.equal(calls[1].operationId,calls[2].operationId,'same uncertain operation is queried, never assigned a fresh replay ID');pending[2].resolve({status:'unknown'});await tick();owner.componentWillUnmount();
 }finally{globalThis.document=priorDocument;delete globalThis.__smsFixturePort;rmSync(dir,{recursive:true,force:true});}
});

test('holding the SMS role, an opened conversation is marked read through the newest shown message only',async()=>{
 const rows=[{id:'sms:9',direction:'incoming',read:false,date:1700000000900},{id:'mms:4',direction:'incoming',read:true,date:1700000000000},{id:'sms:8',direction:'outgoing',read:true,date:1699999999000}];
 const run=async(held,page,answer=async()=>({defaultSmsApp:true,updated:1}))=>{const marks=[];const f=fake({status:async()=>({...status,roles:{sms:{held}}}),messagePage:async()=>({rows:page,next:null}),markThreadRead:async(thread,through)=>{marks.push([thread,through]);return answer();}}),s=createSmsSession(f.client,true,()=>{});s.setActive(true);await tick();s.openThread('thread:5');await tick();await tick();const shown=s.state.rows;s.setActive(false);await tick();return {marks,shown};};
 assert.deepEqual((await run(true,rows)).marks,[['thread:5',1700000000900]],'the newest shown message bounds the mark');
 assert.deepEqual((await run(false,rows)).marks,[],'another SMS app keeps read state');
 assert.deepEqual((await run(true,rows.map(row=>({...row,read:true})))).marks,[],'nothing unread is shown: no write');
 assert.deepEqual((await run(true,[])).marks,[],'an empty page marks nothing');
 const failed=await run(true,rows,async()=>{throw Error('provider refused');});
 assert.equal(failed.marks.length,1);assert.deepEqual(failed.shown.map(row=>row.id),['sms:9','mms:4','sms:8'],'a refused mark leaves the shown page intact');
 const thread=createSmsSession(fake({status:async()=>({...status,roles:{sms:{held:true}}}),threadPage:async()=>({rows:[{id:'thread:5',unread:true}],next:null}),markThreadRead:async()=>{throw Error('thread list must not mark');}}).client,true,()=>{});thread.setActive(true);await tick();assert.equal(thread.state.threads.length,1,'listing conversations never marks them read');thread.setActive(false);
});

test('old observer cleanup finishes before a new visit enables observation',async()=>{let release;const calls=[];let attempt=0;const f=fake({observeMessages:async()=>{const id=++attempt;calls.push('start'+id);if(id===1)await new Promise(r=>release=r);return async()=>{calls.push('stop'+id);};}}),s=createSmsSession(f.client,true,()=>{});s.setActive(true);await tick();s.setActive(false);s.setActive(true);await tick();assert.deepEqual(calls,['start1']);release();await tick();await tick();assert.deepEqual(calls,['start1','stop1','start2']);s.setActive(false);await tick();});

test('a reviewed MMS carries the picked pictures, keeps its operation ID when uncertain and reads back only its reviewed content',async()=>{
 const {mkdtempSync,rmSync,writeFileSync}=await import('node:fs');const {join,resolve}=await import('node:path');const {tmpdir}=await import('node:os');const {pathToFileURL}=await import('node:url');
 const {build}=await import('esbuild');const dir=mkdtempSync(join(tmpdir(),'mms-adapter-'));const priorDocument=globalThis.document;const pending=[],calls=[],reads=[],inputs=[];let mmsUpdated;
 globalThis.document={hidden:false,addEventListener(){},removeEventListener(){},createElement(){const input={files:[],value:'',click(){inputs.push(input);}};return input;}};
 const file=(type,bytes)=>({type,size:bytes.length,arrayBuffer:async()=>new Uint8Array(bytes).buffer});
 globalThis.__mmsFixture={
  profiles:[],
  port:{smsSendHistory:async()=>[],status:async()=>({permissions:{sms:'granted',sendSms:'granted',phoneState:'granted'},mmsSend:true,subscriptions:[{id:3,slot:0,displayName:'SIM'}]}),threadPage:async()=>({rows:[],next:null}),observeMessages:async(_change,_sms,mms)=>{mmsUpdated=mms;return async()=>{};},sendMms:(review,operationId)=>{calls.push({review,operationId});return new Promise((resolve,reject)=>pending.push({resolve,reject}));},mmsSendResult:async(review,operationId)=>{reads.push({review,operationId});return {status:'sent'};}},
 };
 try{
  // Only the native port is faked: the draft is validated by the shared reviewMms and MMS_MAX_ATTACHMENTS from the projected contract the adapter imports.
  const contract=name=>resolve('.eliza/client-features/packages/contracts/src',name);
  const result=await build({entryPoints:[resolve('apps/app/src/prototype/sms-adapter.ts')],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'native-fixture',setup(builder){builder.onResolve({filter:/platform-plugins|aosp-image|aosp-telephony|native-adapter$/},args=>({path:args.path,namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({resolveDir:process.cwd(),contents:args.path.includes('aosp-telephony')?`export {MMS_MAX_ATTACHMENTS} from ${JSON.stringify(contract('mms-send.ts'))};export {reviewMms} from ${JSON.stringify(contract('native-telephony.ts'))};export const createAospTelephony=()=>globalThis.__mmsFixture.port;export const registerTelephonyProfile=client=>{globalThis.__mmsFixture.profiles.push(client);return ()=>{};};`:args.path.includes('platform-plugins')?'export const registerPlugin=()=>globalThis.__mmsFixture.port;':args.path.includes('aosp-image')?'export const aospImage=true;':'export const watchReturnToApp=()=>()=>{};'}));}}]});
  const filename=join(dir,'adapter.mjs');writeFileSync(filename,result.outputFiles[0].text);const {installSmsAdapter}=await import(pathToFileURL(filename));
  class Component{view='messages';S(){return {view:this.view}}setState(){}}
  const views={messages:{}};installSmsAdapter(Component,views);const owner=new Component();owner.componentDidMount();await tick();await tick();
  assert.deepEqual(globalThis.__mmsFixture.profiles,[globalThis.__mmsFixture.port],'the image client the adapter uses is the shared Messages and Phone profile');
  const model=()=>views.messages.render();model().nativeSims[0].pick();
  assert.equal(model().nativeMmsAvailable,true);
  model().nativeSendMms();await tick();await tick();assert.equal(calls.length,0,'an invalid draft is refused before native review');assert.match(model().nativeNotice,/at least one phone number/);
  model().nativeAttach();inputs[0].files=[file('image/webp',[1])];await inputs[0].onchange();assert.match(model().nativeNotice,/JPEG, PNG and GIF/);assert.equal(model().nativeAttachments.length,0);
  model().nativeOnRecipients({target:{value:'+15555550100, +15555550101'}});model().nativeOnBody({target:{value:'hi all'}});
  model().nativeAttach();inputs[1].files=[file('image/jpeg',[1,2,3]),file('image/png',[4,5])];await inputs[1].onchange();
  assert.deepEqual(model().nativeAttachments.map(row=>row.label),['picture-1.jpg · 1 KB','picture-2.png · 1 KB']);
  model().nativeSendMms();await tick();await tick();assert.equal(calls.length,1);
  assert.deepEqual(calls[0].review.recipients,['+15555550100','+15555550101']);assert.deepEqual(calls[0].review.attachments.map(a=>[a.name,a.contentType,[...a.bytes]]),[['picture-1.jpg','image/jpeg',[1,2,3]],['picture-2.png','image/png',[4,5]]]);
  pending[0].reject(Error('transport lost'));await tick();await tick();assert.match(model().nativeNotice,/MMS outcome is unknown/);
  model().nativeSendMms();await tick();await tick();assert.equal(calls[1].operationId,calls[0].operationId,'an uncertain MMS is never given a fresh ID');
  pending[1].resolve({status:'submitted'});await tick();await tick();assert.match(model().nativeNotice,/submitted/);
  mmsUpdated('someone-else');await tick();assert.equal(reads.length,0,'another operation is not read');
  mmsUpdated(calls[0].operationId);await tick();await tick();assert.equal(reads.length,1);assert.equal(reads[0].review,calls[0].review,'the result is bound to the reviewed content');assert.match(model().nativeNotice,/carrier accepted the MMS; delivery is not confirmed/);
  model().nativeAttachments[0].remove();assert.deepEqual(model().nativeAttachments.map(row=>row.label),['picture-2.png · 1 KB']);model().nativeSendMms();await tick();await tick();assert.notEqual(calls[2].operationId,calls[0].operationId,'a changed draft is a new review');
  pending[2].resolve({status:'cancelled'});await tick();await tick();assert.match(model().nativeNotice,/Cancelled — MMS not sent/);
  model().nativeClear();assert.equal(model().nativeAttachments.length,0);
  owner.view='home';owner.componentDidUpdate();owner.componentWillUnmount();
 }finally{globalThis.document=priorDocument;delete globalThis.__mmsFixture;rmSync(dir,{recursive:true,force:true});}
});

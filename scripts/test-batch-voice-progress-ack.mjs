import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
// The helper lives in the actual local agent stream module, which produces its cues.
const compiled=await build({entryPoints:[fileURLToPath(new URL('../apps/app/src/runtime/local-agent-stream.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm'});
const {createBatchProgressAcknowledgment:create,genuineBatchProgress,batchProgressBinding,emitBatchProgress,batchVoiceProgressEvents:events}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const turn='11111111-1111-4111-8111-111111111111',room='22222222-2222-4222-8222-222222222222';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const cue=(patch={})=>({turnId:turn,conversationId:room,ownerId:'owner',kind:'thinking',label:'Checking the calendar',...patch});
function fixture(){
 const abort=new AbortController(),calls=[],history=[{id:'existing'}];let retired=true,current=true;
 const f={abort,calls,history,get current(){return current;},set current(v){current=v;},set retired(v){retired=v;}};
 f.input={turnId:turn,conversationId:room,ownerId:'owner',signal:abort.signal,assertCurrent:()=>{if(!current)throw Error('owner/view retired');},captureRetired:()=>retired,speak:async(text,signal)=>{calls.push({text,signal});}};
 f.make=()=>create(f.input);return f;
}
test('missing genuine cue is negative control: no TTS, no chat/agent/model/tool work',async()=>{
 const f=fixture(),a=f.make();await a.finish();assert.equal(f.calls.length,0);assert.deepEqual(f.history,[{id:'existing'}]);
});
test('genuine planner status speaks the exact model-provided label once',async()=>{
 const f=fixture(),a=f.make();a.progress(cue());await tick();a.progress(cue());a.progress(cue({kind:'running_tool',toolName:'calendar.read'}));await a.finish();assert.equal(f.calls.length,1);assert.equal(f.calls[0].text,'Checking the calendar');assert.deepEqual(f.history,[{id:'existing'}]);
});
for(const patch of [{kind:'thinking',label:undefined},{kind:'streaming'},{kind:'waking'},{kind:'speaking'},{kind:'running_tool',toolName:undefined},{kind:'running_action',actionName:undefined}])test('initial/fake/unqualified status never cues '+JSON.stringify(patch),async()=>{
 const f=fixture(),a=f.make();a.progress(cue(patch));await a.finish();assert.equal(f.calls.length,0);
});
for(const patch of [{turnId:'foreign'},{conversationId:'foreign'},{ownerId:'foreign'}])test('foreign turn/room/owner cannot cue '+JSON.stringify(patch),async()=>{
 const f=fixture(),a=f.make();a.progress(cue(patch));await a.finish();assert.equal(f.calls.length,0);
});
test('microphone must already be retired before cue; no forced stop/resume',async()=>{
 const f=fixture();f.retired=false;const a=f.make();a.progress(cue());await tick();assert.equal(f.calls.length,0);f.retired=true;a.progress(cue());await tick();await a.finish();assert.equal(f.calls.length,1);
});
test('a live path passes no retirement claim (null): its cue plays with the capture open, still once and still preemptable',async()=>{
 const f=fixture();f.retired=false;f.input.captureRetired=null;const a=f.make();a.progress(cue());await tick();a.progress(cue());await a.finish();assert.equal(f.calls.length,1);assert.equal(f.calls[0].text,'Checking the calendar');
 const g=fixture();g.input.captureRetired=null;const b=g.make();b.progress(cue());b.replyStarted();await b.finish();assert.equal(g.calls.length,0);
});
test('early final/token preempts cue queued in same turn',async()=>{
 const f=fixture(),a=f.make();a.progress(cue());a.replyStarted();await a.finish();assert.equal(f.calls.length,0);a.progress(cue());await tick();assert.equal(f.calls.length,0);
});
test('final aborts playing cue and waits cleanup before final speech or listening',async()=>{
 const f=fixture(),cleanup=deferred(),started=deferred();f.input.speak=async(text,signal)=>{f.calls.push({text,signal});started.resolve();await cleanup.promise;if(signal.aborted)throw new DOMException('retired','AbortError');};
 const a=f.make();a.progress(cue());await started.promise;let done=false;const final=a.finish().then(()=>{done=true;});await tick();assert.equal(f.calls[0].signal.aborted,true);assert.equal(done,false);cleanup.resolve();await final;assert.equal(done,true);
});
test('Stop cancels playing acknowledgement, late progress cannot restart',async()=>{
 const f=fixture(),cleanup=deferred();f.input.speak=async(text,signal)=>{f.calls.push({text,signal});await cleanup.promise;if(signal.aborted)throw new DOMException('retired','AbortError');};const a=f.make();a.progress(cue());await tick();const stop=a.stop();assert.equal(f.calls[0].signal.aborted,true);cleanup.resolve();await stop;a.progress(cue());await tick();assert.equal(f.calls.length,1);
});
test('parent abort cancels queued acknowledgement before any speech',async()=>{
 const f=fixture(),a=f.make();a.progress(cue());f.abort.abort();await a.stop();assert.equal(f.calls.length,0);
});
test('hide/session/owner currentness blocks queued cue',async()=>{
 const f=fixture(),a=f.make();a.progress(cue());f.current=false;await assert.rejects(a.finish());assert.equal(f.calls.length,0);
});
test('unconfirmed cleanup is not swallowed on final/Stop',async()=>{
 const f=fixture(),bad=Object.assign(Error('cleanup unconfirmed'),{code:'speech-cleanup-unconfirmed'});f.input.speak=async()=>{throw bad;};const a=f.make();a.progress(cue());await tick();await assert.rejects(a.finish(),e=>e===bad);await assert.rejects(a.stop(),e=>e===bad);
});
test('reply after cue completed still has zero overlap or repeated cue',async()=>{
 const f=fixture(),a=f.make();a.progress(cue({label:'Checking calendar'}));await tick();await a.finish();a.progress(cue());await tick();assert.equal(f.calls.length,1);
});
test('request binding admits only actual VOICE_DM clientMessageId and exact room stream path',()=>{
 const r={path:`/api/conversations/${room}/messages/stream`,ownerId:'owner',body:JSON.stringify({channelType:'VOICE_DM',clientMessageId:turn})};assert.deepEqual(batchProgressBinding(r),{turnId:turn,conversationId:room,ownerId:'owner'});
 for(const change of [{body:'{'},{body:JSON.stringify({channelType:'DM',clientMessageId:turn})},{path:'/api/auth/status'},{ownerId:''},{body:JSON.stringify({channelType:'VOICE_DM',clientMessageId:'wrong'})}])assert.equal(batchProgressBinding({...r,...change}),undefined);
});
test('only bound real planner/tool status emits a typed cue; legacy global string is not accepted',()=>{
 const found=[];const listener=e=>found.push(e.detail);events.addEventListener('progress',listener);
 try{emitBatchProgress(undefined,{kind:'thinking',label:'plan'});emitBatchProgress({turnId:turn,conversationId:room,ownerId:'owner'},{kind:'thinking'});assert.equal(found.length,0);
 emitBatchProgress({turnId:turn,conversationId:room,ownerId:'owner'},{kind:'running_tool',toolName:'Calendar.read'});assert.equal(found.length,1);assert.equal(found[0].turnId,turn);assert.ok(Object.isFrozen(found[0]));assert.equal(genuineBatchProgress(found[0]),true);}
 finally{events.removeEventListener('progress',listener);}
});

test('named tool and action status without a model label stays silent without consuming the cue',async()=>{
 const f=fixture(),a=f.make();a.progress(cue({kind:'running_tool',toolName:'calendar.read',label:undefined}));a.progress(cue({kind:'running_action',actionName:'CALENDAR',label:undefined}));await tick();assert.equal(f.calls.length,0);
 a.progress(cue({label:'Let me check your calendar.'}));await tick();await a.finish();assert.equal(f.calls.length,1);assert.equal(f.calls[0].text,'Let me check your calendar.');
});
for(const label of ['', '   ', 'x'.repeat(161)])test('invalid model label remains silent '+label.length,async()=>{const f=fixture(),a=f.make();a.progress(cue({label}));await tick();await a.finish();assert.equal(f.calls.length,0);});
test('queued speech keeps the validated model wording even if its source object is mutated',async()=>{const f=fixture(),a=f.make(),value=cue({label:'Checking your saved notes.'});a.progress(value);value.label='Different words';await tick();await a.finish();assert.equal(f.calls[0].text,'Checking your saved notes.');});

for (const status of [{kind:'running_tool',toolName:'calendar.read'},{kind:'running_action',actionName:'CALENDAR'}]) test('named '+status.kind+' with a synthetic label stays visual-only and does not consume the model cue',async()=>{
 const f=fixture(),a=f.make();a.progress(cue({...status,label:'Synthetic system status'}));await tick();assert.equal(f.calls.length,0);
 a.progress(cue({label:'Checking your calendar now.'}));await tick();await a.finish();assert.equal(f.calls.length,1);assert.equal(f.calls[0].text,'Checking your calendar now.');
});

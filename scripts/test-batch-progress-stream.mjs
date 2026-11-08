import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
// Local evidence may select an existing admitted fixture graph; committed default is this repository.
const original=process.env.ALPHA_ACK_HOST_ROOT||fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(original+'/package.json');const {build}=require('esbuild');
const dir=fileURLToPath(new URL('../apps/app/src/runtime/',import.meta.url));
// The actual stream parser exports its own Batch progress channel.
const contents=readFileSync(dir+'local-agent-stream.ts','utf8');
const compiled=await build({stdin:{contents,loader:'ts',resolveDir:original+'/apps/app/src/runtime'},bundle:true,write:false,platform:'node',format:'esm'});
const {readLocalAgentStream,batchVoiceProgressEvents:events,batchVoiceReplyEvents:replies,localTurnStatus}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const turn='11111111-1111-4111-8111-111111111111',room='22222222-2222-4222-8222-222222222222';
const request={path:`/api/conversations/${room}/messages/stream`,ownerId:'owner',body:JSON.stringify({clientMessageId:turn,channelType:'VOICE_DM'})};
const response=frames=>new Response(frames.map(frame=>'data: '+JSON.stringify(frame)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
const done={type:'done',fullText:'Final answer',agentName:'Alpha'};
test('actual normal stream parser emits request-bound genuine planning/tool cue without changing reply/history text',async()=>{
 const cues=[],labels=[],text=[];const progress=e=>cues.push(e.detail),label=e=>labels.push(e.detail);events.addEventListener('progress',progress);localTurnStatus.addEventListener('label',label);
 try{const result=await readLocalAgentStream(response([{type:'status',kind:'thinking'},{type:'status',kind:'thinking',label:'Checking your calendar'},{type:'status',kind:'running_tool',toolName:'calendar.read'},{type:'token',fullText:'Final'},done]),new AbortController().signal,value=>text.push(value),undefined,request);
 assert.equal(cues.length,2);assert.equal(cues[0].turnId,turn);assert.equal(cues[0].conversationId,room);assert.equal(cues[0].ownerId,'owner');assert.deepEqual(labels,['Checking your calendar']);assert.deepEqual(text,['Final']);assert.equal(result.text,'Final answer');}
 finally{events.removeEventListener('progress',progress);localTurnStatus.removeEventListener('label',label);}
});
test('actual stream negative control no binding/plain DM cannot emit voice acknowledgement',async()=>{
 const cues=[],progress=e=>cues.push(e.detail);events.addEventListener('progress',progress);
 try{for(const binding of [undefined,{...request,body:JSON.stringify({clientMessageId:turn,channelType:'DM'})}])await readLocalAgentStream(response([{type:'status',kind:'thinking',label:'Planning'},done]),new AbortController().signal,()=>{},undefined,binding);assert.equal(cues.length,0);}
 finally{events.removeEventListener('progress',progress);}
});
test('aborted actual stream emits no cue and never invents a completed reply',async()=>{
 const cues=[],progress=e=>cues.push(e.detail),abort=new AbortController();events.addEventListener('progress',progress);abort.abort();
 try{await assert.rejects(readLocalAgentStream(response([{type:'status',kind:'thinking',label:'Planning'},done]),abort.signal,()=>{},undefined,request));assert.equal(cues.length,0);}
 finally{events.removeEventListener('progress',progress);}
});

test('provisional tool token remains display-only and does not preempt pending acknowledgement',async()=>{
 const observed=[],texts=[];const listener=e=>observed.push(e.detail);replies.addEventListener('reply',listener);
 const encoder=new TextEncoder();let push;const body=new ReadableStream({start(controller){push=frame=>controller.enqueue(encoder.encode('data: '+JSON.stringify(frame)+'\n\n'));}});
 const running=readLocalAgentStream(new Response(body,{headers:{'Content-Type':'text/event-stream'}}),new AbortController().signal,text=>texts.push(text),undefined,request);
 try{push({type:'status',kind:'running_tool',toolName:'calendar.read'});push({type:'token',provisional:true,fullText:'Checking…'});for(let n=0;n<20;n++)await Promise.resolve();assert.deepEqual(texts,['Checking…']);assert.equal(observed.length,0);
 push({type:'reply_ready',fullText:'Actual final answer'});push(done);await running;assert.ok(observed.length>=1);assert.equal(observed[0].turnId,turn);}
 finally{replies.removeEventListener('reply',listener);}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {BatchProgressCue} from '../apps/app/src/runtime/local-agent-stream.ts';
import {loadLocalAgentStream} from './fixtures/local-agent-stream.ts';
// Local evidence may select an existing admitted fixture graph; committed default is this repository.
const {readLocalAgentStream,batchVoiceProgressEvents:events,batchVoiceReplyEvents:replies,localTurnStatus}=await loadLocalAgentStream(process.env.ALPHA_ACK_HOST_ROOT || undefined);
const turn='11111111-1111-4111-8111-111111111111',room='22222222-2222-4222-8222-222222222222';
const request={path:`/api/conversations/${room}/messages/stream`,ownerId:'owner',body:JSON.stringify({clientMessageId:turn,channelType:'VOICE_DM'})};
const response=(frames: object[])=>new Response(frames.map(frame=>'data: '+JSON.stringify(frame)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
const done={type:'done',fullText:'Final answer',agentName:'Alpha'};
const collect = <T>(values: T[]) => (event: Event) => {
 assert.ok(event instanceof CustomEvent);
 values.push(event.detail);
};
test('actual normal stream parser emits request-bound genuine planning/tool cue without changing reply/history text',async()=>{
 const cues: BatchProgressCue[] = [], labels: string[] = [], text: string[] = [];
 const progress=collect(cues),label=collect(labels);events.addEventListener('progress',progress);localTurnStatus.addEventListener('label',label);
 try{const result=await readLocalAgentStream(response([{type:'status',kind:'thinking'},{type:'status',kind:'thinking',label:'Checking your calendar'},{type:'status',kind:'running_tool',toolName:'calendar.read'},{type:'token',fullText:'Final'},done]),new AbortController().signal,value=>text.push(value),undefined,request);
 assert.equal(cues.length,2);assert.equal(cues[0].turnId,turn);assert.equal(cues[0].conversationId,room);assert.equal(cues[0].ownerId,'owner');assert.deepEqual(labels,['Checking your calendar']);assert.deepEqual(text,['Final']);assert.equal(result.text,'Final answer');}
 finally{events.removeEventListener('progress',progress);localTurnStatus.removeEventListener('label',label);}
});
test('actual stream negative control no binding/plain DM cannot emit voice acknowledgement',async()=>{
 const cues: BatchProgressCue[] = [],progress=collect(cues);events.addEventListener('progress',progress);
 try{for(const binding of [undefined,{...request,body:JSON.stringify({clientMessageId:turn,channelType:'DM'})}])await readLocalAgentStream(response([{type:'status',kind:'thinking',label:'Planning'},done]),new AbortController().signal,()=>{},undefined,binding);assert.equal(cues.length,0);}
 finally{events.removeEventListener('progress',progress);}
});
test('aborted actual stream emits no cue and never invents a completed reply',async()=>{
 const cues: BatchProgressCue[] = [],progress=collect(cues),abort=new AbortController();events.addEventListener('progress',progress);abort.abort();
 try{await assert.rejects(readLocalAgentStream(response([{type:'status',kind:'thinking',label:'Planning'},done]),abort.signal,()=>{},undefined,request));assert.equal(cues.length,0);}
 finally{events.removeEventListener('progress',progress);}
});

test('provisional tool token remains display-only and does not preempt pending acknowledgement',async()=>{
 const observed: Pick<BatchProgressCue, 'turnId' | 'conversationId' | 'ownerId'>[] = [], texts: string[] = [];
 const listener=collect(observed);replies.addEventListener('reply',listener);
 const encoder=new TextEncoder();
 const started = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>();
 const body=new ReadableStream<Uint8Array>({start(controller){started.resolve(controller);}});
 const controller=await started.promise;
 const push=(frame: object)=>controller.enqueue(encoder.encode('data: '+JSON.stringify(frame)+'\n\n'));
 const running=readLocalAgentStream(new Response(body,{headers:{'Content-Type':'text/event-stream'}}),new AbortController().signal,text=>texts.push(text),undefined,request);
 try{push({type:'status',kind:'running_tool',toolName:'calendar.read'});push({type:'token',provisional:true,fullText:'Checking…'});for(let n=0;n<20;n++)await Promise.resolve();assert.deepEqual(texts,['Checking…']);assert.equal(observed.length,0);
 push({type:'reply_ready',fullText:'Actual final answer'});push(done);await running;assert.ok(observed.length>=1);assert.equal(observed[0].turnId,turn);}
 finally{replies.removeEventListener('reply',listener);}
});

test('voice stream metadata distinguishes provisional tokens from settled direct text', async () => {
 type Frame = {text: string; frame: Parameters<Parameters<typeof readLocalAgentStream>[2]>[1]};
 const frames: Frame[] = [];
 await readLocalAgentStream(response([
  {type:'token',fullText:'Draft text',provisional:true},
  {type:'token',fullText:'Confirmed text',provisional:false},
  {type:'reply_ready',fullText:'A settled direct answer.',actionResults:[]},
  {...done,fullText:'A settled direct answer.'},
 ]),new AbortController().signal,(text,frame)=>frames.push({text,frame}),undefined,request);
 assert.deepEqual(frames,[
  {text:'Draft text',frame:{provisional:true}},
  {text:'Confirmed text',frame:{provisional:false}},
  {text:'A settled direct answer.',frame:{provisional:false,direct:true}},
 ]);
 const guarded: Frame[] = [];
 await readLocalAgentStream(response([{type:'reply_ready',fullText:'Review this action.',actionResults:[{}]},done]),new AbortController().signal,(text,frame)=>guarded.push({text,frame}),undefined,request);
 assert.deepEqual(guarded,[],'a reply carrying action results never enables early direct speech');
});

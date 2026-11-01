import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {cloudVoiceViewFixture} from './fixtures/cloud-voice-view.mjs';
import {voiceFakeClock} from './fixtures/shared-batch-voice.mjs';

// The actual voice adapter, production template and DCLogic renderer with closed ports only:
// a Cloud voice 429/503 is waited out quietly, a terminal failure is said once and plainly.
const CALM='Voice paused. Tap the mic to talk again.';
const SLOP=/request limit|Last transcript|Try voice again|Wait a moment|HTTP 503|Voice is unavailable/;
const limited=(data={retryAfterSeconds:3,limitCode:'rate_limited'})=>Object.assign(Error('PRIVATE_PROVIDER_BODY'),{code:'voice-http-429',data});

let renderer,temporary,page;
const before={document:globalThis.document,matchMedia:globalThis.matchMedia};
test.before(async()=>{
 page=new JSDOM('<!doctype html>');globalThis.document=page.window.document;globalThis.matchMedia=()=>({matches:true});
 const template=fs.readFileSync('apps/app/src/prototype/template.html','utf8');
 const start=template.indexOf('<sc-if value="{{inlineChatRecorder}}">'),end=template.indexOf('<sc-if value="{{panelComposer}}">',start);
 assert.ok(start>=0&&end>start);
 const fragment='<div class="os"><div data-screen="1">'+template.slice(start,end)+'</div></div>';
 const bundle=await build({stdin:{contents:`import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import{DCLogic}from'./apps/app/src/prototype/dc-lite.js';class Fixture extends DCLogic{renderVals(){return this.props.values;}}export const render=values=>renderToStaticMarkup(React.createElement(Fixture,{phoneSurface:true,values}));`,resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'actual-voice-template',setup(b){b.onResolve({filter:/template\.html\?raw$/},()=>({path:'voice',namespace:'actual-template'}));b.onLoad({filter:/.*/,namespace:'actual-template'},()=>({contents:'export default '+JSON.stringify(fragment),loader:'js'}));}}]});
 temporary=fs.mkdtempSync(path.join(os.tmpdir(),'voice-calm-markup-'));const file=path.join(temporary,'renderer.cjs');
 fs.writeFileSync(file,bundle.outputFiles[0].text);renderer=createRequire(import.meta.url)(file).render;
});
test.after(()=>{if(temporary)fs.rmSync(temporary,{recursive:true,force:true});page?.window.close();globalThis.document=before.document;globalThis.matchMedia=before.matchMedia;});

async function voice(t,{startFailure}={}){
 const clock=voiceFakeClock();
 const f=cloudVoiceViewFixture({cloudProfile:true,clock});
 f.box.React={createElement:()=>'activity'};f.box.VoiceActivity=()=>null;
 const runs=[];
 f.box.BatchVoiceConversation=class{
  constructor(options){this.options=options;runs.push(this);}
  async start(){if(startFailure&&runs.length===1)throw startFailure;this.options.onState({phase:'listening'});}
  async stop(){}recheck(){}
 };
 t.after(()=>f.close());
 await f.shell.startVoice();await clock.flush();
 const view=()=>{const model=f.renderChat();if(!model)return {model,text:'',doc:null};const doc=new JSDOM(renderer({inlineChatRecorder:true,chatRecorder:model})).window.document;return {model,doc,text:doc.body.textContent};};
 // The batch loop retires its session (idle) before it publishes the error, as the shared loop does.
 // The turn is heard (the adapter's own transcribe port), then a Cloud speech call is refused.
 f.transcript='so .';
 const fail=async(error,run=runs.at(-1))=>{await run.options.transcribe({recordingId:'clip-'+runs.length,durationMs:900},new AbortController().signal);run.options.onState({phase:'thinking',transcript:'so .'});run.options.onState({phase:'idle'});run.options.onState({phase:'error',error});await clock.flush();};
 return {f,clock,runs,view,fail};
}

test('a Cloud 429 never shows the limit text, the last transcript or Try voice again, and listens again after Retry-After',async t=>{
 const {f,clock,runs,view,fail}=await voice(t);
 assert.equal(view().model.state,'listening');
 await fail(limited());
 const waiting=view();
 assert.doesNotMatch(waiting.text,SLOP);
 assert.notEqual(waiting.model.state,'error','a transient refusal is not an error state');
 assert.doesNotMatch(JSON.stringify(waiting.model.lines),SLOP);
 assert.ok(!waiting.model.recoveryLabel,'no Try voice again link');
 assert.equal(waiting.doc.querySelector('[role="alert"]'),null,'nothing alarming is announced');
 assert.equal(waiting.doc.querySelector('[data-alpha-voice-recovery]'),null);
 assert.deepEqual(f.shell.messages,[],'no toast while waiting');
 // The server's wait (3 s) is honored: nothing restarts early.
 await clock.advance(2_999);assert.equal(runs.length,1);
 await clock.advance(1);assert.equal(runs.length,2,'one fresh conversation after Retry-After');
 const resumed=view();assert.equal(resumed.model.state,'listening');assert.doesNotMatch(resumed.text,SLOP);
 // A fresh capture: the answered or refused turn is never resent, re-uploaded or replayed.
 assert.equal(f.uploads,1);assert.equal(f.sends,0);assert.equal(f.cloudSpeech,0);
 await clock.advance(60_000);assert.equal(runs.length,2,'no further retries once it is listening');
});

test('a 503 while Cloud voice warms is waited out the same way',async t=>{
 const {runs,view,fail,clock}=await voice(t);
 await fail(Object.assign(Error('PRIVATE'),{code:'voice-http-503'}));
 const waiting=view();assert.notEqual(waiting.model.state,'error');assert.doesNotMatch(waiting.text,SLOP);assert.equal(waiting.model.voiceDetails,false);
 await clock.advance(2_000);assert.equal(runs.length,2);assert.equal(view().model.state,'listening');
});

test('retries are bounded: a third refusal (or a long wait) ends voice with one calm line',async t=>{
 const {f,clock,runs,fail}=await voice(t);
 await fail(limited());await clock.advance(3_000);
 await fail(limited());await clock.advance(3_000);
 assert.equal(runs.length,3);
 await fail(limited());
 assert.equal(f.renderChat(),null,'voice ended');
 assert.deepEqual(f.shell.messages,[CALM]);
 await clock.advance(120_000);assert.equal(runs.length,3,'no retry after voice ended');
 assert.equal(f.sends,0);
});

test('a long Retry-After is not waited out silently',async t=>{
 const {f,clock,runs,fail}=await voice(t);
 await fail(limited({retryAfterSeconds:600,limitCode:'rate_limited'}));
 assert.equal(f.renderChat(),null);assert.deepEqual(f.shell.messages,[CALM]);
 await clock.advance(700_000);assert.equal(runs.length,1);
});

test('a speaking turn resets the quiet retry budget',async t=>{
 const {f,clock,runs,fail}=await voice(t);
 await fail(limited());await clock.advance(3_000);
 await fail(limited());await clock.advance(3_000);
 runs.at(-1).options.onState({phase:'speaking',replyId:'reply'});runs.at(-1).options.onState({phase:'listening'});
 await fail(limited());await clock.advance(3_000);
 assert.equal(runs.length,4);assert.ok(f.renderChat());assert.deepEqual(f.shell.messages,[]);
});

test('stopping voice during the quiet wait cancels the retry',async t=>{
 const {f,clock,runs,fail}=await voice(t);
 await fail(limited());f.renderChat().stop();await clock.advance(10_000);
 assert.equal(runs.length,1);assert.deepEqual(f.shell.messages,[]);
});

test('terminal failures keep one honest line without the transcript tail or a duplicated status',async t=>{
 for(const [error,expected] of [
  [Object.assign(Error('PRIVATE'),{code:'voice-http-401'}),/^Sign in to Cloud again in Settings, then retry voice\.$/],
  [limited({limitCode:'allowance_exhausted'}),/voice allowance is used up/],
 ]){
  await t.test(String(error.code)+' '+(error.data?.limitCode||''),async t=>{
   const {f,clock,runs,view,fail}=await voice(t);
   await fail(error);
   const shown=view();
   assert.equal(shown.model.state,'error');
   assert.equal(shown.model.lines.length,1);assert.match(shown.model.lines[0].t,expected);
   assert.doesNotMatch(shown.text,/Last transcript|so \./);
   assert.equal(shown.text.split(shown.model.lines[0].t).length-1,1,'the message is on screen once');
   const status=shown.doc.querySelector('[role="status"][aria-label="Voice conversation status"]');
   assert.equal(status.textContent,'','the visible alert is the only announcement');
   assert.equal(shown.doc.querySelector('[role="alert"]').textContent,shown.model.lines[0].t);
   await clock.advance(60_000);assert.equal(runs.length,1,'terminal failures are not retried');assert.deepEqual(f.shell.messages,[]);
  });
 }
});

test('a denied microphone at start keeps its honest settings message, said once',async t=>{
 const {runs,view}=await voice(t,{startFailure:Object.assign(Error('denied'),{name:'NotAllowedError'})});
 const shown=view();
 assert.equal(shown.model.state,'error');assert.equal(shown.model.lines.length,1);
 assert.match(shown.model.lines[0].t,/microphone|settings/i);assert.doesNotMatch(shown.text,/Last transcript/);
 assert.equal(shown.doc.querySelector('[role="status"][aria-label="Voice conversation status"]').textContent,'');
 assert.equal(runs.length,1);
});

test('a normal voice turn is unchanged',async t=>{
 const {f,clock,runs,view}=await voice(t);
 const run=runs[0],seen=[];
 for(const state of [{phase:'transcribing'},{phase:'thinking',transcript:'what time is it'},{phase:'preparing-speech',replyId:'reply'},{phase:'speaking',replyId:'reply'},{phase:'listening'}]){
  run.options.onState(state);const shown=view();seen.push(shown.model.state);
  assert.equal(shown.doc.querySelector('[role="alert"]'),null);assert.ok(!shown.model.recoveryLabel);assert.doesNotMatch(shown.text,SLOP);
  assert.equal(shown.model.lines.length,1);
 }
 assert.deepEqual(seen,['transcribing','thinking','preparing-speech','speaking','listening']);
 // The status region still carries the live phase for screen readers.
 assert.equal(view().doc.querySelector('[role="status"][aria-label="Voice conversation status"]').textContent,'Listening…');
 await clock.advance(30_000);assert.equal(runs.length,1);assert.deepEqual(f.shell.messages,[]);
});

// The real shared batch loop: the quiet wait meets the loop's own retire, drain and fresh capture.
async function realLoop(t){
 const clock=voiceFakeClock();
 const f=cloudVoiceViewFixture({cloudProfile:true,clock,peak:.5});
 f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;
 t.after(async()=>{f.close();await clock.flush();});
 await f.shell.startVoice();await clock.flush();
 const speakTurn=async()=>{f.peak=.5;await clock.advance(700);f.peak=0;await clock.advance(1_200);await clock.flush();};
 return {f,clock,speakTurn};
}

test('a chat that stops being current during the quiet wait ends calmly instead of connecting forever',async t=>{
 const {f,clock,speakTurn}=await realLoop(t);
 f.error=limited();await speakTurn();f.error=null;
 assert.equal(f.renderChat().state,'starting');
 const starts=f.starts;
 // Hidden when the wait ends, with no visibilitychange and no render while hidden.
 f.box.document.hidden=true;await clock.advance(4_000);
 f.box.document.hidden=false;f.shell.componentDidUpdate?.();await clock.advance(60_000);
 assert.equal(f.renderChat(),null,'not left on Connecting to voice…');
 assert.deepEqual(f.shell.messages,[CALM]);
 assert.equal(f.starts,starts,'the microphone does not reopen without a tap');
});

test('a refusal from the real loop never flashes the stopped state before the quiet wait',async t=>{
 const {f,clock}=await realLoop(t);
 // Every frame the voice view renders, not only the ones a clock step happens to land on.
 const frames=[],render=f.shell.setState.bind(f.shell);
 f.shell.setState=(patch,callback)=>{render(patch,callback);const shown=f.renderChat();const frame=shown?`${shown.state}|${shown.recoveryLabel||''}|${shown.lines.map(line=>line.t).join()}`:'closed';if(frames.at(-1)!==frame)frames.push(frame);};
 f.driver.synthesize=async()=>{throw limited();};
 f.peak=.5;await clock.advance(700);f.peak=0;await clock.advance(1_200);await clock.flush();
 assert.equal(f.renderChat().state,'preparing-speech','the frame is held while the loop retires');
 await clock.advance(4_000);
 assert.deepEqual(frames.map(frame=>frame.split('|')[0]),['listening','transcribing','thinking','preparing-speech','starting','listening']);
 assert.doesNotMatch(frames.join('\n'),/Voice conversation stopped|Start Cloud voice|Try voice again|request limit/);
 assert.equal(f.sends,1,'the answered turn is not sent again');
});

test('Try voice again after a terminal error starts the quiet waits over',async t=>{
 const {f,clock,runs,view,fail}=await voice(t);
 await fail(limited());await clock.advance(3_000);
 await fail(limited());await clock.advance(3_000);
 await fail(Object.assign(Error('PRIVATE'),{code:'voice-http-401'}));
 assert.equal(view().model.state,'error');
 view().model.recover();await clock.flush();assert.equal(runs.length,4);
 await fail(limited());
 assert.notEqual(view().model.state,'error');assert.deepEqual(f.shell.messages,[],'a quiet wait, not the pause line');
 await clock.advance(3_000);assert.equal(runs.length,5);assert.equal(view().model.state,'listening');
});

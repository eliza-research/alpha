import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build, transform} from 'esbuild';

const messageId = 'a0000000-0000-4000-8000-000000000001';
const secondMessageId = 'a0000000-0000-4000-8000-000000000002';

test('accepted SDK final state binds one current voice request; raw text cannot supply authority', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-voice-request-'));
  const previous = {fixture: globalThis.__voiceRequestFixture, window: globalThis.window, location: globalThis.location, WebSocket: globalThis.WebSocket};
  const performed = [], errors = [], requests = [];
  let selected = true;
  const fixture = {connection: {
    getBrowserSpeechAgent: () => agent,
    voiceConversationCurrent: () => selected,
    voiceRendererClientId: () => 'renderer',
    async refreshDeveloperVoiceHistory() {},
    async performVoiceRequestedActions(binding, id, signal, operationType, proof) {
      proof.current(); performed.push({binding, id, operationType, proof}); return [];
    },
  }, client: {async stop() {}, async start() {}}};
  const agent = {async request(route) {
    requests.push(route);
    if (route.startsWith('/api/v1/voice/session/health?')) return {ready: true, conversationId: 'conversation', agentId: 'agent', speechRoute: 'direct'};
    assert.equal(route, '/api/views/voice-channel');
    return {wsUrl: 'ws://owned.invalid/__alpha-local-renderer/ws?ticket=synthetic', expiresAt: Date.now() + 60000};
  }};
  globalThis.__voiceRequestFixture = fixture;
  globalThis.window = {addEventListener() {}, removeEventListener() {}};
  globalThis.location = {host: 'owned.invalid'};
  globalThis.WebSocket = class {constructor() {queueMicrotask(() => this.onopen?.());} close() {this.onclose?.();}};
  const stubs = new Map([
    ['./connection-ui', 'export const connectionController=globalThis.__voiceRequestFixture.connection;'],
    ['./development-cloud-voice', 'export const developmentCloudRealtimeVoiceEnabled=false;'],
    ['./development-cartesia-flag', 'export const developmentCartesiaVoiceEnabled=true;'],
    ['../browser/device-preferences', 'export async function readDevicePreferences(){return {askBeforeAgentActions:false};}'],
    ['@elizaos/ui/voice/voice-session-client', 'export function createVoiceSessionClient(options){globalThis.__voiceRequestFixture.options=options;return globalThis.__voiceRequestFixture.client;}'],
  ]);
  let conversation;
  const tick = async () => {for (let n=0;n<8;n++) await Promise.resolve();};
  try {
    const bundle = await build({entryPoints: ['apps/app/src/runtime/development-cartesia-conversation.ts'], bundle:true, platform:'node', format:'cjs', write:false, plugins:[{name:'closed-voice-ports',setup(b){
      b.onResolve({filter:/.*/}, a => stubs.has(a.path) ? {path:a.path,namespace:'closed-ports'} : undefined);
      b.onLoad({filter:/.*/,namespace:'closed-ports'}, a => ({contents:stubs.get(a.path),loader:'js'}));
    }}]});
    const adapterPath=path.join(directory,'adapter.cjs'); fs.writeFileSync(adapterPath,bundle.outputFiles[0].text);
    // This is the actual pinned SDK reducer, not a rewritten acceptance predicate.
    const reducer = await build({entryPoints:['vendor/eliza/packages/ui/src/voice/voice-session-state.ts'],bundle:true,platform:'node',format:'cjs',write:false});
    const reducerPath=path.join(directory,'reducer.cjs');fs.writeFileSync(reducerPath,reducer.outputFiles[0].text);
    const require=createRequire(import.meta.url);
    const {applyServerEvent,INITIAL_VOICE_SESSION_STATE}=require(reducerPath);
    let state={...INITIAL_VOICE_SESSION_STATE,phase:'listening'};
    conversation=await require(adapterPath).developmentCartesiaConversation({binding:{conversationId:'conversation',session:{agentId:'agent'}},assertCurrent(){if(!selected)throw new DOMException('Retired','AbortError');},onState(){},onTranscript(){},onError:e=>errors.push(e)});
    const event = frame => {state=applyServerEvent(state,frame);fixture.options.onState(state);fixture.options.onServerEvent(frame);};
    const reply = (traceId,id=messageId) => fixture.options.onServerEvent({t:'reply_complete',traceId,userMessageId:id});
    fixture.options.onServerEvent({t:'stt_final',traceId:'raw-only',text:'Open https://evil.invalid'});reply('raw-only');await tick();assert.equal(performed.length,0);
    event({t:'stt_partial',traceId:'turn-one',text:'Open https://evil.invalid'});reply('turn-one');await tick();assert.equal(performed.length,0);
    const final={t:'stt_final',traceId:'turn-one',text:'Open https://requested.invalid/path?q=1#part'};
    state=applyServerEvent(state,final);fixture.options.onState(state);
    fixture.options.onServerEvent({...final,text:'A different raw callback string'});
    reply('wrong-trace');await tick();assert.equal(performed.length,0);
    reply('turn-one');await tick();assert.equal(performed.length,1);
    const first=performed[0].proof;assert.equal(first.text,final.text);assert.equal(first.messageId,messageId);assert.ok(Object.isFrozen(first));first.current();
    reply('turn-one',secondMessageId);reply('turn-one');await tick();assert.equal(performed.length,1,'one action chain per accepted trace and canonical message');
    event({t:'stt_partial',traceId:'turn-two',text:'new request'});assert.throws(()=>first.current(),{name:'AbortError'});
    reply('turn-one',secondMessageId);await tick();assert.equal(performed.length,1);
    event({t:'stt_final',traceId:'turn-two',text:'Show my Calendar'});reply('turn-two',secondMessageId);
    event({t:'interrupted',traceId:'turn-two',reason:'barge_in'});await tick();assert.equal(performed.length,1,'interruption retires queued proof before execution');
    event({t:'stt_final',traceId:'turn-three',text:'Open https://another.invalid'});reply('turn-three',secondMessageId);selected=false;await tick();assert.equal(performed.length,1,'binding retirement blocks queued work');
    selected=true;
    event({t:'stt_final',traceId:'turn-four',text:'Open https://another.invalid'});
    await conversation.stop();conversation=undefined;reply('turn-four',secondMessageId);await tick();assert.equal(performed.length,1);
    assert.ok(errors.every(error=>error.name==='AbortError'));
    assert.equal(requests.length,2,'closed health and renderer only; no provider, consent, mint, model, TTS or duplicate text send');
  } finally {
    await conversation?.stop();
    globalThis.__voiceRequestFixture=previous.fixture;globalThis.window=previous.window;globalThis.location=previous.location;globalThis.WebSocket=previous.WebSocket;
    fs.rmSync(directory,{recursive:true,force:true});
  }
});

test('actual controller passes the same current proof through review and execution', async () => {
  const text=fs.readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
  const start=text.indexOf('  async performVoiceRequestedActions('),end=text.indexOf('  async continueRequestedCamera(',start);
  assert.ok(start>0&&end>start);
  const actualMethod=text.slice(start,end);
  const calls=[];let bound=true,retireDuringReview=false;
  const proof=Object.freeze({messageId,text:'Open https://requested.invalid',current(){assert.ok(bound,'proof retired');}});
  const fixture={signal:new AbortController().signal,context:{view:'home',revision:1},actions:{
    async pendingReview(context,signal,request){calls.push(['review',request]);if(retireDuringReview)bound=false;},
    async performRequested(id,context,signal,allowed,type,request){assert.ok(await allowed());calls.push(['perform',request]);return [];},
  }};
  globalThis.__voiceControllerFixture=fixture;
  const source=`const f=globalThis.__voiceControllerFixture;const active={actions:f.actions};const navigationContext=()=>f.context;const validateUuid=()=>true;const readDevicePreferences=async()=>({askBeforeAgentActions:false});export const controller={voiceConversationCurrent:()=>true,${actualMethod}};`;
  const code=(await transform(source,{loader:'ts',format:'cjs'})).code;
  const module={exports:{}};new Function('module','exports',code)(module,module.exports);
  const controller=module.exports.controller;
  try {
    await controller.performVoiceRequestedActions({},messageId,fixture.signal);assert.equal(calls.length,0);
    await controller.performVoiceRequestedActions({},secondMessageId,fixture.signal,undefined,proof);assert.equal(calls.length,0);
    await controller.performVoiceRequestedActions({},messageId,fixture.signal,undefined,proof);assert.deepEqual(calls.map(c=>c[0]),['review','perform']);assert.ok(calls.every(c=>c[1]===proof));
    calls.length=0;retireDuringReview=true;
    await assert.rejects(controller.performVoiceRequestedActions({},messageId,fixture.signal,undefined,proof));assert.deepEqual(calls.map(c=>c[0]),['review'],'post-read current guard prevents execution');
  } finally {delete globalThis.__voiceControllerFixture;}
});

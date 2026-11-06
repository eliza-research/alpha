import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{stripTypeScriptTypes}from'node:module';
const source=readFileSync(new URL('../apps/app/src/prototype/voice-adapter.ts',import.meta.url),'utf8');
const start=source.indexOf('const direct=await developmentCartesiaConversation('),block=source.slice(start,source.indexOf('current();conversationVoice=direct;',start));
const transcript=block.slice(block.indexOf('onTranscript:')+'onTranscript:'.length,block.indexOf(',onError:'));
const state=block.slice(block.indexOf('onState:')+'onState:'.length,block.indexOf(',onPlaybackUnlockChange:'));
const render=source.split('\n').find(line=>line.includes('out.voiceInterim=')).trim();assert(render);
const code=stripTypeScriptTypes(`function create(){let conversationInterim='',conversationLastTranscript='',conversationInterimKnownMessages=new Set(),generation=1;const token=1;let conversationState={phase:'listening'};const chat={shell:{S:()=>({msgs:messages})}},refresh=()=>{};const receive=${transcript};const phase=${state};return {receive,phase,render(){const recorder={interimTranscript:conversationInterim},out={msgs:messages.map(m=>({...m,isUser:m.from==='you'}))};${render};return out.voiceInterim;},replaceOwner(){generation++;}};}`,{mode:'strip'});
function fixture(cloud){const messages=[],factory=new Function('messages','developmentCloudRealtimeVoiceEnabled','developmentCartesiaVoiceEnabled','developmentCloudVoiceEnabled',code+';return create();');return{messages,...factory(messages,cloud,!cloud,cloud)};}
for(const cloud of[false,true])test(`${cloud?'Cloud':'direct'} actual adapter displays repeated phrase across renewed session until its new final message arrives`,()=>{
 const f=fixture(cloud);f.receive('Open');f.receive('Open notes.');assert.equal(f.render(),'Open notes.');f.messages.push({id:'first',from:'you',text:'Open notes.'});assert.equal(f.render(),'');
 f.phase('speaking');f.phase('listening');f.phase('connecting');f.phase('listening');f.receive('Open');assert.equal(f.render(),'Open');f.receive('Open notes.');assert.equal(f.render(),'Open notes.','historical same text must not suppress current running transcript');f.messages.push({id:'second',from:'you',text:'Open notes.'});assert.equal(f.render(),'','only new final user message ends the inline duplicate');
});
test('actual transcript owner callback cannot update a superseded voice conversation',()=>{const f=fixture(true);f.replaceOwner();f.receive('Open notes.');assert.equal(f.render(),'');});

for(const cloud of[false,true])for(const transition of['complete','interrupted'])test(`${cloud?'Cloud':'direct'} actual listening resets ${transition} interim and snapshots next turn`,()=>{
 const f=fixture(cloud);f.receive('Open notes.');assert.equal(f.render(),'Open notes.');if(transition==='interrupted')f.messages.push({id:'interrupted-prior',from:'you',text:'Open notes.'});f.phase(transition);f.phase('listening');assert.equal(f.render(),'','listening must not keep stale text even without a persisted final');f.receive('Open');f.receive('Open notes.');assert.equal(f.render(),'Open notes.');f.messages.push({id:'new-final',from:'you',text:'Open notes.'});assert.equal(f.render(),'');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {cloudVoiceViewFixture} from './fixtures/cloud-voice-view.mjs';
import {voiceMarkup} from './fixtures/voice-markup.mjs';

// The actual production template and DCLogic renderer, closed presentation ports only. Terminal
// Cloud failures are covered by voice-calm-cloud-errors.test.mjs.
test('actual voice activity sits below the chat notices, and an unconfirmed cleanup stays quiet and blocked',async()=>{
 const {render,createActivity}=await voiceMarkup(),before=globalThis.document;
 const env=new JSDOM('<!doctype html>'),beforeMedia=globalThis.matchMedia;
 let f;
 globalThis.matchMedia=()=>({matches:true});
 try{
  globalThis.document=env.window.document;
  f=cloudVoiceViewFixture({cloudProfile:true});
  f.box.React={createElement:(_component,props)=>createActivity(props)};f.box.VoiceActivity=()=>null;
  f.box.BatchVoiceConversation=class {
    constructor(options){f.batchOptions=options;}
    async start(){f.initialView=f.renderChat();f.batchOptions.onState({phase:'listening'});}
    async stop(){if(f.cleanupError)throw f.cleanupError;}
    recheck(){}
  };
  await f.shell.startVoice();
  for(const state of ['starting','listening']){
   const model=state==='starting'?f.initialView:f.renderChat();
   assert.equal(model.state,state);if(state==='starting')assert.equal(model.activity,null);else assert.notEqual(model.activity,null);
   const html=render({inlineChatRecorder:true,chatRecorder:model});
   const doc=new JSDOM(html).window.document,notices=doc.querySelector('.alpha-chat-notices'),controls=doc.querySelector('.alpha-voice-composer');
   assert.ok(notices&&controls);
   assert.ok(notices.compareDocumentPosition(controls)&doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING,'chat notices precede the voice controls');
   // The composer shows activity and controls. Routing disclosures live in Settings.
   assert.equal(notices.querySelectorAll('[role="note"]').length,0);
   assert.equal(doc.querySelector('[role="alert"]'),null,'no voice error banner');
   assert.equal(notices.querySelector('.alpha-voice-error'),null,'no error or support-code content');
   assert.equal(notices.querySelector('[data-alpha-voice-recovery]'),null);
   assert.ok(doc.querySelector('[aria-label="Stop voice conversation"]'));
   assert.equal(doc.querySelectorAll('[data-alpha-voice-animation]').length,state==='starting'?0:1);
   assert.equal(doc.querySelectorAll('[aria-label="Voice activity"]').length,state==='starting'?0:1);
  }
  // The same actual adapter must preserve uncertain cleanup instead of claiming mic-off.
  f.cleanupError=Error('Cleanup could not be confirmed');
  f.renderChat().stop();for(let count=0;count<10;count++)await f.tick();
  const held=f.renderChat();assert.equal(held.state,'error');assert.equal(held.activity,null);
  assert.equal(held.muted,'mixed');assert.equal(held.muteLabel,'Microphone status unconfirmed');
  assert.ok(!held.recoveryLabel);assert.match(held.lines[0].t,/Could not confirm voice media stopped/);
  const heldDoc=new JSDOM(render({inlineChatRecorder:true,chatRecorder:held})).window.document;
  assert.equal(heldDoc.querySelectorAll('[data-alpha-voice-animation]').length,0);
  assert.equal(heldDoc.querySelector('[role="alert"]'),null);assert.doesNotMatch(heldDoc.body.textContent,/Could not confirm|Close the app/);
  await f.shell.startVoice();await f.tick();assert.equal(f.renderChat().state,'error','unknown media remains blocked, not falsely idle');assert.deepEqual(f.shell.messages,[],'repeated start while unsafe stays quiet');
  assert.ok(heldDoc.querySelector('[aria-label="Stop voice conversation"]'));
  assert.equal(f.starts,0);assert.equal(f.uploads,0);
  // Putting the held panel away says why voice stays off, and so does each later attempt to use it.
  const notice='Could not confirm voice media stopped. Close the app before starting voice again.';
  f.shell.back();assert.deepEqual(f.shell.messages,[notice]);
  await f.shell.startVoice();await f.tick();assert.deepEqual(f.shell.messages,[notice,notice],'a refused voice start is never silent');
  f.shell.startTranscription();await f.tick();assert.deepEqual(f.shell.messages,[notice,notice,notice],'dictation names the same cause');
  assert.equal(f.starts,0);assert.equal(f.uploads,0);f.shell.messages.length=0;
  // Legacy dictation has named failure states, not just 'error'. Its failure flag must drive
  // the same quiet presentation without renaming the state or bypassing any action guard.
  const adapter=fs.readFileSync('apps/app/src/prototype/voice-adapter.ts','utf8');
  assert.match(adapter,/state: failure \|\| stage,\s+failed: Boolean\(error \|\| failure\)/);
  assert.match(adapter,/recorder\.problem=recorder\.state==='error'\|\|recorder\.failed===true/);
  for(const state of ['denied','no-speech','local-agent','recognition','permission-denied']){
   const model={...held,state,failed:true,statusLines:[],lines:[{t:'INTERNAL_FAILURE_DETAIL'}],recoveryLabel:''};
   const legacy=new JSDOM(render({legacyChatRecorder:true,chatRecorder:model})).window.document;
   assert.equal(legacy.querySelector('[role="alert"]'),null);
   assert.doesNotMatch(legacy.body.textContent,/INTERNAL_FAILURE_DETAIL/);
   assert.equal(model.state,state,'failure identity is unchanged');
  }
 }finally{f?.close();globalThis.matchMedia=beforeMedia;globalThis.document=before;env.window.close();}
});

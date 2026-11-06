import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {tsImport} from 'tsx/esm/api';

const {VoiceActivity}=await tsImport('../apps/app/src/prototype/voice-activity.tsx',import.meta.url);

// Synthetic presentation only: no capture, recording, provider, or model requests.
globalThis.matchMedia=()=>({matches:true});
test('full composer uses the recovered 35-bar blue synth, compact pill uses five bars',()=>{
 for(const phase of ['connecting','listening','transcribing','thinking','speaking','paused','error']){
  const full=renderToStaticMarkup(React.createElement(VoiceActivity,{phase,theme:'light'}));
  const compact=renderToStaticMarkup(React.createElement(VoiceActivity,{phase,theme:'dark',compact:true}));
  assert.equal((full.match(/data-alpha-voice-bar=/g)||[]).length,35);
  assert.equal((compact.match(/data-alpha-voice-bar=/g)||[]).length,5);
  assert.match(full,/data-paused="true"/);assert.match(full,new RegExp(`data-phase="${phase}"`));
 }
});
test('chat has a single idle mic and active composer owns mute/stop without a keyboard toggle',()=>{
 const template=fs.readFileSync(new URL('../apps/app/src/prototype/template.html',import.meta.url),'utf8');
 assert.doesNotMatch(template,/aria-label="Transcribe" title="Transcribe into draft"/);
 const start=template.indexOf('<section data-alpha-chat-recorder data-voice-state="{{chatRecorder.state}}" class="alpha-chat-composer');
 const inline=template.slice(start,template.indexOf('</section>',start));
 assert.match(inline,/chatRecorder.toggleMute/);assert.match(inline,/chatRecorder.stop/);
 assert.match(inline,/chatRecorder.activity/);assert.doesNotMatch(inline,/Switch to keyboard/);
 assert.match(template,/data-alpha-voice-interim aria-label="Heard so far, not sent"/);
});

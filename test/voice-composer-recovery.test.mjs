import test from 'node:test';
import assert from 'node:assert/strict';
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

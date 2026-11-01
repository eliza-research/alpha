import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {cloudVoiceViewFixture} from './fixtures/cloud-voice-view.mjs';

// The actual production template and DCLogic renderer, closed presentation ports only.
test('actual voice error clears input activity while retaining disclosure, support code and uncertain cleanup',async()=>{
 const template=fs.readFileSync('apps/app/src/prototype/template.html','utf8');
 const start=template.indexOf('<sc-if value="{{inlineChatRecorder}}">');
 const end=template.indexOf('<sc-if value="{{panelComposer}}">',start);
 assert.ok(start>=0&&end>start);
 const fragment='<div class="os"><div data-screen="1">'+template.slice(start,end)+'</div></div>';
 const bundle=await build({stdin:{contents:`import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import{DCLogic}from'./apps/app/src/prototype/dc-lite.js';import{VoiceActivity}from'./apps/app/src/prototype/voice-activity.tsx';export const createActivity=props=>React.createElement(VoiceActivity,props);class Fixture extends DCLogic{renderVals(){return this.props.values;}}export const render=values=>renderToStaticMarkup(React.createElement(Fixture,{phoneSurface:true,values}));`,resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'actual-voice-template',setup(b){b.onResolve({filter:/template\.html\?raw$/},()=>({path:'voice',namespace:'actual-template'}));b.onLoad({filter:/.*/,namespace:'actual-template'},()=>({contents:'export default '+JSON.stringify(fragment),loader:'js'}));}}]});
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'voice-copy-markup-')),file=path.join(temporary,'renderer.cjs'),before=globalThis.document;
 const env=new JSDOM('<!doctype html>'),beforeMedia=globalThis.matchMedia;
 let f;
 globalThis.matchMedia=()=>({matches:true});
 try{
  globalThis.document=env.window.document;fs.writeFileSync(file,bundle.outputFiles[0].text);
  const {render,createActivity}=createRequire(import.meta.url)(file);
  f=cloudVoiceViewFixture({cloudProfile:true});
  f.box.React={createElement:(_component,props)=>createActivity(props)};f.box.VoiceActivity=()=>null;
  f.box.BatchVoiceConversation=class {
    constructor(options){f.batchOptions=options;}
    async start(){f.initialView=f.renderChat();f.batchOptions.onState({phase:'listening'});}
    async stop(){if(f.cleanupError)throw f.cleanupError;}
    recheck(){}
  };
  await f.shell.startVoice();
  for(const state of ['starting','listening','error']){
   const error=state==='error';
   if(error)f.batchOptions.onState({phase:'error',error:Object.assign(new Error('PRIVATE_PROVIDER_BODY'),{code:'voice-http-503'})});
   const model=state==='starting'?f.initialView:f.renderChat();
   assert.equal(model.state,state);assert.equal(model.activity===null,error);
   const html=render({inlineChatRecorder:true,chatRecorder:model});
   const doc=new JSDOM(html).window.document,details=doc.querySelector('details');
   const alert=doc.querySelector('[role="alert"]');
   // Speech routing is disclosed in Settings > Voice; the live composer opens details only for an error.
   if(error){
    assert.ok(details);assert.equal(details.querySelector('summary').textContent,'Voice details');
    assert.equal(details.hasAttribute('open'),false,'an error never forces the disclosure open');
    assert.equal(doc.querySelectorAll('[role="note"]').length,1);
    assert.match(details.textContent,/uploads recordings.*plan allowance.*Cartesia/);
    assert.match(alert.textContent,/Voice is unavailable/);assert.doesNotMatch(alert.textContent,/503|uploads/);assert.match(details.textContent,/HTTP 503/);
   }else{assert.equal(details,null,'no details panel during a healthy conversation');assert.equal(alert,null);}
   assert.ok(doc.querySelector('[aria-label="Stop voice conversation"]'));
   assert.equal(doc.querySelectorAll('[data-alpha-voice-animation]').length,error?0:1);
   assert.equal(doc.querySelectorAll('[aria-label="Voice activity"]').length,error?0:1);
   if(error){assert.equal(model.muted,'mixed');assert.equal(model.muteLabel,'Microphone status unconfirmed');assert.equal(model.recoveryLabel,'Try voice again');}

  }
  // The same actual adapter must preserve uncertain cleanup instead of claiming mic-off.
  f.cleanupError=Error('Cleanup could not be confirmed');
  f.renderChat().stop();for(let count=0;count<10;count++)await f.tick();
  const held=f.renderChat();assert.equal(held.state,'error');assert.equal(held.activity,null);
  assert.equal(held.muted,'mixed');assert.equal(held.muteLabel,'Microphone status unconfirmed');
  assert.equal(held.recoveryLabel,undefined);assert.match(held.lines[0].t,/Could not confirm voice media stopped/);
  const heldDoc=new JSDOM(render({inlineChatRecorder:true,chatRecorder:held})).window.document;
  assert.equal(heldDoc.querySelectorAll('[data-alpha-voice-animation]').length,0);
  assert.match(heldDoc.querySelector('[role="alert"]').textContent,/Could not confirm voice media stopped/);
  assert.ok(heldDoc.querySelector('[aria-label="Stop voice conversation"]'));
  assert.equal(f.starts,0);assert.equal(f.uploads,0);
 }finally{f?.close();globalThis.matchMedia=beforeMedia;globalThis.document=before;env.window.close();fs.rmSync(temporary,{recursive:true,force:true});}
});

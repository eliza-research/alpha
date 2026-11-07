// Render the unchanged production DCLogic against only the chat notices and inline voice controls
// of the actual template. Built once per process; callers own the document and matchMedia globals
// their renders need.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import {build} from 'esbuild';import {JSDOM} from 'jsdom';
let loaded;
export function voiceMarkup(){
 loaded??=(async()=>{
  const template=fs.readFileSync('apps/app/src/prototype/template.html','utf8');
  const noticesStart=template.indexOf('<div class="alpha-chat-notices">'),noticesEnd=template.indexOf('<sc-if value="{{legacyChatRecorder}}">',noticesStart);
  const controlsStart=template.indexOf('<sc-if value="{{inlineChatRecorder}}">',noticesEnd),controlsEnd=template.indexOf('<sc-if value="{{panelComposer}}">',controlsStart);
  if(!(noticesStart>=0&&noticesEnd>noticesStart&&controlsStart>noticesEnd&&controlsEnd>controlsStart))throw Error('Actual voice surface missing');
  const fragment='<div class="os"><div data-screen="1">'+template.slice(noticesStart,noticesEnd)+template.slice(controlsStart,controlsEnd)+'</div></div>';
  const result=await build({stdin:{contents:`import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import{DCLogic}from'./apps/app/src/prototype/dc-lite.js';import{VoiceActivity}from'./apps/app/src/prototype/voice-activity.tsx';export const createActivity=props=>React.createElement(VoiceActivity,props);class Fixture extends DCLogic{renderVals(){return this.props.values;}}export const render=values=>renderToStaticMarkup(React.createElement(Fixture,{phoneSurface:true,values}));`,resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'actual-voice-template',setup(b){b.onResolve({filter:/template\.html\?raw$/},()=>({path:'voice',namespace:'actual-template'}));b.onLoad({filter:/.*/,namespace:'actual-template'},()=>({contents:'export default '+JSON.stringify(fragment),loader:'js'}));}}]});
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'voice-markup-')),file=path.join(temporary,'renderer.cjs'),before=globalThis.document;
  try{globalThis.document=new JSDOM('<!doctype html>').window.document;fs.writeFileSync(file,result.outputFiles[0].text);const {render,createActivity}=createRequire(import.meta.url)(file);return {render,createActivity};}
  finally{globalThis.document=before;fs.rmSync(temporary,{recursive:true,force:true});}
 })();
 return loaded;
}

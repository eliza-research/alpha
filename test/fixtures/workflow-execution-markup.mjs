// Render the unchanged production DCLogic against only its existing execution subtree.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import {build} from 'esbuild';import {JSDOM} from 'jsdom';
let render;
export async function executionMarkup(model){
 if(!render){
  const text=fs.readFileSync('apps/app/src/prototype/template.html','utf8'),start=text.indexOf('<sc-if value="{{workflows.runOpen}}">'),end=text.indexOf('<sc-if value="{{workflows.builder}}">',start);
  if(start<0||end<start)throw Error('Actual execution surface missing');
  const fragment='<div class="os"><div data-screen="1">'+text.slice(start,end)+'</div></div>';
  const result=await build({stdin:{contents:`import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import{DCLogic}from'./apps/app/src/prototype/dc-lite.js';class Fixture extends DCLogic{renderVals(){return this.props.values;}}export const render=values=>renderToStaticMarkup(React.createElement(Fixture,{phoneSurface:true,values}));`,resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'actual-execution-template-slice',setup(b){b.onResolve({filter:/template\.html\?raw$/},()=>({path:'execution',namespace:'actual-template'}));b.onLoad({filter:/.*/,namespace:'actual-template'},()=>({contents:'export default '+JSON.stringify(fragment),loader:'js'}));}}]});
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-markup-')),file=path.join(temporary,'renderer.cjs'),before=globalThis.document;
  try{globalThis.document=new JSDOM('<!doctype html>').window.document;fs.writeFileSync(file,result.outputFiles[0].text);render=createRequire(import.meta.url)(file).render;}
  finally{globalThis.document=before;fs.rmSync(temporary,{recursive:true,force:true});}
 }
 return render({workflows:{runOpen:true,r:model},ic:JSON.parse(fs.readFileSync('apps/app/src/icon-catalog.json','utf8')).ic});
}

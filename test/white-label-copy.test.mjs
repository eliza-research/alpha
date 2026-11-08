import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';

const root=path.resolve(import.meta.dirname,'..');
// The Cloud service name comes only from config/cloud-deployment.json (the generated files);
// Alpha's runtime and native sources must not hard-code another product's name in user copy.
const sources=[['apps/app/src/runtime',/\.(ts|tsx)$/],['android/app/src/main/java/ai/elizaresearch/alphaphone',/\.java$/]];
const generated=new Set(['apps/app/src/runtime/cloud-deployment.generated.ts','android/app/src/main/java/ai/elizaresearch/alphaphone/CloudDeployment.java']);
const stripComments=text=>text.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[\s;{}(),])\/\/.*$/gm,'$1');

test('runtime and native sources carry no hard-coded Eliza product name outside the Cloud configuration',()=>{
 const found=[];
 for(const [dir,pattern] of sources)for(const name of fs.readdirSync(path.join(root,dir),{recursive:true})){
  const rel=path.join(dir,String(name));
  if(!pattern.test(rel)||generated.has(rel))continue;
  stripComments(fs.readFileSync(path.join(root,rel),'utf8')).split('\n').forEach((line,index)=>{
   // X-Eliza-* are wire headers (protocol, not branding). The UPSTREAM_* notice markers are the
   // pinned upstream text, matched to recognise stored rows and never shown (system-notice-collapse.test.mjs).
   if(/^export const UPSTREAM_[A-Z_]+_NOTICE = /.test(line)&&rel==='apps/app/src/runtime/action-message-presentation.ts')return;
   if(/(?<![\w-])Eliza(?![\w-])/.test(line.replace(/X-Eliza-[\w-]+/g,'')))found.push(`${rel}:${index+1}`);
  });
 }
 assert.deepEqual(found,[]);
});

test('Dedicated hosting review names the configured Cloud service and a neutral agent',async()=>{
 const temp=fs.mkdtempSync(path.join(root,'.personal-setup-test-')),file=path.join(temp,'component.mjs');
 try{
  await build({entryPoints:[path.join(root,'apps/app/src/runtime/cloud-personal-setup.tsx')],bundle:true,platform:'node',format:'esm',outfile:file,external:['react','react/jsx-runtime'],logLevel:'silent'});
  const {CloudPersonalSetup}=await import(pathToFileURL(file).href);
  const review=action=>({kind:'review',review:{action,startsCompute:true,dailyRateUsd:1,hourlyRateUsd:0.05,balanceUsd:10,minimumBalanceUsd:1,minimumActivationChargeUsd:0.1,requiresCatalogRestore:false,stateDisposition:'reuse'}});
  const render=(view,extra={})=>renderToStaticMarkup(React.createElement(CloudPersonalSetup,{setup:{view,blocked:false,declined:false},busy:false,onAccept(){},onDecline(){},onPoll(){},onFinalize(){},onConnect(){},...extra}));
  const start=render(review('start_dedicated'),{serviceName:'Example Cloud'});
  assert.match(start,/Start your Dedicated agent/);
  assert.match(start,/This starts Dedicated hosting on Example Cloud for your personal agent\./);
  assert.match(render(review('adopt_existing_dedicated')),/Use your existing Dedicated agent/);
  assert.match(render(review('start_dedicated')),/hosting on Cloud for/);
  for(const html of [start,render(review('adopt_existing_dedicated'),{serviceName:'Example Cloud'})])assert.doesNotMatch(html,/Eliza/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

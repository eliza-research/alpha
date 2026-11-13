import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';

const root=path.resolve(import.meta.dirname,'..');

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

import {after,test}from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs';import path from'node:path';import{pathToFileURL}from'node:url';
import React from'react';import{renderToStaticMarkup}from'react-dom/server';import{build}from'esbuild';
const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(root,'.membership-ui-test-')),file=path.join(temp,'component.mjs');
after(()=>fs.rmSync(temp,{recursive:true,force:true}));
await build({entryPoints:[path.join(root,'apps/app/src/runtime/cloud-membership-ui.tsx')],bundle:true,platform:'node',format:'esm',outfile:file,external:['react','react/jsx-runtime'],loader:{'.css':'empty'},logLevel:'silent'});
const{CloudMembershipControls,BillingAccountReview}=await import(pathToFileURL(file).href);
const calls=[];const base={email:'example@alpha.test',busy:false,balance:'funded',credits:{usd:'9.911418',observedAt:Date.UTC(2026,9,25)},plan:{kind:'credits'},onRedeem:async()=>{calls.push('redeem');return false;},onAddFunds:()=>calls.push('funds'),onRefresh:()=>calls.push('refresh')};
const render=(extra={})=>renderToStaticMarkup(React.createElement(CloudMembershipControls,{...base,...extra}));
test('approved B exposes one code-entry action, not another accordion or an initial code form',()=>{const s=render();assert.match(s,/Enter membership code/);assert.doesNotMatch(s,/<details|Have a membership code|<input/);assert.deepEqual(calls,[]);});
test('exact nonzero credits survive display formatting while redundant trailing zeroes are removed',()=>{assert.match(render(),/\$9\.911418/);assert.match(render({credits:{usd:'0.000005',observedAt:0}}),/\$0\.000005/);assert.match(render({credits:{usd:'12.340000',observedAt:0}}),/\$12\.34</);assert.doesNotMatch(render({credits:{usd:'12.340000',observedAt:0}}),/12\.340000/);});
test('unavailable and checking balances never invent zero credits',()=>{for(const balance of['unavailable','checking']){const s=render({balance,credits:null,plan:null});assert.doesNotMatch(s,/\$0\.00|No active membership/);assert.match(s,balance==='checking'?/Checking…/:/Not available/);}});
test('active membership retains its verified plan and end date',()=>{const s=render({plan:{kind:'active',planName:'Example plan'},endsAt:Date.now()+86400000});assert.match(s,/Example plan/);assert.match(s,/Ends /);});
test('busy prevents all membership actions and retains provided errors and notices',()=>{const s=render({busy:true,error:'Example error',notice:'Example notice'});const buttons=[...s.matchAll(/<button\b([^>]*)>/g)];assert.ok(buttons.length>=3);assert.ok(buttons.every(x=>x[1].includes('disabled')));assert.match(s,/role="alert">Example error/);assert.match(s,/Example notice/);assert.deepEqual(calls,[]);});
test('billing review still requires the separate account acknowledgment and does not open billing on render',()=>{const s=renderToStaticMarkup(React.createElement(BillingAccountReview,{email:'example@alpha.test',busy:false,onOpen:()=>calls.push('billing'),onCancel:()=>calls.push('cancel')}));assert.match(s,/type="checkbox"[^>]*required/);assert.match(s,/type="submit"[^>]*disabled/);assert.match(s,/I’ll check the account before paying/);assert.deepEqual(calls,[]);});

test('identical redemption and connection recovery warnings render once without hiding the warning',()=>{const html=render({error:'Recovery requires review',connectionError:'Recovery requires review'});assert.equal((html.match(/Recovery requires review/g)||[]).length,1);assert.equal((html.match(/role="alert"/g)||[]).length,1);});
test('distinct redemption and global recovery errors both remain visible',()=>{const html=render({error:'Code was not accepted',connectionError:'Recovery requires review'});assert.equal((html.match(/role="alert"/g)||[]).length,2);assert.match(html,/Code was not accepted/);assert.match(html,/Recovery requires review/);});
test('no membership error produces no error alert',()=>{assert.doesNotMatch(render({error:'',connectionError:''}),/role="alert"/);});
test('inside the resident plan panel the plan and its allowance are shown once, by the panel',()=>{
 const plan={kind:'active',planName:'Example plan',allowance:{unit:'requests',period:'month',limit:40,used:3,resetsAt:null}};
 const own=render({plan,endsAt:Date.now()+86400000});assert.match(own,/Membership/);assert.match(own,/Example plan/);
 const hosted=render({plan,endsAt:Date.now()+86400000,planShownByHost:true});
 assert.doesNotMatch(hosted,/Membership<|Example plan|Ends /);assert.match(hosted,/Available credits/);assert.match(hosted,/Enter membership code/);
});

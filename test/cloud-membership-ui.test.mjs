import {after,test}from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs';import path from'node:path';import{pathToFileURL}from'node:url';
import React from'react';import{renderToStaticMarkup}from'react-dom/server';import{build}from'esbuild';
const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(root,'.membership-ui-test-')),file=path.join(temp,'component.mjs');
after(()=>fs.rmSync(temp,{recursive:true,force:true}));
await build({entryPoints:[path.join(root,'apps/app/src/runtime/cloud-membership-ui.tsx')],bundle:true,platform:'node',format:'esm',outfile:file,external:['react','react/jsx-runtime'],loader:{'.css':'empty'},logLevel:'silent'});
const{CloudMembershipControls,BillingAccountReview}=await import(pathToFileURL(file).href);
const calls=[];const base={email:'example@alpha.test',busy:false,balance:'funded',plan:{kind:'credits'},onRedeem:async()=>{calls.push('redeem');return false;},onManagePlan:()=>calls.push('plan'),onRefresh:()=>calls.push('refresh')};
const render=(extra={})=>renderToStaticMarkup(React.createElement(CloudMembershipControls,{...base,...extra}));
test('subscription entry offers a monthly plan and keeps code redemption secondary without acting on render',()=>{const s=render();assert.match(s,/aria-label="Subscription"/);assert.match(s,/Choose a monthly plan/);assert.match(s,/Enter membership code/);assert.doesNotMatch(s,/<details|Have a membership code|<input/);assert.deepEqual(calls,[]);});
test('every subscription state omits credit balances and top-up actions, including stale credit props',()=>{
 for(const plan of [null,{kind:'checking'},{kind:'active',planName:'Example plan'},{kind:'expired',planName:'Expired plan'},{kind:'unavailable',reason:'outage'},{kind:'inactive',status:'none',planName:null},{kind:'credits'}]){
  const html=render({plan,credits:{usd:'9.911418',observedAt:0}});
  assert.doesNotMatch(html,/Available credits|Add credits|\$9\.911418|\bUSD\b/);
 }
});
test('subscription management action follows the verified plan state',()=>{
 for(const plan of [{kind:'active',planName:'Example plan'},{kind:'expired',planName:'Expired plan'},{kind:'unavailable',reason:'outage'}])assert.match(render({plan}),/>Manage subscription</);
 for(const plan of [{kind:'inactive',status:'none',planName:null},{kind:'credits'}]){const html=render({plan});assert.match(html,/>Choose a monthly plan</);assert.match(html,/No active subscription/);}
});
test('unavailable and checking plans do not invent an inactive subscription or a renewal date',()=>{for(const [balance,plan] of [['unavailable',{kind:'unavailable',reason:'outage'}],['checking',{kind:'checking'}]]){const html=render({balance,plan});assert.doesNotMatch(html,/No active subscription|Access through|\$0\.00/);assert.match(html,balance==='checking'?/Checking subscription…/:/not confirmed/i);}});
test('active subscription retains its verified plan and access end without implying automatic renewal',()=>{const s=render({plan:{kind:'active',planName:'Example plan'},endsAt:Date.now()+86400000});assert.match(s,/<dt>Plan<\/dt>/);assert.match(s,/Example plan/);assert.match(s,/Access through /);assert.doesNotMatch(s,/Renews|Next payment/);});
test('busy prevents all membership actions and retains provided errors and notices',()=>{const s=render({busy:true,error:'Example error',notice:'Example notice'});const buttons=[...s.matchAll(/<button\b([^>]*)>/g)];assert.ok(buttons.length>=3);assert.ok(buttons.every(x=>x[1].includes('disabled')));assert.match(s,/role="alert">Example error/);assert.match(s,/Example notice/);assert.deepEqual(calls,[]);});
test('billing review still requires the separate account acknowledgment and does not open billing on render',()=>{const s=renderToStaticMarkup(React.createElement(BillingAccountReview,{email:'example@alpha.test',busy:false,onOpen:()=>calls.push('billing'),onCancel:()=>calls.push('cancel')}));assert.match(s,/type="checkbox"[^>]*required/);assert.match(s,/type="submit"[^>]*disabled/);assert.match(s,/I’ll check the account before paying/);assert.deepEqual(calls,[]);});

test('identical redemption and connection recovery warnings render once without hiding the warning',()=>{const html=render({error:'Recovery requires review',connectionError:'Recovery requires review'});assert.equal((html.match(/Recovery requires review/g)||[]).length,1);assert.equal((html.match(/role="alert"/g)||[]).length,1);});
test('distinct redemption and global recovery errors both remain visible',()=>{const html=render({error:'Code was not accepted',connectionError:'Recovery requires review'});assert.equal((html.match(/role="alert"/g)||[]).length,2);assert.match(html,/Code was not accepted/);assert.match(html,/Recovery requires review/);});
test('no membership error produces no error alert',()=>{assert.doesNotMatch(render({error:'',connectionError:''}),/role="alert"/);});
test('the subscription section shows one plan and one reported monthly allowance',()=>{
 const plan={kind:'active',planName:'Example plan',allowance:{unit:'requests',period:'month',limit:40,used:3,resetsAt:null}};
 const html=render({plan,endsAt:Date.now()+86400000});
 assert.equal((html.match(/Example plan/g)||[]).length,1);
 assert.equal((html.match(/3 of 40 requests used this month/g)||[]).length,1);
 assert.match(html,/Enter membership code/);
 assert.deepEqual(calls,[]);
});

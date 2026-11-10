import {test}from'node:test';
import assert from'node:assert/strict';
import {createRequire}from'node:module';
import React from'react';import{renderToStaticMarkup}from'react-dom/server';import{buildSync}from'esbuild';
const code=buildSync({entryPoints:['apps/app/src/runtime/cloud-membership-ui.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime'],loader:{'.css':'empty'},logLevel:'silent'}).outputFiles[0].text;
const module={exports:{}};
new Function('require','module','exports',code)(createRequire(import.meta.url),module,module.exports);
const{CloudMembershipControls}=module.exports;
const calls=[];const base={email:'example@alpha.test',busy:false,balance:'funded',plan:{kind:'credits'},onRedeem:async()=>{calls.push('redeem');return false;},onManagePlan:()=>calls.push('plan'),onRefresh:()=>calls.push('refresh')};
const render=(extra={})=>renderToStaticMarkup(React.createElement(CloudMembershipControls,{...base,...extra}));
test('subscription entry offers a monthly plan and keeps code redemption secondary without acting on render',()=>{const s=render();assert.match(s,/aria-label="Balance and membership"/);assert.match(s,/Choose a monthly plan/);assert.match(s,/Enter membership code/);assert.doesNotMatch(s,/<details|Have a membership code|<input/);assert.deepEqual(calls,[]);});
test('the account sheet shows a returned balance once without inferring it from a plan',()=>{
 const html=render({credits:{usd:'9.911418',observedAt:0}});
 assert.match(html,/\$9\.91/);assert.equal((html.match(/<dt>Balance<\/dt>/g)||[]).length,1);
 assert.match(html,/Add balance/);
 assert.match(render({credits:null,balance:'unavailable'}),/Not available/);
 assert.doesNotMatch(render({credits:null,balance:'unavailable'}),/\$0\.00/);
});
test('subscription management action follows the verified plan state',()=>{
 for(const plan of [{kind:'active',planName:'Example plan'},{kind:'expired',planName:'Expired plan'},{kind:'unavailable',reason:'outage'}])assert.match(render({plan}),/>Manage subscription</);
 for(const plan of [{kind:'inactive',status:'none',planName:null},{kind:'credits'}]){const html=render({plan});assert.match(html,/>Choose a monthly plan</);assert.match(html,/No active subscription/);}
});
test('unavailable and checking plans do not invent an inactive subscription or a renewal date',()=>{for(const [balance,plan] of [['unavailable',{kind:'unavailable',reason:'outage'}],['checking',{kind:'checking'}]]){const html=render({balance,plan});assert.doesNotMatch(html,/No active subscription|Access through|\$0\.00/);assert.match(html,balance==='checking'?/Checking subscription…/:/not confirmed/i);}});
test('active subscription retains its verified plan and access end without implying automatic renewal',()=>{const s=render({plan:{kind:'active',planName:'Example plan'},endsAt:Date.now()+86400000});assert.match(s,/<dt>Membership<\/dt>/);assert.match(s,/Example plan/);assert.match(s,/Access through /);assert.doesNotMatch(s,/Renews|Next payment/);});
test('busy prevents all membership actions and retains provided errors and notices',()=>{const s=render({busy:true,error:'Example error',notice:'Example notice'});const buttons=[...s.matchAll(/<button\b([^>]*)>/g)];assert.ok(buttons.length>=3);assert.ok(buttons.every(x=>x[1].includes('disabled')));assert.match(s,/role="alert">Example error/);assert.match(s,/Example notice/);assert.deepEqual(calls,[]);});
test('the account sheet omits the redundant subscription paragraph and checkbox',()=>{
 const html=render();assert.doesNotMatch(html,/Choose a monthly plan or enter|type="checkbox"|Your browser may|Sign-in valid until/);
 assert.deepEqual(calls,[]);
});

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

test('an account without an email names the configured Cloud service, never a fixed brand',()=>{
 const html=render({email:'',serviceName:'Example Cloud'});
 assert.match(html,/Signed in to Example Cloud/);
 assert.doesNotMatch(html,/Eliza Cloud/);
 assert.match(render({email:''}),/Signed in to Cloud</);
});
